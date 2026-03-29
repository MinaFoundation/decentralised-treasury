import { after, before, it } from "node:test";
import { StakingLedgerToVotingLedgerDigestTrace } from "../../../src/proving/tracing/staking-ledger-to-voting-ledger-tracer.js";
import {
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
} from "../../../src/provable/staking-ledger-to-voting-ledger.js";
import { Provable } from "o1js";
import {
  PrefixedMerkleWitness255,
  PrefixedMerkleWitness36,
} from "../../../src/provable/merkle-tree/prefixed-merkle-tree.js";
import assert from "node:assert";
import { VotingAccount } from "../../../src/provable/voting-account.js";
import { PersistentStakingLedger } from "../../../src/ledgers/staking-ledger/persistent-staking-ledger.js";
import { Account } from "../../../src/provable/account.js";
import { StakingLedgerToVotingLedgerTracer } from "../../../src/proving/tracing/staking-ledger-to-voting-ledger-tracer.js";
import { KeyvStakingLedgerToVotingLedgerDigestTraceStorage } from "../../../src/storage/keyv/keyv-staking-ledger-to-voting-ledger-digest-trace-storage.js";
import { createSqliteStakingLedgerStorage } from "../../../src/storage/sqlite/factory/sqlite-staking-ledger-storage.js";
import { createSqliteVotingLedgerStorage } from "../../../src/storage/sqlite/factory/sqlite-voting-ledger-storage.js";
import { KeyvKeyValueBatchStorage } from "../../../src/storage/keyv/keyv-key-value-batch-storage.js";
import { createSqliteStakingLedgerToVotingLedgerDigestTraceStorage } from "../../../src/storage/sqlite/factory/sqlite-staking-ledger-to-voting-ledger-digest-trace-storage.js";
import { createSqliteBatchWriter } from "../../../src/storage/sqlite/factory/sqlite-batch-writer.js";
import { createInMemoryVotingLedgerStorage } from "../../../src/storage/in-memory/factory/in-memory-voting-ledger-storage.js";
import { InMemoryVotingLedger } from "../../../src/ledgers/voting-ledger/in-memory-voting-ledger.js";
import { KeyvSqlite } from "@keyv/sqlite";

const lifecycleId = "0";

let stakingLedger: PersistentStakingLedger;
let votingLedger: InMemoryVotingLedger;
let traceStorage: KeyvStakingLedgerToVotingLedgerDigestTraceStorage;
let batchWriter: KeyvKeyValueBatchStorage;
let sqlite: KeyvSqlite;

const onTraceComplete = (
  index: number,
  trace: StakingLedgerToVotingLedgerDigestTrace,
  publicOutput: StakingLedgerToVotingLedgerProgramOutput,
) => {
  Provable.log(
    "trace",
    index,
    "completed",
    "from ledger index:",
    trace.publicInput.index.toBigInt(),
    "to output",
    publicOutput.index.toBigInt(),
  );
};

before(async () => {
  sqlite = new KeyvSqlite({ uri: "sqlite://:memory:" });
  const stakingLedgerStorage = createSqliteStakingLedgerStorage(
    lifecycleId,
    sqlite,
  );
  stakingLedger = new PersistentStakingLedger(
    stakingLedgerStorage.accountStorage,
    stakingLedgerStorage.merkleTreeStorage,
  );

  const votingLedgerStorage = createInMemoryVotingLedgerStorage(
    createSqliteVotingLedgerStorage(lifecycleId, sqlite),
  );
  votingLedger = new InMemoryVotingLedger(
    votingLedgerStorage.votingAccountStorage,
    votingLedgerStorage.merkleTreeStorage,
  );

  traceStorage = createSqliteStakingLedgerToVotingLedgerDigestTraceStorage(
    lifecycleId,
    sqlite,
  );
  batchWriter = createSqliteBatchWriter(sqlite);
});

after(async () => {
  await stakingLedger.close();
  await votingLedger.close();
  await traceStorage.close();
  await batchWriter.close();
  await sqlite.disconnect();
});

it("should serialize and deserialize a trace", async () => {
  const trace = new StakingLedgerToVotingLedgerDigestTrace({
    publicInput: StakingLedgerToVotingLedgerProgramInput.empty(),
    privateInput: {
      accounts: [Account.empty()],
    },
    stakingLedgerWitnesses: {
      "1": [PrefixedMerkleWitness36.empty()],
    },
    votingAccounts: {
      "1": [VotingAccount.empty()],
    },
    votingLedgerWitnesses: {
      "1": [PrefixedMerkleWitness255.empty()],
    },
  });

  const serializedTrace = StakingLedgerToVotingLedgerDigestTrace.toJSON(trace);
  const deserializedTrace =
    StakingLedgerToVotingLedgerDigestTrace.fromJSON(serializedTrace);

  assert.deepStrictEqual(deserializedTrace, trace);
});

it("should trace a staking ledger to a voting ledger", async () => {
  const accounts = await stakingLedger.readStakingLedger(
    "test/test-ledger-mini.json",
  );

  await stakingLedger.hydrateAccounts(accounts, 0, 9);
  await stakingLedger.hydrateMerkleTree(accounts, 0, 9);

  const tracer = new StakingLedgerToVotingLedgerTracer(
    stakingLedger,
    votingLedger,
    traceStorage,
    batchWriter,
  );

  await tracer.digest(0, Infinity, onTraceComplete);

  const tracesCount = await tracer.traceStorage.count();
  const trace0 = await tracer.traceStorage.getTrace(0);
  const trace1 = await tracer.traceStorage.getTrace(1);

  await tracer.close();

  assert.strictEqual(trace0.publicInput.index.toBigInt(), 0n);
  assert.strictEqual(trace1.publicInput.index.toBigInt(), 5n);
  assert.strictEqual(tracesCount, 2);
});
