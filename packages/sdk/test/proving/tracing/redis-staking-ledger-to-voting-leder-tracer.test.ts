import { it } from "node:test";
import { StakingLedgerToVotingLedgerDigestTrace } from "../../../src/proving/tracing/staking-ledger-to-voting-ledger-tracer.js";
import { StakingLedgerToVotingLedgerProgramInput } from "../../../src/provable/staking-ledger-to-voting-ledger.js";
import { Provable } from "o1js";
import {
  PrefixedMerkleWitness256,
  PrefixedMerkleWitness36,
} from "../../../src/provable/merkle-tree/prefixed-merkle-tree.js";
import assert from "node:assert";
import { VotingAccount } from "../../../src/provable/voting-account.js";
import { RedisMemoryServer } from "redis-memory-server";
import { RedisStakingLedger } from "../../../src/ledgers/staking-ledger/redis-staking-ledger.js";
import { Account } from "../../../src/provable/account.js";
import { RedisVotingLedger } from "../../../src/ledgers/voting-ledger/redis-voting-ledger.js";
import { RedisStakingLedgerToVotingLedgerTracer } from "../../../src/proving/tracing/redis-staking-ledger-to-voting-ledger-tracer.js";
import { writeFileSync } from "node:fs";

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
      "1": [PrefixedMerkleWitness256.empty()],
    },
  });

  const serializedTrace = StakingLedgerToVotingLedgerDigestTrace.toJSON(trace);
  const deserializedTrace =
    StakingLedgerToVotingLedgerDigestTrace.fromJSON(serializedTrace);

  assert.deepStrictEqual(deserializedTrace, trace);
});

it("should trace a staking ledger to a voting ledger", async () => {
  const redisServer = new RedisMemoryServer();
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();
  const redisUrl = `redis://${redisHost}:${redisPort}`;
  const lifecycleId = "test-lifecycle";

  const stakingLedger = new RedisStakingLedger(redisUrl, lifecycleId);
  const votingLedger = new RedisVotingLedger(redisUrl, lifecycleId);

  const accounts = await stakingLedger.readStakingLedger(
    "test/provable/staking-epoch-ledger.json"
  );

  console.log("hydrating staking ledger", accounts.length);
  await stakingLedger.hydrateAccounts(accounts, 0, 50);
  await stakingLedger.hydrateMerkleTree(accounts, 0, 50);

  const tracer = new RedisStakingLedgerToVotingLedgerTracer(
    stakingLedger,
    votingLedger,
    redisUrl,
    lifecycleId
  );

  const onTraceComplete = (
    index: number,
    trace: StakingLedgerToVotingLedgerDigestTrace
  ) => {
    Provable.log(
      "trace",
      index,
      "completed",
      "from ledger index:",
      trace.publicInput.index.toBigint()
    );
  };
  console.log("tracing");
  await tracer.digest(0, 9, onTraceComplete);

  const traces = await tracer.traceStorage.getAllTraces();

  console.log("traces completed", traces.length);

  await votingLedger.close();
  await stakingLedger.close();
  await tracer.close();
  await redisServer.stop();

  // TODO: use this to refresh the data set for the prover tests
  // console.log("saving traces to file");

  // const jsonTraces = JSON.stringify(
  //   traces.map((trace) => StakingLedgerToVotingLedgerDigestTrace.toJSON(trace))
  // );

  // console.log("jsonntaces", jsonTraces);

  // writeFileSync(
  //   "test/proving/staking-ledger-to-voting-ledger-traces.json",
  //   jsonTraces
  // );

  assert.strictEqual(traces[0].publicInput.index.toBigint(), 0n);
  assert.strictEqual(traces[1].publicInput.index.toBigint(), 5n);
});
