import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
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
import { createInterface } from "node:readline";
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
  const callLog = join(root, "cli-calls.log");
  await Promise.all([
    mkdir(sqliteDirectory),
    mkdir(ledgerDirectory),
    mkdir(binDirectory),
  ]);

  const fakeNode = join(binDirectory, "node");
  await writeFile(
    fakeNode,
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
  await chmod(fakeNode, 0o755);

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

test(
  "container SIGTERM reaches trace-digest and waits for its checkpoint and SQLite close",
  { timeout: 30_000 },
  async (context) => {
    const harness = await createHarness();
    context.after(harness.cleanup);
    await writeSnapshot(harness, "17", HASH_A);
    const eventLog = join(harness.root, "shutdown-events.log");
    const preload = join(harness.root, "trace-service.mjs");
    // Keep the real shell, launcher, CLI command, and shutdown handler. Replace
    // external services so the subprocess test needs no S3 or proof generation.
    await writeFile(
      preload,
      String.raw`
import { appendFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
if (process.argv[1]?.endsWith("/src/cli.ts")) {
  if (!process.argv.includes("trace-digest")) {
    if (process.argv.includes("checkpoint-restore")) console.log("FRESH");
    process.exit(0);
  }
  const root = process.env.SHUTDOWN_REPOSITORY_ROOT;
  const { SqliteStakingLedgerToVotingLedgerService: Service } = await import(
    pathToFileURL(join(root, "packages/sdk/src/services/sqlite/sqlite-staking-ledger-to-voting-ledger-service.ts")).href
  );
  const require = createRequire(join(root, "apps/cli/package.json"));
  const { Upload } = await import(require.resolve("@aws-sdk/lib-storage"));
  const record = (event) => appendFileSync(process.env.SHUTDOWN_EVENT_LOG, event + "\n");
  const database = join(process.env.SQLITE_DATA_DIRECTORY, "17.sqlite");
  Service.prototype.start = async () => { await writeFile(database, "initial"); };
  Service.prototype.writeCheckpointLedgerHash = async () => {};
  Service.prototype.checkpointWal = async () => { record("wal"); };
  Service.prototype.traceDigest = async (_start, _end, complete) => {
    console.log("TRACE_READY");
    for (let index = 0; index < 1000; index++) {
      await delay(25);
      await writeFile(database, "batch " + index);
      record("batch " + index);
      complete(index);
    }
  };
  Upload.prototype.done = async function () {
    const chunks = [];
    for await (const chunk of this.params.Body) chunks.push(Buffer.from(chunk));
    record("upload " + Buffer.concat(chunks).toString());
    return {};
  };
  Service.prototype.close = async () => {
    await delay(100);
    record("closed");
  };
  process.on("exit", (code) => record("exit " + code));
}
`,
    );
    const scheduler = spawn("/bin/sh", [SCHEDULER_SCRIPT], {
      cwd: REPOSITORY_ROOT,
      detached: true,
      env: {
        ...harness.env,
        PATH: process.env.PATH,
        NODE_OPTIONS: `--import=${preload}`,
        NODE_NO_WARNINGS: "1",
        SHUTDOWN_REPOSITORY_ROOT: REPOSITORY_ROOT,
        SHUTDOWN_EVENT_LOG: eventLog,
        CHECKPOINT_INTERVAL: "100000",
        CHECKPOINT_S3_URI: "s3://test/checkpoints",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    context.after(() => {
      try {
        process.kill(-scheduler.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    });
    let output = "";
    scheduler.stdout.on("data", (chunk) => {
      output += chunk;
    });
    scheduler.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const exited = new Promise((resolve) =>
      scheduler.once("close", (code, signal) => resolve({ code, signal })),
    );
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Trace readiness timed out: ${output}`)),
        10_000,
      );
      context.after(() => clearTimeout(timer));
      const lines = createInterface({ input: scheduler.stdout });
      lines.on("line", (line) => {
        if (line === "TRACE_READY") {
          clearTimeout(timer);
          resolve();
        }
      });
      scheduler.once("error", reject);
      scheduler.once("close", () =>
        reject(new Error(`Scheduler exited before trace readiness: ${output}`)),
      );
    });
    scheduler.kill("SIGTERM");
    assert.deepEqual(await exited, { code: 143, signal: null }, output);
    const events = (await readFile(eventLog, "utf8")).trim().split("\n");
    const lastBatch = events
      .filter((event) => event.startsWith("batch "))
      .at(-1);
    assert(lastBatch, output);
    assert.deepEqual(events.slice(-4), [
      "wal",
      `upload ${lastBatch}`,
      "closed",
      "exit 143",
    ]);
    await assert.rejects(
      readFile(join(harness.sqliteDirectory, "17.sqlite.done")),
      /ENOENT/,
    );
    assert.doesNotMatch(
      output,
      /cycle summary|checkpoint-clean|trace-digest done for/,
    );
  },
);
