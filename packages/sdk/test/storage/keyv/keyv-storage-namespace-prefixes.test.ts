import { it } from "node:test";
import assert from "node:assert";
import { KeyvSqlite } from "@keyv/sqlite";
import { createSqliteStakingLedgerToVotingLedgerDigestTraceStorage } from "../../../src/storage/sqlite/factory/sqlite-staking-ledger-to-voting-ledger-digest-trace-storage.js";
import { createSqliteStakingLedgerToVotingLedgerProofStorage } from "../../../src/storage/sqlite/factory/sqlite-staking-ledger-to-voting-ledger-proof-storage.js";
import { createSqliteVoteReducerProofStorage } from "../../../src/storage/sqlite/factory/sqlite-vote-reducer-proof-storage.js";
import { createSqliteVoteReducerRunBatchTraceStorage } from "../../../src/storage/sqlite/factory/sqlite-vote-reducer-run-batch-trace-storage.js";
import {
  SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
} from "../../../src/provable/staking-ledger-to-voting-ledger.js";
import { StakingLedgerToVotingLedgerDigestTrace } from "../../../src/proving/tracing/staking-ledger-to-voting-ledger-tracer.js";
import { Account } from "../../../src/provable/account.js";
import {
  PrefixedMerkleWitness255,
  PrefixedMerkleWitness36,
} from "../../../src/provable/merkle-tree/prefixed-merkle-tree.js";
import { VotingAccount } from "../../../src/provable/voting-account.js";

it("uses explicit prefixed namespaces for staking->voting trace/proof storage entries", async () => {
  const lifecycleId = "42";
  const sqlite = new KeyvSqlite({ uri: "sqlite://:memory:" });
  const traceStorage = createSqliteStakingLedgerToVotingLedgerDigestTraceStorage(
    lifecycleId,
    sqlite,
  );
  const proofStorage = createSqliteStakingLedgerToVotingLedgerProofStorage(
    lifecycleId,
    sqlite,
  );

  const trace = new StakingLedgerToVotingLedgerDigestTrace({
    publicInput: StakingLedgerToVotingLedgerProgramInput.empty(),
    privateInput: {
      accounts: [Account.empty()],
    },
    stakingLedgerWitnesses: {
      "0": [PrefixedMerkleWitness36.empty()],
    },
    votingAccounts: {
      "0": [VotingAccount.empty()],
    },
    votingLedgerWitnesses: {
      "0": [PrefixedMerkleWitness255.empty()],
    },
  });

  await traceStorage.setTrace(0, trace);
  const traceEntries = traceStorage.collectEntries();
  assert.strictEqual(traceEntries.length, 1);
  assert.strictEqual(
    traceEntries[0].key,
    `staking-ledger-to-voting-ledger-${lifecycleId}-traces:0`,
  );
  traceStorage.clearEntries();

  const proof = await SideLoadedStakingLedgerToVotingLedgerProof.dummy(
    StakingLedgerToVotingLedgerProgramInput.empty(),
    StakingLedgerToVotingLedgerProgramOutput.empty(),
    0,
  );

  await proofStorage.setProof("0", proof);
  await proofStorage.setMergeProof("merge-0", proof);
  await proofStorage.markAsMerged("0");

  const proofKeys = new Set(proofStorage.collectEntries().map((entry) => entry.key));
  assert(proofKeys.has(`staking-ledger-to-voting-ledger-proof-${lifecycleId}:0`));
  assert(
    proofKeys.has(
      `staking-ledger-to-voting-ledger-proof-${lifecycleId}-merge:merge-0`,
    ),
  );
  assert(
    proofKeys.has(
      `staking-ledger-to-voting-ledger-proof-${lifecycleId}-merged:0`,
    ),
  );

  await traceStorage.close();
  await proofStorage.close();
  await sqlite.disconnect();
});

it("uses explicit prefixed namespaces for vote reducer trace/proof storage", async () => {
  const lifecycleId = "43";
  const sqlite = new KeyvSqlite({ uri: "sqlite://:memory:" });
  const traceStorage = createSqliteVoteReducerRunBatchTraceStorage(
    lifecycleId,
    sqlite,
  );
  const proofStorage = createSqliteVoteReducerProofStorage(lifecycleId, sqlite);

  assert.strictEqual(
    traceStorage.namespace,
    `vote-reducer-run-batch-trace-${lifecycleId}`,
  );
  assert.strictEqual(
    proofStorage.storage.namespace,
    `vote-reducer-proof-${lifecycleId}`,
  );
  assert.strictEqual(
    proofStorage.mergeStorage.namespace,
    `vote-reducer-proof-${lifecycleId}-merge`,
  );
  assert.strictEqual(
    proofStorage.mergedStorage.namespace,
    `vote-reducer-proof-${lifecycleId}-merged`,
  );

  await traceStorage.close();
  await proofStorage.close();
  await sqlite.disconnect();
});
