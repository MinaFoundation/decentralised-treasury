import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCHEDULER_SCRIPT = join(
  REPOSITORY_ROOT,
  "devops/docker/voting-ledger-scheduler-entrypoint.sh",
);
const HASH_A = `j${"1".repeat(50)}`;
const HASH_B = `j${"2".repeat(50)}`;

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), "voting-ledger-scheduler-"));
  const sqliteDirectory = join(root, "sqlite");
  const ledgerDirectory = join(root, "ledgers");
  const binDirectory = join(root, "bin");
  const callLog = join(root, "pnpm-calls.log");
  await Promise.all([
    mkdir(sqliteDirectory),
    mkdir(ledgerDirectory),
    mkdir(binDirectory),
  ]);

  const fakePnpm = join(binDirectory, "pnpm");
  await writeFile(
    fakePnpm,
    `#!/bin/sh
printf '%s\n' "$*" >> "$SCHEDULER_CALL_LOG"
case "$*" in
  *"staking-ledger get-root-hash"*)
    [ "${"$"}{FAIL_GET_ROOT:-0}" = "1" ] && exit 9
    ;;
  *"staking-ledger-to-voting-ledger trace-digest"*)
    if [ -n "${"$"}{MUTATE_POINTER_LIFECYCLE_ID:-}" ]; then
      printf '%s\n' "${"$"}MUTATE_POINTER_HASH" > \
        "${"$"}STAKING_LEDGERS_DIRECTORY/lifecycle-${"$"}MUTATE_POINTER_LIFECYCLE_ID.hash"
    fi
    ;;
esac
exit 0
`,
    "utf8",
  );
  await chmod(fakePnpm, 0o755);

  const env = {
    ...process.env,
    PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
    SQLITE_DATA_DIRECTORY: sqliteDirectory,
    STAKING_LEDGERS_DIRECTORY: ledgerDirectory,
    SCHEDULER_CALL_LOG: callLog,
    FAILURE_BACKOFF_BASE_SECONDS: "1",
    FAILURE_BACKOFF_MAX_SECONDS: "1",
  };

  return {
    root,
    sqliteDirectory,
    ledgerDirectory,
    callLog,
    env,
    cleanup: async () => await rm(root, { force: true, recursive: true }),
  };
}

async function runScheduler(args, env) {
  return await execFileAsync("/bin/sh", [SCHEDULER_SCRIPT, ...args], {
    cwd: REPOSITORY_ROOT,
    env,
  });
}

async function writeSnapshot(harness, lifecycleId, hash) {
  await writeFile(join(harness.ledgerDirectory, `${hash}.json`), "[]\n");
  await writeFile(
    join(harness.ledgerDirectory, `lifecycle-${lifecycleId}.hash`),
    `${hash}\n`,
  );
}

test("processes an exact hash-named payload and one-line pointer", async (context) => {
  const harness = await createHarness();
  context.after(harness.cleanup);
  await writeSnapshot(harness, "7", HASH_A);

  await runScheduler(["process-lifecycle", "7"], harness.env);

  const marker = JSON.parse(
    await readFile(join(harness.sqliteDirectory, "7.sqlite.done"), "utf8"),
  );
  assert.equal(marker.lifecycleId, "7");
  assert.equal(marker.ledgerHash, HASH_A);

  const calls = await readFile(harness.callLog, "utf8");
  assert.match(calls, /staking-ledger from-file/);
  assert.match(calls, /staking-ledger get-root-hash/);
  assert.match(calls, /staking-ledger-to-voting-ledger trace-digest/);
});

test("rejects pointer files that are not one hash plus one newline", async (context) => {
  const harness = await createHarness();
  context.after(harness.cleanup);
  await writeFile(join(harness.ledgerDirectory, `${HASH_A}.json`), "[]\n");

  for (const [lifecycleId, pointer] of [
    ["20", HASH_A],
    ["21", `${HASH_A}\n${HASH_B}\n`],
    ["22", ` ${HASH_A}\n`],
  ]) {
    const pointerPath = join(
      harness.ledgerDirectory,
      `lifecycle-${lifecycleId}.hash`,
    );
    await writeFile(pointerPath, pointer);
    await assert.rejects(
      runScheduler(["process-lifecycle", lifecycleId], harness.env),
      /Command failed/,
    );
  }
});

test("rejects a non-numeric lifecycle id", async (context) => {
  const harness = await createHarness();
  context.after(harness.cleanup);

  await assert.rejects(
    runScheduler(["process-lifecycle", "invalid"], harness.env),
    /Command failed/,
  );
  await assert.rejects(readFile(harness.callLog, "utf8"), /ENOENT/);
});

test("waits when a valid pointer has no payload", async (context) => {
  const harness = await createHarness();
  context.after(harness.cleanup);
  await writeFile(
    join(harness.ledgerDirectory, "lifecycle-8.hash"),
    `${HASH_A}\n`,
  );

  const result = await runScheduler(["process-pending"], harness.env);

  assert.match(result.stderr, /is not present yet/);
  await assert.rejects(readFile(harness.callLog, "utf8"), /ENOENT/);
});

test("reports a changed pointer without replacing completed state", async (context) => {
  const harness = await createHarness();
  context.after(harness.cleanup);
  await writeSnapshot(harness, "9", HASH_B);
  const donePath = join(harness.sqliteDirectory, "9.sqlite.done");
  const oldMarker = `${JSON.stringify({ lifecycleId: "9", ledgerHash: HASH_A })}\n`;
  await writeFile(donePath, oldMarker);

  const result = await runScheduler(["process-pending"], harness.env);

  assert.match(result.stderr, /was re-pointed/);
  assert.equal(await readFile(donePath, "utf8"), oldMarker);
  await assert.rejects(readFile(harness.callLog, "utf8"), /ENOENT/);
});

test("does not complete when the pointer changes during processing", async (context) => {
  const harness = await createHarness();
  context.after(harness.cleanup);
  await writeSnapshot(harness, "10", HASH_A);
  await writeFile(join(harness.ledgerDirectory, `${HASH_B}.json`), "[]\n");

  await assert.rejects(
    runScheduler(["process-lifecycle", "10"], {
      ...harness.env,
      MUTATE_POINTER_HASH: HASH_B,
      MUTATE_POINTER_LIFECYCLE_ID: "10",
    }),
    /Command failed/,
  );

  await assert.rejects(
    readFile(join(harness.sqliteDirectory, "10.sqlite.done"), "utf8"),
    /ENOENT/,
  );
  const failure = await readFile(
    join(harness.sqliteDirectory, "10.sqlite.failed"),
    "utf8",
  );
  assert.match(failure, /pointer changed during processing/);
});

test("controlled rebuild retires old readiness and proof markers", async (context) => {
  const harness = await createHarness();
  context.after(harness.cleanup);
  await writeSnapshot(harness, "11", HASH_B);
  const donePath = join(harness.sqliteDirectory, "11.sqlite.done");
  const provenPath = join(harness.sqliteDirectory, "11.sqlite.proven");
  await Promise.all([
    writeFile(donePath, `${JSON.stringify({ ledgerHash: HASH_A })}\n`),
    writeFile(provenPath, "old proof\n"),
  ]);

  await runScheduler(["process-lifecycle", "11"], harness.env);

  const marker = JSON.parse(await readFile(donePath, "utf8"));
  assert.equal(marker.ledgerHash, HASH_B);
  await assert.rejects(readFile(provenPath, "utf8"), /ENOENT/);
});

test("root mismatch leaves no usable completion marker", async (context) => {
  const harness = await createHarness();
  context.after(harness.cleanup);
  await writeSnapshot(harness, "13", HASH_A);

  await assert.rejects(
    runScheduler(["process-lifecycle", "13"], {
      ...harness.env,
      FAIL_GET_ROOT: "1",
    }),
    /Command failed/,
  );

  await assert.rejects(
    readFile(join(harness.sqliteDirectory, "13.sqlite.done"), "utf8"),
    /ENOENT/,
  );
  const failure = await readFile(
    join(harness.sqliteDirectory, "13.sqlite.failed"),
    "utf8",
  );
  assert.match(failure, /root hash mismatch/);
});
