import { it } from "node:test";
import assert from "node:assert";
import { RedisMemoryServer } from "redis-memory-server";
import { Bool, Provable } from "o1js";
import { VoteReducerTracer } from "../../../src/proving/tracing/vote-reducer-tracer.js";
import { VoteReducerProver } from "../../../src/proving/prover/vote-reducer-prover.js";
import { testTaskQueue } from "../test-queue.js";
import { createTestAccounts } from "../../create-test-accounts.js";
import { VotingAccount } from "../../../src/provable/voting-account.js";
import {
  Vote,
  VoteAction,
  VOTE_ACTION_BATCH_SIZE,
} from "../../../src/provable/contracts/treasury-proposal/vote-reducer.js";
import { createSqliteNullifierLedgerStorage } from "../../../src/storage/sqlite/factory/sqlite-nullifier-ledger-storage.js";
import { createSqliteVotingLedgerStorage } from "../../../src/storage/sqlite/factory/sqlite-voting-ledger-storage.js";
import { createSqliteBatchWriter } from "../../../src/storage/sqlite/factory/sqlite-batch-writer.js";
import { createSqliteVoteReducerRunBatchTraceStorage } from "../../../src/storage/sqlite/factory/sqlite-vote-reducer-run-batch-trace-storage.js";
import { createSqliteVoteReducerProofStorage } from "../../../src/storage/sqlite/factory/sqlite-vote-reducer-proof-storage.js";
import { createInMemoryVotingLedgerStorage } from "../../../src/storage/in-memory/factory/in-memory-voting-ledger-storage.js";
import { createInMemoryNullifierLedgerStorage } from "../../../src/storage/in-memory/factory/in-memory-nullifier-ledger-storage.js";
import { InMemoryVotingLedger } from "../../../src/ledgers/voting-ledger/in-memory-voting-ledger.js";
import { InMemoryNullifierLedger } from "../../../src/ledgers/nullifier-ledger/in-memory-nullifier-ledger.js";
import { KeyvSqlite } from "@keyv/sqlite";

it("process vote reducer traces into proofs", async () => {
  const redisServer = new RedisMemoryServer();
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();
  const namespace = `vote-reducer-prover-test-${Date.now()}`;
  const sqliteStore = new KeyvSqlite({ uri: "sqlite://:memory:" });
  const traceStorage = createSqliteVoteReducerRunBatchTraceStorage(
    namespace,
    sqliteStore,
  );
  const proofStorage = createSqliteVoteReducerProofStorage(
    namespace,
    sqliteStore,
  );

  const votingLedgerStorage = createInMemoryVotingLedgerStorage(
    createSqliteVotingLedgerStorage(namespace, sqliteStore),
  );
  const votingLedger = new InMemoryVotingLedger(
    votingLedgerStorage.votingAccountStorage,
    votingLedgerStorage.merkleTreeStorage,
  );
  const nullifierLedgerStorage = createInMemoryNullifierLedgerStorage(
    createSqliteNullifierLedgerStorage(namespace, sqliteStore),
  );
  const nullifierLedger = new InMemoryNullifierLedger(
    nullifierLedgerStorage.nullifierStorage,
    nullifierLedgerStorage.merkleTreeStorage,
  );

  const tracer = new VoteReducerTracer(
    votingLedger,
    nullifierLedger,
    traceStorage,
    createSqliteBatchWriter(sqliteStore),
  );

  const accounts = await createTestAccounts(VOTE_ACTION_BATCH_SIZE * 10);
  for (const account of accounts) {
    const votingAccount = new VotingAccount({ balance: account.balance });
    const publicKey = account.pk.toBase58();
    await votingLedger.setVotingAccount(publicKey, votingAccount);
    await votingLedger.setLeaf(publicKey, votingAccount);
    await nullifierLedger.setLeaf(publicKey, Bool(false));
  }

  const voteActions = accounts.map(
    (account) => new VoteAction({ vote: Vote.YAY, publicKey: account.pk }),
  );

  await tracer.runBatch(voteActions);

  const taskQueue = await testTaskQueue(1, redisHost, redisPort);
  const prover = new VoteReducerProver(
    traceStorage,
    proofStorage,
    createSqliteBatchWriter(sqliteStore),
    taskQueue.queue,
  );

  await prover.runBatch();
  const mergeProof = await prover.merge();

  const expectedYay = accounts.reduce(
    (sum, account) => sum + account.balance.toBigInt(),
    0n,
  );

  Provable.log("merge proof", mergeProof.publicOutput);
  Provable.log("expected yay", expectedYay);

  assert(
    mergeProof.publicOutput.yay.toBigInt() === expectedYay,
    "expected yay total to equal sum of balances",
  );
  assert(
    mergeProof.publicOutput.nay.toBigInt() === 0n,
    "expected nay total to be zero",
  );
  assert(
    mergeProof.publicOutput.abstain.toBigInt() === 0n,
    "expected abstain total to be zero",
  );

  await tracer.close();
  await proofStorage.close();
  taskQueue.killWorkers();
  await taskQueue.queue.close();
  await redisServer.stop();
  await sqliteStore.disconnect();
});
