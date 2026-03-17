import { it } from "node:test";
import { RedisMemoryServer } from "redis-memory-server";
import { KeyvStakingLedgerToVotingLedgerDigestTraceBatchStorage } from "../../../src/storage/keyv/keyv-staking-ledger-to-voting-ledger-digest-trace-batch-storage.js";
import { StakingLedgerToVotingLedgerTracer } from "../../../src/proving/tracing/staking-ledger-to-voting-ledger-tracer.js";
import { KeyvStakingLedgerToVotingLedgerProofStorage } from "../../../src/storage/keyv/keyv-staking-ledger-to-voting-ledger-proof-storage.js";
import { StakingLedgerToVotingLedgerProver } from "../../../src/proving/prover/staking-ledger-to-voting-ledger-prover.js";
import { testTaskQueue } from "../test-queue.js";
import assert from "node:assert";
import { PersistentStakingLedger } from "../../../src/ledgers/staking-ledger/persistent-staking-ledger.js";
import { InMemoryVotingLedger } from "../../../src/ledgers/voting-ledger/in-memory-voting-ledger.js";
import { SqliteCounter } from "../../../src/storage/sqlite/sqlite-counter.js";
import { createSqliteStakingLedgerStorage } from "../../../src/storage/sqlite/factory/sqlite-staking-ledger-storage.js";
import { createSqliteVotingLedgerStorage } from "../../../src/storage/sqlite/factory/sqlite-voting-ledger-storage.js";
import { KeyvKeyValueBatchStorage } from "../../../src/storage/keyv/keyv-key-value-batch-storage.js";
import { createSqliteKeyv } from "../../../src/storage/sqlite/sqlite-keyv.js";
import { getSqliteDbPath } from "../../../src/storage/sqlite/sqlite-db-path.js";
import { createInMemoryVotingLedgerStorage } from "../../../src/storage/in-memory/factory/in-memory-voting-ledger-storage.js";
import { Provable } from "o1js";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import streamJson from "stream-json";
import StreamArray from "stream-json/streamers/StreamArray.js";
import {
  StakingLedgerToVotingLedgerDigestTrace,
  type StakingLedgerToVotingLedgerDigestTraceJSON,
} from "../../../src/proving/tracing/staking-ledger-to-voting-ledger-tracer.js";

const DIGEST_TRACES_PATH = "test/.data/test-ledger-mini-digest-traces-v2.json";
const MERGE_PROOF_PATH = "test/.data/test-ledger-merge-proof.json";
const RESTORE_COMMIT_INTERVAL = 10;

async function persistTracesToFile(
  filePath: string,
  traceStorage: KeyvStakingLedgerToVotingLedgerDigestTraceBatchStorage,
) {
  await mkdir("test/.data", { recursive: true });

  const outputStream = createWriteStream(filePath, { encoding: "utf8" });
  outputStream.write("[");

  let first = true;
  for (let i = 0; ; i++) {
    const trace = await traceStorage.getTrace(i);
    if (!trace) break;

    const traceJson = StakingLedgerToVotingLedgerDigestTrace.toJSON(trace);
    if (!first) {
      outputStream.write(",");
    }
    first = false;
    outputStream.write(JSON.stringify(traceJson));
  }

  outputStream.write("]");
  await new Promise<void>((resolve, reject) => {
    outputStream.on("finish", () => resolve());
    outputStream.on("error", (error) => reject(error));
    outputStream.end();
  });
}

async function restoreTracesFromFile(
  filePath: string,
  traceStorage: KeyvStakingLedgerToVotingLedgerDigestTraceBatchStorage,
  traceBatchWriter: KeyvKeyValueBatchStorage,
): Promise<boolean> {
  const { parser } = streamJson;
  const { streamArray } = StreamArray;

  return await new Promise<boolean>((resolve) => {
    const readStream = createReadStream(filePath);
    let index = 0;
    let parseQueue = Promise.resolve();

    readStream
      .on("error", () => {
        resolve(false);
      })
      .pipe(parser())
      .pipe(streamArray())
      .on(
        "data",
        ({ value }: { value: StakingLedgerToVotingLedgerDigestTraceJSON }) => {
          parseQueue = parseQueue.then(async () => {
            const trace =
              StakingLedgerToVotingLedgerDigestTrace.fromJSON(value);
            await traceStorage.setTrace(index, trace);
            index++;
            if (index % RESTORE_COMMIT_INTERVAL === 0) {
              const entries = traceStorage.collectEntries();
              await traceBatchWriter.setMany(entries);
              traceStorage.clearEntries();
            }
          });
        },
      )
      .on("end", async () => {
        try {
          await parseQueue;
          const remainingEntries = traceStorage.collectEntries();
          await traceBatchWriter.setMany(remainingEntries);
          traceStorage.clearEntries();
          resolve(index > 0);
        } catch (error) {
          resolve(false);
        }
      })
      .on("error", () => {
        resolve(false);
      });
  });
}

it("process traces into proofs", async () => {
  const redisServer = new RedisMemoryServer();
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();
  const redisUrl = `redis://${redisHost}:${redisPort}`;
  const namespace = `test-namespace-${Date.now()}`;
  const dbPath = getSqliteDbPath(namespace);

  console.log("redis url", redisUrl);

  const counter = new SqliteCounter(dbPath);
  const traceStorage =
    new KeyvStakingLedgerToVotingLedgerDigestTraceBatchStorage(
      createSqliteKeyv(dbPath),
      namespace,
      counter,
    );

  const proofStorage = new KeyvStakingLedgerToVotingLedgerProofStorage(
    () => createSqliteKeyv(dbPath),
    namespace,
    counter,
  );

  const stakingLedgerStorage = createSqliteStakingLedgerStorage(namespace);
  const stakingLedger = new PersistentStakingLedger(
    stakingLedgerStorage.accountStorage,
    stakingLedgerStorage.merkleTreeStorage,
  );
  const votingLedgerStorage = createInMemoryVotingLedgerStorage(
    createSqliteVotingLedgerStorage(namespace),
  );
  const votingLedger = new InMemoryVotingLedger(
    votingLedgerStorage.votingAccountStorage,
    votingLedgerStorage.merkleTreeStorage,
  );
  const traceBatchWriter = new KeyvKeyValueBatchStorage(
    createSqliteKeyv(dbPath),
  );
  const proofBatchWriter = new KeyvKeyValueBatchStorage(
    createSqliteKeyv(dbPath),
  );

  const taskQueue = await testTaskQueue(1, redisHost, redisPort);

  const prover = new StakingLedgerToVotingLedgerProver(
    stakingLedger,
    traceStorage,
    proofStorage,
    proofBatchWriter,
    taskQueue.queue,
  );

  const accounts = await stakingLedger.readStakingLedger(
    "test/test-ledger-mini.json",
  );

  console.log("hydrating staking ledger", accounts.length);
  await stakingLedger.hydrateAccounts(accounts);
  await stakingLedger.hydrateMerkleTree(accounts);

  const tracer = new StakingLedgerToVotingLedgerTracer(
    stakingLedger,
    votingLedger,
    traceStorage,
    traceBatchWriter,
  );

  const restored = await restoreTracesFromFile(
    DIGEST_TRACES_PATH,
    traceStorage,
    traceBatchWriter,
  );
  if (!restored) {
    console.log("tracing digest");
    await tracer.digest(0, 9);
    console.log("persisting traces");
    await persistTracesToFile(DIGEST_TRACES_PATH, traceStorage);
  }
  await prover.digest(0, 9);

  const mergeProof = await prover.merge();

  Provable.log("merge proof", mergeProof.toJSON());
  await mkdir("test/.data", { recursive: true });
  await writeFile(MERGE_PROOF_PATH, JSON.stringify(mergeProof.toJSON()));

  // assert(mergeProof.publicInput.index.toBigInt() === 0n);
  // assert(mergeProof.publicOutput.index.toBigInt() === 49n);

  await stakingLedger.close();
  await votingLedger.close();
  await traceStorage.close();
  await traceBatchWriter.close();
  await proofBatchWriter.close();
  await proofStorage.close();
  taskQueue.killWorkers();
  await taskQueue.queue.close();
  await redisServer.stop();
});
