import assert from "node:assert";
import { it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KeyvSqlite } from "@keyv/sqlite";
import { Field, PrivateKey, Reducer, TokenId, UInt64, setNumberOfWorkers } from "o1js";
import { getVoteReducerScope } from "../../src/services/sqlite/sqlite-vote-reducer-service.js";
import {
  Vote,
  VoteAction,
  VoteReducer,
  VoteReducerProof,
  SideLoadedVoteReducerProof,
} from "../../src/provable/contracts/treasury-proposal/vote-reducer.js";
import { VoteReducerRunBatchTask } from "../../src/proving/tasks/vote-reducer-run-batch-task.js";
import { VoteReducerMergeTask } from "../../src/proving/tasks/vote-reducer-merge-task.js";
import { createSqliteVotingLedgerStorage } from "../../src/storage/sqlite/factory/sqlite-voting-ledger-storage.js";
import { createSqliteNullifierLedgerStorage } from "../../src/storage/sqlite/factory/sqlite-nullifier-ledger-storage.js";
import { createSqliteVoteReducerRunBatchTraceStorage } from "../../src/storage/sqlite/factory/sqlite-vote-reducer-run-batch-trace-storage.js";
import { createSqliteVoteReducerProofStorage } from "../../src/storage/sqlite/factory/sqlite-vote-reducer-proof-storage.js";
import { createSqliteBatchWriter } from "../../src/storage/sqlite/factory/sqlite-batch-writer.js";
import { getSqliteDbPath } from "../../src/storage/sqlite/sqlite-db-path.js";
import { PersistentVotingLedger } from "../../src/ledgers/voting-ledger/persistent-voting-ledger.js";
import { PersistentNullifierLedger } from "../../src/ledgers/nullifier-ledger/persistent-nullifier-ledger.js";
import { VotingAccount } from "../../src/provable/voting-account.js";
import { appendActionToHashList } from "../../src/provable/hashing-helpers.js";
import { SqliteVoteReducerService } from "../../src/services/sqlite/sqlite-vote-reducer-service.js";

it("supports compile", async () => {
  if (process.env.PROOFS_ENABLED === "true") setNumberOfWorkers(2);
  const service = new SqliteVoteReducerService({
    lifecycleId: "sqlite-vote-reducer-service-compile",
    redisConnection: { host: "127.0.0.1", port: 6379 },
  });

  await service.compile({ proofsEnabled: process.env.PROOFS_ENABLED === "true" });
});

it("creates tracer in start and defers prover/task queue to proving", async () => {
  const redisConnection = { host: "127.0.0.1", port: 6379 };
  const service = new SqliteVoteReducerService({
    lifecycleId: "sqlite-vote-reducer-service",
    proposalPublicKey: PrivateKey.fromBigInt(100n).toPublicKey().toBase58(),
    proposalTokenId: "1",
    redisConnection,
  });
  await service.start();

  // start() should only initialize tracing dependencies.
  assert((service as any).tracer, "expected tracer to be initialized");
  assert.strictEqual((service as any).prover, undefined);
  assert.strictEqual((service as any).taskQueue, undefined);

  await service.close();
});

it("isolates Proposal traces, nullifiers, proofs, restart, and clearing in one lifecycle", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "vote-reducer-scope-"));
  const previousDirectory = process.env.SQLITE_DATA_DIRECTORY;
  process.env.SQLITE_DATA_DIRECTORY = directory;
  t.after(async () => {
    if (previousDirectory === undefined)
      delete process.env.SQLITE_DATA_DIRECTORY;
    else process.env.SQLITE_DATA_DIRECTORY = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  });
  const lifecycleId = "same-lifecycle";
  const voter = PrivateKey.fromBigInt(101n).toPublicKey();
  const optionsA = {
    lifecycleId,
    proposalPublicKey: PrivateKey.fromBigInt(102n).toPublicKey().toBase58(),
    proposalTokenId: "1",
  };
  const optionsB = {
    ...optionsA,
    proposalPublicKey: PrivateKey.fromBigInt(103n).toPublicKey().toBase58(),
  };
  const scopeA = getVoteReducerScope(optionsA);
  const scopeB = getVoteReducerScope(optionsB);
  assert.notEqual(scopeA, scopeB);
  assert.notEqual(
    scopeA,
    getVoteReducerScope({ ...optionsA, proposalTokenId: "2" }),
  );
  assert.notEqual(
    scopeA,
    getVoteReducerScope({ ...optionsA, lifecycleId: "other" }),
  );
  assert.equal(
    scopeA,
    getVoteReducerScope({
      ...optionsA,
      proposalTokenId: TokenId.toBase58(Field(1)),
    }),
  );
  assert.throws(
    () => getVoteReducerScope({ lifecycleId }),
    /requires proposalPublicKey/,
  );
  assert.throws(() =>
    getVoteReducerScope({ ...optionsA, proposalTokenId: "invalid" }),
  );
  assert.throws(() =>
    getVoteReducerScope({ ...optionsA, proposalPublicKey: "invalid" }),
  );
  assert.throws(() =>
    getVoteReducerScope({
      ...optionsA,
      proposalTokenId: Field.ORDER.toString(),
    }),
  );

  const sqlite = new KeyvSqlite({ uri: getSqliteDbPath(lifecycleId) });
  t.after(() => sqlite.disconnect());
  const votingStorage = createSqliteVotingLedgerStorage(lifecycleId, sqlite);
  const votingLedger = new PersistentVotingLedger(
    votingStorage.votingAccountStorage,
    votingStorage.merkleTreeStorage,
  );
  const account = new VotingAccount({ balance: UInt64.from(10) });
  await votingLedger.setVotingAccount(voter.toBase58(), account);
  await votingLedger.setLeaf(voter.toBase58(), account);
  const votingRoot = (await votingLedger.getRoot()).toString();
  const writer = createSqliteBatchWriter(sqlite);
  const legacy = createSqliteNullifierLedgerStorage(lifecycleId, sqlite);
  await legacy.nullifierStorage.setNullifier(voter.toBase58(), true);

  const reader = new SqliteVoteReducerService({ lifecycleId });
  await reader.start();
  t.after(() => reader.close());
  assert.equal(await reader.getVoteWeight(voter.toBase58()), 10n);
  await assert.rejects(reader.traceRunBatch([]), /requires proposalPublicKey/);
  await assert.rejects(reader.proveRunBatch(), /requires proposalPublicKey/);
  await assert.rejects(reader.proveMerge(), /requires proposalPublicKey/);
  await assert.rejects(
    reader.clearPersistentState(),
    /requires proposalPublicKey/,
  );

  const stores = [scopeA, scopeB].map((scope) => ({
    traces: createSqliteVoteReducerRunBatchTraceStorage(scope, sqlite),
    proofs: createSqliteVoteReducerProofStorage(scope, sqlite),
    nullifiers: createSqliteNullifierLedgerStorage(scope, sqlite),
  }));
  let emptyRoot: string | undefined;
  for (const [index, options] of [optionsA, optionsB].entries()) {
    const { traces, proofs, nullifiers } = stores[index]!;
    const ledger = new PersistentNullifierLedger(
      nullifiers.nullifierStorage,
      nullifiers.merkleTreeStorage,
    );
    emptyRoot ??= (await ledger.getRoot()).toString();
    assert.equal((await ledger.getRoot()).toString(), emptyRoot);
    const actions = Array.from(
      { length: index === 0 ? 6 : 5 },
      () =>
        new VoteAction({
          publicKey: voter,
          vote: index === 0 ? Vote.YAY : Vote.NAY,
        }),
    );
    let hash = Reducer.initialActionState;
    const hashes = actions.map((action) =>
      (hash = appendActionToHashList(
        hash,
        VoteAction.toFields(action),
      )).toString(),
    );
    const actionStateHistoryTarget = Object.fromEntries(
      ["One", "Two", "Three", "Four", "Five"].map((name, offset) => [
        `actionState${name}`,
        hashes.at(-1 - offset)!,
      ]),
    ) as any;
    const service = new SqliteVoteReducerService({
      ...options,
      actionStateHistoryTarget,
    });
    await service.start();
    try {
      await service.traceRunBatch(actions);
      await assert.rejects(service.traceRunBatch(actions), /already exists/);
      assert.notEqual((await ledger.getRoot()).toString(), emptyRoot);
    } finally {
      await service.close();
    }
    const recorded = await traces.getAllTraces();
    assert.equal(recorded.length, index === 0 ? 2 : 1);
    assert.equal(
      recorded[0]!.publicInput.fromNullifierRoot.toString(),
      emptyRoot,
    );
    const proved = [];
    for (const [traceId, trace] of recorded.entries()) {
      const { proof } = await VoteReducerRunBatchTask.run({ trace, traceId });
      const sideLoaded = SideLoadedVoteReducerProof.fromProof(proof);
      proved.push(sideLoaded);
      await proofs.setProof(String(traceId), sideLoaded);
    }
    const root =
      proved.length === 1
        ? proved[0]!
        : (
            await VoteReducerMergeTask.run({
              proofs: { 1: proved[0]!, 2: proved[1]! },
            })
          ).proof;
    if (process.env.PROOFS_ENABLED === "true") {
      assert(await VoteReducer.verify(await VoteReducerProof.fromJSON(root.toJSON())));
    }
    assert.equal(root.publicOutput.yay.toBigInt(), index === 0 ? 10n : 0n);
    assert.equal(root.publicOutput.nay.toBigInt(), index === 1 ? 10n : 0n);
    await proofs.setMergeProof("root", root);
    await proofs.markAsMerged("0");
    await writer.setMany(proofs.collectEntries());
    proofs.clearEntries();
  }
  assert.equal(await stores[0]!.traces.count(), 2);
  assert.equal(await stores[0]!.proofs.count(), 2);
  assert.equal(await stores[1]!.proofs.count(), 1);
  assert.equal(
    (await stores[0]!.proofs.getMergeProof(
      "root",
    ))!.publicOutput.yay.toBigInt(),
    10n,
  );

  const reopened = new SqliteVoteReducerService(optionsA);
  await reopened.start();
  try {
    await assert.rejects(reopened.traceRunBatch([]), /already exists/);
    await reopened.clearPersistentState();
    assert.equal(await stores[0]!.traces.count(), 0);
    assert.equal(await stores[0]!.proofs.count(), 0);
    assert.equal(await stores[0]!.proofs.mergeCount(), 0);
    assert.equal(await stores[0]!.proofs.isMerged("0"), false);
    const cleared = new PersistentNullifierLedger(
      stores[0]!.nullifiers.nullifierStorage,
      stores[0]!.nullifiers.merkleTreeStorage,
    );
    assert.equal((await cleared.getRoot()).toString(), emptyRoot);
    assert.equal(
      (await cleared.getNullifier(voter.toBase58())).toBoolean(),
      false,
    );
  } finally {
    await reopened.close();
  }
  assert.equal(await stores[1]!.traces.count(), 1);
  assert.equal(await stores[1]!.proofs.count(), 1);
  assert.equal(await stores[1]!.proofs.isMerged("0"), true);
  assert.equal(
    (await stores[1]!.proofs.getMergeProof(
      "root",
    ))!.publicOutput.nay.toBigInt(),
    10n,
  );
  assert.equal((await votingLedger.getRoot()).toString(), votingRoot);
  assert.equal(
    await legacy.nullifierStorage.getNullifier(voter.toBase58()),
    true,
  );
});
