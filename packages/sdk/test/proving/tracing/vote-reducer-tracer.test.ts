import { it } from "node:test";
import assert from "node:assert";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Bool, Field, PrivateKey, Provable, Reducer } from "o1js";
import {
  Vote,
  VoteAction,
  VoteReducerPublicInput,
  VOTE_ACTION_BATCH_SIZE,
} from "../../../src/provable/contracts/treasury-proposal/vote-reducer.js";
import { appendActionToHashList } from "../../../src/provable/hashing-helpers.js";
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

function createArchiveActionHashes(voteActions: VoteAction[]) {
  let actionHash = Reducer.initialActionState;
  return voteActions
    .filter((voteAction) => !VoteAction.isDummy(voteAction).toBoolean())
    .map((voteAction) => {
      actionHash = appendActionToHashList(actionHash, VoteAction.toFields(voteAction));
      return {
        actions: [VoteAction.toFields(voteAction).map((field) => field.toString())],
        hash: actionHash.toString(),
      };
    });
}

async function withMockedFetchActions<T>(
  voteActions: VoteAction[],
): Promise<{ archiveNodeUrl: string; close: () => Promise<void> }> {
  const actionStates = [
    Reducer.initialActionState.toString(),
    ...createArchiveActionHashes(voteActions).map(({ hash }) => hash),
  ];
  const responseBody = JSON.stringify({
    data: {
      actions: [
        {
          blockInfo: { distanceFromMaxBlockHeight: 0 },
          actionState: {
            actionStateOne:
              actionStates.at(-1) ?? Reducer.initialActionState.toString(),
            actionStateTwo:
              actionStates.at(-2) ?? Reducer.initialActionState.toString(),
            actionStateThree:
              actionStates.at(-3) ?? Reducer.initialActionState.toString(),
            actionStateFour:
              actionStates.at(-4) ?? Reducer.initialActionState.toString(),
            actionStateFive:
              actionStates.at(-5) ?? Reducer.initialActionState.toString(),
          },
          actionData: voteActions
            .filter((voteAction) => !VoteAction.isDummy(voteAction).toBoolean())
            .map((voteAction, index) => ({
              accountUpdateId: String(index + 1),
              data: VoteAction.toFields(voteAction).map((field) => field.toString()),
            })),
        },
      ],
    },
  });
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(responseBody);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    archiveNodeUrl: `http://127.0.0.1:${port}/graphql`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

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
  const lifecycleId = "0";
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

  let voteActions: VoteAction[] = [];
  for (const account of accounts) {
    voteActions.push(new VoteAction({ vote: Vote.YAY, publicKey: account.pk }));
  }

  const archiveNode = await withMockedFetchActions(voteActions);
  const tracer = new VoteReducerTracer(
    votingLedger,
    nullifierLedger,
    traceStorage,
    batchWriter,
    {
      archiveNodeUrl: archiveNode.archiveNodeUrl,
      proposalPublicKey: PrivateKey.random().toPublicKey().toBase58(),
      proposalTokenId: Field(1).toString(),
    },
  );

  try {
    await tracer.runBatch(voteActions);
  } finally {
    await archiveNode.close();
  }

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

it("should require archive metadata for tracing", async () => {
  const lifecycleId = "missing-archive-metadata";
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
  const [account] = await createTestAccounts(1);
  const tracer = new VoteReducerTracer(
    votingLedger,
    nullifierLedger,
    traceStorage,
    batchWriter,
  );

  await assert.rejects(
    () => tracer.runBatch([new VoteAction({ vote: Vote.YAY, publicKey: account.pk })]),
    /requires archiveNodeUrl, proposalPublicKey, and proposalTokenId/,
  );

  await tracer.close();
  await batchWriter.close();
  await sqlite.disconnect();
});
