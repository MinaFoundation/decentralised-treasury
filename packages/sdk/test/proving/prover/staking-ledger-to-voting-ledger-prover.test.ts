import { readFileSync } from "node:fs";
import { it } from "node:test";
import { RedisMemoryServer } from "redis-memory-server";
import { RedisStakingLedgerToVotingLedgerDigestTraceStorage } from "../../../src/storage/redis/redis-staking-ledger-to-voting-ledger-digest-trace-storage.js";
import { StakingLedgerToVotingLedgerDigestTrace } from "../../../src/proving/tracing/staking-ledger-to-voting-ledger-tracer.js";
import { RedisStakingLedgerToVotingLedgerProofStorage } from "../../../src/storage/redis/redis-staking-ledger-to-voting-ledger-proof-storage.js";
import { StakingLedgerToVotingLedgerProver } from "../../../src/proving/prover/staking-ledger-to-voting-ledger-prover.js";
import { testTaskQueue } from "../test-queue.js";
import assert from "node:assert";
import { RedisStakingLedger } from "../../../src/ledgers/staking-ledger/redis-staking-ledger.js";
import { Provable } from "o1js";

it("process traces into proofs", async () => {
  const redisServer = new RedisMemoryServer();
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();
  const redisUrl = `redis://${redisHost}:${redisPort}`;
  const namespace = "test-namespace";

  console.log("redis url", redisUrl);

  const traceStorage = new RedisStakingLedgerToVotingLedgerDigestTraceStorage(
    redisUrl,
    namespace
  );

  const proofStorage = new RedisStakingLedgerToVotingLedgerProofStorage(
    redisUrl,
    namespace
  );

  const stakingLedger = new RedisStakingLedger(redisUrl, namespace);

  const taskQueue = await testTaskQueue(1, redisHost, redisPort);

  const prover = new StakingLedgerToVotingLedgerProver(
    stakingLedger,
    traceStorage,
    proofStorage,
    taskQueue.queue
  );

  const accounts = await stakingLedger.readStakingLedger(
    "test/provable/staking-epoch-ledger.json"
  );

  console.log("hydrating staking ledger", accounts.length);
  await stakingLedger.hydrateAccounts(accounts);

  // TODO: find a way to generate the traces dynamically
  const jsonTraces = readFileSync(
    "test/proving/staking-ledger-to-voting-ledger-traces.json",
    "utf8"
  );

  const traces: any[] = JSON.parse(jsonTraces);

  for (const jsonTrace of traces) {
    const trace = StakingLedgerToVotingLedgerDigestTrace.fromJSON(jsonTrace);
    await traceStorage.setTrace(traces.indexOf(jsonTrace), trace);
  }

  await prover.digest(0, 4);

  const mergeProof = await prover.merge();

  assert(mergeProof.publicInput.index.toBigint() === 0n);
  assert(mergeProof.publicOutput.index.toBigint() === 24n);

  await stakingLedger.close();
  await traceStorage.close();
  await proofStorage.close();
  taskQueue.killWorkers();
  await taskQueue.queue.close();
  await redisServer.stop();
});
