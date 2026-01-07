import { it } from "node:test";
import { StakingLedgerToVotingLedgerDigestTrace } from "../../../src/proving/tracing/staking-ledger-to-voting-ledger-tracer.js";
import { readLedger } from "../../../src/read-ledger.js";
import {
  ACCOUNT_BATCH_SIZE,
  StakingLedgerToVotingLedgerProgramInput,
} from "../../../src/provable/staking-ledger-to-voting-ledger.js";
import { PrivateKey, Provable } from "o1js";
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
import { prettyPrintProgress } from "../../../src/pretty-print-progress.js";
import { StakingLedgerToVotingLedgerTracer } from "../../../src/proving/tracing/staking-ledger-to-voting-ledger-tracer.js";
import { RedisStakingLedgerToVotingLedgerTracer } from "../../../src/proving/tracing/redis-staking-ledger-to-voting-ledger-tracer.js";

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

  await stakingLedger.hydrateAccountStorage(accounts, 0, 50);
  await stakingLedger.hydrateMerkleTreeStorage(accounts, 0, 50);

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
  const endIndex = 10;
  await tracer.digest(0, 1, onTraceComplete);
  await tracer.digest(1, endIndex, onTraceComplete);

  const traces = await tracer.traceStorage.getAllTraces();

  console.log("traces completed", traces);

  await votingLedger.close();
  await stakingLedger.close();
  await tracer.close();
  await redisServer.stop();

  assert.strictEqual(traces[0].publicInput.index.toBigint(), 0n);
  assert.strictEqual(traces[1].publicInput.index.toBigint(), 5n);
});
