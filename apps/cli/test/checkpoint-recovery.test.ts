import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { SqliteStakingLedgerToVotingLedgerService as Service } from "@repo/sdk/src/services/sqlite/sqlite-staking-ledger-to-voting-ledger-service.js";
import { pullCheckpoint } from "../src/lib/s3-checkpoint.js";
import {
  checkpointRestore,
  traceDigest,
} from "../src/commands/staking-ledger-to-voting-ledger.js";

async function directory(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "checkpoint-recovery-"));
  const previous = process.env.SQLITE_DATA_DIRECTORY;
  process.env.SQLITE_DATA_DIRECTORY = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.SQLITE_DATA_DIRECTORY;
    else process.env.SQLITE_DATA_DIRECTORY = previous;
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

const s3Uri = "s3://checkpoints/test";

test("restores the saved trace count despite stale SQLite sidecars", async (t) => {
  const root = await directory(t);
  const sourcePath = join(root, "source.sqlite");
  const destination = join(root, "42.sqlite");
  const db = new DatabaseSync(sourcePath);
  let checkpoint: Buffer;
  try {
    db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE keyv (key VARCHAR(255) PRIMARY KEY, value TEXT);
      CREATE TABLE checkpoint_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO checkpoint_meta VALUES ('ledgerHash', 'expected-ledger');
      INSERT INTO keyv VALUES ('staking-ledger-to-voting-ledger-42-traces:0', '{}');
      INSERT INTO keyv VALUES ('staking-ledger-to-voting-ledger-42-traces:1', '{}');
      PRAGMA wal_checkpoint(TRUNCATE);`);
    checkpoint = await readFile(sourcePath);
    db.exec(
      `INSERT INTO keyv VALUES ('staking-ledger-to-voting-ledger-42-traces:2', '{}');`,
    );
    await copyFile(sourcePath, destination);
    for (const suffix of ["-wal", "-shm"]) {
      await copyFile(`${sourcePath}${suffix}`, `${destination}${suffix}`);
    }
    await writeFile(`${destination}-journal`, "interrupted journal");
  } finally {
    db.close();
  }
  t.mock.method(S3Client.prototype, "send", async () => ({
    Body: Readable.from(checkpoint),
  }));
  const output: string[] = [];
  t.mock.method(process.stdout, "write", (chunk: string | Uint8Array) => {
    output.push(String(chunk));
    return true;
  });
  await checkpointRestore({
    lifecycleId: "42",
    expectedLedgerHash: "expected-ledger",
    s3Uri,
  });
  assert(output.some((chunk) => chunk.includes("RESUME_INDEX=2\n")));
  const restored = new Service({ lifecycleId: "42" });
  await restored.start();
  try {
    assert.equal(await restored.getTracedIndexCount(), 2);
    assert.equal(await restored.readCheckpointLedgerHash(), "expected-ledger");
  } finally {
    await restored.close();
  }
  assert(!(await readdir(root)).some((name) => name.endsWith(".restore")));
});

for (const failure of ["missing", "download", "sidecar"]) {
  test(`restore ${failure} preserves the old database and removes temporary files`, async (t) => {
    const root = await directory(t);
    const destination = join(root, "42.sqlite");
    await writeFile(destination, "original database");
    if (failure === "sidecar") await mkdir(`${destination}-wal`);
    else await writeFile(`${destination}-wal`, "original WAL");
    t.mock.method(S3Client.prototype, "send", async () => {
      if (failure === "missing")
        throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
      return {
        Body:
          failure === "download"
            ? Readable.from(
                (async function* () {
                  yield "partial database";
                  throw new Error("download interrupted");
                })(),
              )
            : Readable.from("replacement database"),
      };
    });
    if (failure === "missing")
      assert.equal(await pullCheckpoint(s3Uri, "42", destination), false);
    else
      await assert.rejects(
        pullCheckpoint(s3Uri, "42", destination),
        failure === "download" ? /download interrupted/ : /EISDIR/,
      );
    assert.equal(await readFile(destination, "utf8"), "original database");
    if (failure !== "sidecar")
      assert.equal(
        await readFile(`${destination}-wal`, "utf8"),
        "original WAL",
      );
    assert(!(await readdir(root)).some((name) => name.endsWith(".restore")));
  });
}

test("SIGTERM drains the prior upload, saves the final batch, and closes before exit", async (t) => {
  const root = await directory(t);
  const priorExitCode = process.exitCode;
  const listeners = process.listenerCount("SIGTERM");
  t.after(() => {
    process.exitCode = priorExitCode;
  });
  const events: string[] = [];
  let announceUpload!: () => void;
  const uploadStarted = new Promise<void>((resolve) => {
    announceUpload = resolve;
  });
  let releaseUpload!: () => void;
  const uploadReleased = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  let uploads = 0;
  t.mock.method(Service.prototype, "start", async () => {
    await writeFile(join(root, "42.sqlite"), "batch 0");
  });
  t.mock.method(Service.prototype, "checkpointWal", async () => {
    events.push("checkpoint");
  });
  t.mock.method(Upload.prototype, "done", async function (this: Upload) {
    const number = ++uploads;
    const body = (this as unknown as { params: { Body: Readable } }).params
      .Body;
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    events.push(`upload ${number}: ${Buffer.concat(chunks).toString()}`);
    if (number === 1) {
      announceUpload();
      await uploadReleased;
    }
    events.push(`uploaded ${number}`);
    return {};
  });
  t.mock.method(
    Service.prototype,
    "traceDigest",
    async (_start, _end, complete) => {
      complete!(0, undefined!, undefined!);
      await uploadStarted;
      await writeFile(join(root, "42.sqlite"), "batch 1");
      process.emit("SIGTERM", "SIGTERM");
      setImmediate(releaseUpload);
      complete!(1, undefined!, undefined!);
      assert.fail("tracing continued after SIGTERM");
    },
  );
  t.mock.method(Service.prototype, "close", async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(process.exitCode, priorExitCode);
    events.push("closed");
  });
  await traceDigest({
    lifecycleId: "42",
    checkpointInterval: 1,
    checkpointS3Uri: s3Uri,
  });
  assert.deepEqual(events, [
    "checkpoint",
    "upload 1: batch 0",
    "uploaded 1",
    "checkpoint",
    "upload 2: batch 1",
    "uploaded 2",
    "closed",
  ]);
  assert.equal(process.exitCode, 143);
  assert.equal(process.listenerCount("SIGTERM"), listeners);
});

test("SIGTERM also closes the database when checkpoints are disabled", async (t) => {
  const priorExitCode = process.exitCode;
  t.after(() => {
    process.exitCode = priorExitCode;
  });
  t.mock.method(Service.prototype, "start", async () => {});
  t.mock.method(
    Service.prototype,
    "traceDigest",
    async (_start, _end, complete) => {
      process.emit("SIGTERM", "SIGTERM");
      complete!(0, undefined!, undefined!);
      assert.fail("tracing continued after SIGTERM");
    },
  );
  const close = t.mock.method(Service.prototype, "close", async () => {
    assert.equal(process.exitCode, priorExitCode);
  });
  await traceDigest({ lifecycleId: "42" });
  assert.equal(close.mock.callCount(), 1);
  assert.equal(process.exitCode, 143);
});

test("SIGTERM remains handled during delayed closure, including a close failure", async (t) => {
  const priorExitCode = process.exitCode;
  const listeners = process.listenerCount("SIGTERM");
  t.after(() => {
    process.exitCode = priorExitCode;
  });
  t.mock.method(Service.prototype, "start", async () => {});
  t.mock.method(Service.prototype, "traceDigest", async () => {});
  const failure = new Error("database close failed");
  t.mock.method(Service.prototype, "close", async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(process.emit("SIGTERM", "SIGTERM"), true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(process.exitCode, priorExitCode);
    throw failure;
  });
  await assert.rejects(
    traceDigest({ lifecycleId: "42" }),
    (error) => error === failure,
  );
  assert.equal(process.exitCode, 143);
  assert.equal(process.listenerCount("SIGTERM"), listeners);
});
