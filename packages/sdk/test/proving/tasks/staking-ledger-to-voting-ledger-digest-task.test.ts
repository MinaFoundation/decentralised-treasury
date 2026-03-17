import { it } from "node:test";
import { Account, packToFields } from "../../../src/provable/account.js";
import {
  ACCOUNT_BATCH_SIZE,
  StakingLedgerToVotingLedger,
  StakingLedgerToVotingLedgerProgramInput,
} from "../../../src/provable/staking-ledger-to-voting-ledger.js";
import {
  StakingLedgerToVotingLedgerDigestTask,
  StakingLedgerToVotingLedgerDigestTaskInput,
} from "../../../src/proving/tasks/staking-ledger-to-voting-ledger-digest-task.js";
import { StakingLedgerToVotingLedgerDigestTrace } from "../../../src/proving/tracing/staking-ledger-to-voting-ledger-tracer.js";
import { Poseidon, PrivateKey, Provable } from "o1js";
import { PersistentStakingLedger } from "../../../src/ledgers/staking-ledger/persistent-staking-ledger.js";
import { PersistentVotingLedger } from "../../../src/ledgers/voting-ledger/persistent-voting-ledger.js";
import { createSqliteStakingLedgerStorage } from "../../../src/storage/sqlite/factory/sqlite-staking-ledger-storage.js";
import { createSqliteVotingLedgerStorage } from "../../../src/storage/sqlite/factory/sqlite-voting-ledger-storage.js";
import { KeyvSqlite } from "@keyv/sqlite";

import { RecordingStakingLedger } from "../../../src/ledgers/staking-ledger/recording-staking-ledger.js";
import { RecordingVotingLedger } from "../../../src/ledgers/voting-ledger/recording-voting-ledger.js";
import assert from "node:assert";

it("should run the digest task", async () => {
  const sqlite = new KeyvSqlite({ uri: "sqlite://:memory:" });
  const stakingLedgerStorage = createSqliteStakingLedgerStorage(
    "test-namespace",
    sqlite,
  );
  const stakingLedger = new PersistentStakingLedger(
    stakingLedgerStorage.accountStorage,
    stakingLedgerStorage.merkleTreeStorage,
  );
  const votingLedgerStorage = createSqliteVotingLedgerStorage(
    "test-namespace",
    sqlite,
  );
  const votingLedger = new PersistentVotingLedger(
    votingLedgerStorage.votingAccountStorage,
    votingLedgerStorage.merkleTreeStorage,
  );
  const recordingStakingLedger = new RecordingStakingLedger(stakingLedger);
  const recordingVotingLedger = new RecordingVotingLedger(votingLedger);

  const accounts: Account[] = [];

  for (let i = 0; i < ACCOUNT_BATCH_SIZE; i++) {
    const account = Account.empty();
    account.pk = PrivateKey.random().toPublicKey();
    account.delegate = account.pk;
    accounts.push(account);
    await stakingLedger.setLeaf(BigInt(i), account);
  }

  for (const account of accounts) {
    await recordingStakingLedger.getWitness(BigInt(accounts.indexOf(account)));
    await recordingVotingLedger.getWitness(account.pk.toBase58());
  }

  const stakingLedgerWitnesses =
    recordingStakingLedger.recorder.recordings.witnesses;
  const votingLedgerWitnesses =
    recordingVotingLedger.recorder.recordings.witnesses;

  const trace = new StakingLedgerToVotingLedgerDigestTrace({
    publicInput: {
      ...StakingLedgerToVotingLedgerProgramInput.empty(),
      stakingLedgerRoot: await stakingLedger.getRoot(),
      votingLedgerRoot: await votingLedger.getRoot(),
    },
    privateInput: {
      accounts,
    },
    stakingLedgerWitnesses,
    votingAccounts: {},
    votingLedgerWitnesses,
  });
  const input: StakingLedgerToVotingLedgerDigestTaskInput = {
    trace,
    traceId: 0,
  };

  console.log("preparing task");
  await StakingLedgerToVotingLedgerDigestTask.prepare();
  console.log("task prepared");

  console.log("running task");
  const output = await StakingLedgerToVotingLedgerDigestTask.run(input);
  console.log("task ran");

  assert(
    output.proof.publicInput.stakingLedgerRoot.toString() ===
      trace.publicInput.stakingLedgerRoot.toString(),
    "staking ledger root does not match",
  );
  await votingLedger.close();
  await stakingLedger.close();
  await sqlite.disconnect();
});
