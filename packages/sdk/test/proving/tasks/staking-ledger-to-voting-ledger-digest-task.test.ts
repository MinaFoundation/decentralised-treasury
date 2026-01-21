import { it } from "node:test";
import {
  Account,
  accountHashPrefix,
  packToFields,
} from "../../../src/provable/account.js";
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
import { RedisMemoryServer } from "redis-memory-server";
import { RedisStakingLedger } from "../../../src/ledgers/staking-ledger/redis-staking-ledger.js";
import { RedisVotingLedger } from "../../../src/ledgers/voting-ledger/redis-voting-ledger.js";

import { RecordingStakingLedger } from "../../../src/ledgers/staking-ledger/recording-staking-ledger.js";
import { RecordingVotingLedger } from "../../../src/ledgers/voting-ledger/recording-voting-ledger.js";
import assert from "node:assert";

it("should run the digest task", async () => {
  const redisServer = new RedisMemoryServer();
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();
  const redisUrl = `redis://${redisHost}:${redisPort}`;
  const stakingLedger = new RedisStakingLedger(redisUrl, "test-namespace");
  const votingLedger = new RedisVotingLedger(redisUrl, "test-namespace");
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
    await recordingVotingLedger.getWitness(
      Poseidon.hash(account.pk.toFields()).toBigInt()
    );
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
    "staking ledger root does not match"
  );
});
