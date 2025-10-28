import { it } from "node:test";
import { StakingLedgerToVotingLedgerDigestTracer } from "../../../src/proving/tracing/staking-ledger-to-voting-ledger-digest-tracer.js";
import { readLedger } from "../../../src/read-ledger.js";
import { ACCOUNT_BATCH_SIZE } from "../../../src/provable/staking-ledger-to-voting-ledger.js";
import { Provable } from "o1js";

const MAX_TEST_ACCOUNTS = ACCOUNT_BATCH_SIZE;

it("should trace a staking ledger to voting ledger digest", async () => {
  let accounts = await readLedger("test/provable/staking-epoch-ledger.json");

  // uncomment this out if you want to test with a subset of the accounts
  // accounts.slice(0, MAX_TEST_ACCOUNTS);

  console.time("tracing");
  const traces = await StakingLedgerToVotingLedgerDigestTracer.trace(accounts);
  console.timeEnd("tracing");
  Provable.log(traces);
});
