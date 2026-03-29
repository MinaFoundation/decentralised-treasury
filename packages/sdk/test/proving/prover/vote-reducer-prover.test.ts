import { it } from "node:test";
import assert from "node:assert";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { RedisMemoryServer } from "redis-memory-server";
import { Bool, Field, PrivateKey, Provable, Reducer } from "o1js";
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
import { appendActionToHashList } from "../../../src/provable/hashing-helpers.js";
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

it("process vote reducer traces into proofs", async () => {
  const redisServer = new RedisMemoryServer();
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();
  const lifecycleId = "0";
  const sqliteStore = new KeyvSqlite({ uri: "sqlite://:memory:" });
  const traceStorage = createSqliteVoteReducerRunBatchTraceStorage(
    lifecycleId,
    sqliteStore,
  );
  const proofStorage = createSqliteVoteReducerProofStorage(
    lifecycleId,
    sqliteStore,
  );

  const votingLedgerStorage = createInMemoryVotingLedgerStorage(
    createSqliteVotingLedgerStorage(lifecycleId, sqliteStore),
  );
  const votingLedger = new InMemoryVotingLedger(
    votingLedgerStorage.votingAccountStorage,
    votingLedgerStorage.merkleTreeStorage,
  );
  const nullifierLedgerStorage = createInMemoryNullifierLedgerStorage(
    createSqliteNullifierLedgerStorage(lifecycleId, sqliteStore),
  );
  const nullifierLedger = new InMemoryNullifierLedger(
    nullifierLedgerStorage.nullifierStorage,
    nullifierLedgerStorage.merkleTreeStorage,
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

  const archiveNode = await withMockedFetchActions(voteActions);
  const tracer = new VoteReducerTracer(
    votingLedger,
    nullifierLedger,
    traceStorage,
    createSqliteBatchWriter(sqliteStore),
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

it("returns the base proof when only one run-batch proof exists", async () => {
  const redisServer = new RedisMemoryServer();
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();
  const lifecycleId = "0";
  const sqliteStore = new KeyvSqlite({ uri: "sqlite://:memory:" });
  const traceStorage = createSqliteVoteReducerRunBatchTraceStorage(
    lifecycleId,
    sqliteStore,
  );
  const proofStorage = createSqliteVoteReducerProofStorage(
    lifecycleId,
    sqliteStore,
  );

  const votingLedgerStorage = createInMemoryVotingLedgerStorage(
    createSqliteVotingLedgerStorage(lifecycleId, sqliteStore),
  );
  const votingLedger = new InMemoryVotingLedger(
    votingLedgerStorage.votingAccountStorage,
    votingLedgerStorage.merkleTreeStorage,
  );
  const nullifierLedgerStorage = createInMemoryNullifierLedgerStorage(
    createSqliteNullifierLedgerStorage(lifecycleId, sqliteStore),
  );
  const nullifierLedger = new InMemoryNullifierLedger(
    nullifierLedgerStorage.nullifierStorage,
    nullifierLedgerStorage.merkleTreeStorage,
  );

  const accounts = await createTestAccounts(VOTE_ACTION_BATCH_SIZE);
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
  const archiveNode = await withMockedFetchActions(voteActions);
  const tracer = new VoteReducerTracer(
    votingLedger,
    nullifierLedger,
    traceStorage,
    createSqliteBatchWriter(sqliteStore),
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

  const taskQueue = await testTaskQueue(1, redisHost, redisPort);
  const prover = new VoteReducerProver(
    traceStorage,
    proofStorage,
    createSqliteBatchWriter(sqliteStore),
    taskQueue.queue,
  );

  await prover.runBatch();
  const baseProof = await proofStorage.getProof("0");
  assert(baseProof, "expected base run-batch proof at index 0");

  const mergedOrBaseProof = await prover.merge();
  assert(
    mergedOrBaseProof.publicInput.fromActionsHash.equals(
      baseProof.publicInput.fromActionsHash,
    ),
    "expected merge() to return the single base proof",
  );
  assert(
    mergedOrBaseProof.publicOutput.toActionsHash.equals(
      baseProof.publicOutput.toActionsHash,
    ),
    "expected returned proof output to match base proof output",
  );

  await tracer.close();
  await proofStorage.close();
  taskQueue.killWorkers();
  await taskQueue.queue.close();
  await redisServer.stop();
  await sqliteStore.disconnect();
});
