import { it } from "node:test";
import { RedisMemoryServer } from "redis-memory-server";
import { RedisStakingLedgerToVotingLedgerDigestTraceStorage } from "../../../src/storage/redis/redis-staking-ledger-to-voting-ledger-digest-trace-storage.js";
import { StakingLedgerToVotingLedgerTracer } from "../../../src/proving/tracing/staking-ledger-to-voting-ledger-tracer.js";
import { RedisStakingLedgerToVotingLedgerProofStorage } from "../../../src/storage/redis/redis-staking-ledger-to-voting-ledger-proof-storage.js";
import { StakingLedgerToVotingLedgerProver } from "../../../src/proving/prover/staking-ledger-to-voting-ledger-prover.js";
import { testTaskQueue } from "../test-queue.js";
import assert from "node:assert";
import { RedisStakingLedger } from "../../../src/ledgers/staking-ledger/redis-staking-ledger.js";
import { RedisVotingLedger } from "../../../src/ledgers/voting-ledger/redis-voting-ledger.js";

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
  const votingLedger = new RedisVotingLedger(redisUrl, namespace);

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
  await stakingLedger.hydrateMerkleTree(accounts);

  const tracer = new StakingLedgerToVotingLedgerTracer(
    stakingLedger,
    votingLedger,
    traceStorage
  );

  await tracer.digest(0, 9);
  await prover.digest(0, 9);

  const mergeProof = await prover.merge();

  assert(mergeProof.publicInput.index.toBigint() === 0n);
  assert(mergeProof.publicOutput.index.toBigint() === 49n);

  await stakingLedger.close();
  await votingLedger.close();
  await traceStorage.close();
  await proofStorage.close();
  taskQueue.killWorkers();
  await taskQueue.queue.close();
  await redisServer.stop();
});
