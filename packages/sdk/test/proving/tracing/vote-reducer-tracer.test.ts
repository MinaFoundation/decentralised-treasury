import { it } from "node:test";
import assert from "node:assert";
import { RedisMemoryServer } from "redis-memory-server";
import { Bool, Provable } from "o1js";
import {
  Vote,
  VoteAction,
  VoteReducerPublicInput,
  VOTE_ACTION_BATCH_SIZE,
} from "../../../src/provable/contracts/treasury-proposal/vote-reducer.js";
import { PrefixedMerkleWitness256 } from "../../../src/provable/merkle-tree/prefixed-merkle-tree.js";
import { VotingAccount } from "../../../src/provable/voting-account.js";
import {
  VoteReducerRunBatchTrace,
  VoteReducerTracer,
} from "../../../src/proving/tracing/vote-reducer-tracer.js";
import { RedisVotingLedger } from "../../../src/ledgers/voting-ledger/redis-voting-ledger.js";
import { RedisNullifierLedger } from "../../../src/ledgers/nullifier-ledger/redis-nullifier-ledger.js";
import { RedisVoteReducerRunBatchTraceStorage } from "../../../src/storage/redis/redis-vote-reducer-run-batch-trace-storage.js";
import { createTestAccounts } from "../../../src/create-test-accounts.js";

it("should serialize and deserialize a vote reducer trace", async () => {
  const [account] = await createTestAccounts(1);
  const trace = new VoteReducerRunBatchTrace({
    publicInput: VoteReducerPublicInput.empty(),
    privateInput: {
      voteActions: [
        new VoteAction({ vote: Vote.YAY, publicKey: account.publicKey }),
      ],
    },
    votingLedgerWitnesses: {
      "1": [PrefixedMerkleWitness256.empty()],
    },
    votingAccounts: {
      "1": [VotingAccount.empty()],
    },
    nullifierLedgerWitnesses: {
      "1": [PrefixedMerkleWitness256.empty()],
    },
    nullifiers: {
      "1": [Bool(true)],
    },
  });

  const serializedTrace = VoteReducerRunBatchTrace.toJSON(trace);
  const deserializedTrace = VoteReducerRunBatchTrace.fromJSON(serializedTrace);

  assert.deepStrictEqual(deserializedTrace, trace);
});

it("should trace vote reducer batches", async () => {
  const redisServer = new RedisMemoryServer();
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();
  const redisUrl = `redis://${redisHost}:${redisPort}`;
  const lifecycleId = "vote-reducer-trace-test";

  const votingLedger = new RedisVotingLedger(redisUrl, lifecycleId);
  const nullifierLedger = new RedisNullifierLedger(redisUrl, lifecycleId);
  const traceStorage = new RedisVoteReducerRunBatchTraceStorage(
    redisUrl,
    lifecycleId
  );

  const accounts = await createTestAccounts(7);

  for (const account of accounts) {
    const votingAccount = new VotingAccount({ balance: account.balance });
    const publicKey = account.publicKey.toBase58();
    await votingLedger.setVotingAccount(publicKey, votingAccount);
    await votingLedger.setLeaf(publicKey, votingAccount);
  }

  const tracer = new VoteReducerTracer(
    votingLedger,
    nullifierLedger,
    traceStorage
  );

  let voteActions: VoteAction[] = [];
  for (const account of accounts) {
    voteActions.push(
      new VoteAction({ vote: Vote.YAY, publicKey: account.publicKey })
    );
  }

  await tracer.runBatch(voteActions);

  const traces = await tracer.traceStorage.getAllTraces();

  Provable.log("trace", traces[0].privateInput.voteActions);

  assert.strictEqual(traces.length, 2);
  assert.strictEqual(
    traces[0].privateInput.voteActions.length,
    VOTE_ACTION_BATCH_SIZE
  );

  assert.deepStrictEqual(
    traces[0].privateInput.voteActions,
    voteActions.slice(0, VOTE_ACTION_BATCH_SIZE)
  );

  await tracer.close();
  await redisServer.stop();
});
