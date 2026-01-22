import { it } from "node:test";
import assert from "node:assert";
import { RedisMemoryServer } from "redis-memory-server";
import { Bool, Provable } from "o1js";
import { RedisVoteReducerRunBatchTraceStorage } from "../../../src/storage/redis/redis-vote-reducer-run-batch-trace-storage.js";
import { RedisVoteReducerProofStorage } from "../../../src/storage/redis/redis-vote-reducer-proof-storage.js";
import { VoteReducerTracer } from "../../../src/proving/tracing/vote-reducer-tracer.js";
import { VoteReducerProver } from "../../../src/proving/prover/vote-reducer-prover.js";
import { testTaskQueue } from "../test-queue.js";
import { RedisVotingLedger } from "../../../src/ledgers/voting-ledger/redis-voting-ledger.js";
import { RedisNullifierLedger } from "../../../src/ledgers/nullifier-ledger/redis-nullifier-ledger.js";
import { createTestAccounts } from "../../../src/create-test-accounts.js";
import { VotingAccount } from "../../../src/provable/voting-account.js";
import {
  Vote,
  VoteAction,
  VOTE_ACTION_BATCH_SIZE,
} from "../../../src/provable/contracts/treasury-proposal/vote-reducer.js";

it("process vote reducer traces into proofs", async () => {
  const redisServer = new RedisMemoryServer();
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();
  const redisUrl = `redis://${redisHost}:${redisPort}`;
  const namespace = "vote-reducer-prover-test";

  const traceStorage = new RedisVoteReducerRunBatchTraceStorage(
    redisUrl,
    namespace
  );
  const proofStorage = new RedisVoteReducerProofStorage(redisUrl, namespace);

  const votingLedger = new RedisVotingLedger(redisUrl, namespace);
  const nullifierLedger = new RedisNullifierLedger(redisUrl, namespace);

  const tracer = new VoteReducerTracer(
    votingLedger,
    nullifierLedger,
    traceStorage
  );

  const accounts = await createTestAccounts(VOTE_ACTION_BATCH_SIZE * 10);
  for (const account of accounts) {
    const votingAccount = new VotingAccount({ balance: account.balance });
    const publicKey = account.publicKey.toBase58();
    await votingLedger.setVotingAccount(publicKey, votingAccount);
    await votingLedger.setLeaf(publicKey, votingAccount);
    await nullifierLedger.setLeaf(publicKey, Bool(false));
  }

  const voteActions = accounts.map(
    (account) =>
      new VoteAction({ vote: Vote.YAY, publicKey: account.publicKey })
  );

  await tracer.runBatch(voteActions);

  const taskQueue = await testTaskQueue(1, redisHost, redisPort);
  const prover = new VoteReducerProver(
    traceStorage,
    proofStorage,
    taskQueue.queue
  );

  await prover.runBatch();
  const mergeProof = await prover.merge();

  const expectedYay = accounts.reduce(
    (sum, account) => sum + account.balance.toBigInt(),
    0n
  );

  Provable.log("merge proof", mergeProof.publicOutput);
  Provable.log("expected yay", expectedYay);

  assert(
    mergeProof.publicOutput.yay.toBigInt() === expectedYay,
    "expected yay total to equal sum of balances"
  );
  assert(
    mergeProof.publicOutput.nay.toBigInt() === 0n,
    "expected nay total to be zero"
  );
  assert(
    mergeProof.publicOutput.abstain.toBigInt() === 0n,
    "expected abstain total to be zero"
  );

  await votingLedger.close();
  await nullifierLedger.close();
  await traceStorage.close();
  await proofStorage.close();
  taskQueue.killWorkers();
  await taskQueue.queue.close();
  await redisServer.stop();
});
