import { it } from "node:test";
import assert from "node:assert";
import { Bool, Provable } from "o1js";
import {
  Vote,
  VoteAction,
  VoteReducerPublicInput,
  VOTE_ACTION_BATCH_SIZE,
} from "../../../src/provable/contracts/treasury-proposal/vote-reducer.js";
import { PrefixedMerkleWitness255 } from "../../../src/provable/merkle-tree/prefixed-merkle-tree.js";
import { VotingAccount } from "../../../src/provable/voting-account.js";
import {
  VoteReducerRunBatchTrace,
  VoteReducerTracer,
} from "../../../src/proving/tracing/vote-reducer-tracer.js";
import { createTestAccounts } from "../../create-test-accounts.js";
import { createSqliteNullifierLedgerStorage } from "../../../src/storage/sqlite/factory/sqlite-nullifier-ledger-storage.js";
import { createSqliteVotingLedgerStorage } from "../../../src/storage/sqlite/factory/sqlite-voting-ledger-storage.js";
import { createSqliteBatchWriter } from "../../../src/storage/sqlite/factory/sqlite-batch-writer.js";
import { createSqliteVoteReducerRunBatchTraceStorage } from "../../../src/storage/sqlite/factory/sqlite-vote-reducer-run-batch-trace-storage.js";
import { createInMemoryVotingLedgerStorage } from "../../../src/storage/in-memory/factory/in-memory-voting-ledger-storage.js";
import { createInMemoryNullifierLedgerStorage } from "../../../src/storage/in-memory/factory/in-memory-nullifier-ledger-storage.js";
import { InMemoryVotingLedger } from "../../../src/ledgers/voting-ledger/in-memory-voting-ledger.js";
import { InMemoryNullifierLedger } from "../../../src/ledgers/nullifier-ledger/in-memory-nullifier-ledger.js";
import { KeyvSqlite } from "@keyv/sqlite";

it("should serialize and deserialize a vote reducer trace", async () => {
  const [account] = await createTestAccounts(1);
  const trace = new VoteReducerRunBatchTrace({
    publicInput: VoteReducerPublicInput.empty(),
    privateInput: {
      voteActions: [new VoteAction({ vote: Vote.YAY, publicKey: account.pk })],
    },
    votingLedgerWitnesses: {
      "1": [PrefixedMerkleWitness255.empty()],
    },
    votingAccounts: {
      "1": [VotingAccount.empty()],
    },
    nullifierLedgerWitnesses: {
      "1": [PrefixedMerkleWitness255.empty()],
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
  const lifecycleId = `vote-reducer-trace-test-${Date.now()}`;
  const sqlite = new KeyvSqlite({ uri: "sqlite://:memory:" });

  const votingLedgerStorage = createInMemoryVotingLedgerStorage(
    createSqliteVotingLedgerStorage(lifecycleId, sqlite),
  );
  const votingLedger = new InMemoryVotingLedger(
    votingLedgerStorage.votingAccountStorage,
    votingLedgerStorage.merkleTreeStorage,
  );

  const nullifierLedgerStorage = createInMemoryNullifierLedgerStorage(
    createSqliteNullifierLedgerStorage(lifecycleId, sqlite),
  );
  const nullifierLedger = new InMemoryNullifierLedger(
    nullifierLedgerStorage.nullifierStorage,
    nullifierLedgerStorage.merkleTreeStorage,
  );
  const traceStorage = createSqliteVoteReducerRunBatchTraceStorage(
    lifecycleId,
    sqlite,
  );
  const batchWriter = createSqliteBatchWriter(sqlite);

  const accounts = await createTestAccounts(7);

  for (const account of accounts) {
    const votingAccount = new VotingAccount({ balance: account.balance });
    const publicKey = account.pk.toBase58();
    await votingLedger.setVotingAccount(publicKey, votingAccount);
    await votingLedger.setLeaf(publicKey, votingAccount);
  }

  const setupEntries = votingLedger.collectEntries();
  await batchWriter.setMany(setupEntries);

  const tracer = new VoteReducerTracer(
    votingLedger,
    nullifierLedger,
    traceStorage,
    batchWriter,
  );

  let voteActions: VoteAction[] = [];
  for (const account of accounts) {
    voteActions.push(new VoteAction({ vote: Vote.YAY, publicKey: account.pk }));
  }

  await tracer.runBatch(voteActions);

  const traces = await tracer.traceStorage.getAllTraces();

  Provable.log("trace", traces[0].privateInput.voteActions);

  assert.strictEqual(traces.length, 2);
  assert.strictEqual(
    traces[0].privateInput.voteActions.length,
    VOTE_ACTION_BATCH_SIZE,
  );

  assert.deepStrictEqual(
    traces[0].privateInput.voteActions,
    voteActions.slice(0, VOTE_ACTION_BATCH_SIZE),
  );

  await tracer.close();
  await batchWriter.close();
  await sqlite.disconnect();
});
