// import { it } from "node:test";
// import assert from "node:assert";
// import { readLedger } from "../../../src/read-ledger.js";
// import { StakingLedgerToVotingLedgerDigestTracer } from "../../../src/proving/tracing/staking-ledger-to-voting-ledger-digest-tracer.js";
// import { StakingLedgerToVotingLedgerDigestTask } from "../../../src/proving/tasks/staking-ledger-to-voting-ledger-digest-task.js";
// import {
//   ACCOUNT_BATCH_SIZE,
//   StakingLedgerToVotingLedger,
// } from "../../../src/provable/staking-ledger-to-voting-ledger.js";
// import { Provable } from "o1js";

// const MAX_TEST_ACCOUNTS = ACCOUNT_BATCH_SIZE;
// it("should digest a staking ledger to voting ledger", async () => {
//   let accounts = await readLedger("test/provable/staking-epoch-ledger.json");
//   accounts = accounts.slice(0, MAX_TEST_ACCOUNTS);

//   console.log("loaded", accounts.length, "accounts");
//   const traces = await StakingLedgerToVotingLedgerDigestTracer.trace(accounts);

//   Provable.log("traces", traces.length);

//   await StakingLedgerToVotingLedger.compile({
//     proofsEnabled: false,
//   });

//   const results = [];

//   console.log("trace", traces[traces.length - 1]);

//   for (const trace of traces) {
//     const task = new StakingLedgerToVotingLedgerDigestTask();

//     const serializedTrace = await task.serializers.input(trace);
//     const deserializedTrace = await task.deserializers.input(serializedTrace);
//     task.input = deserializedTrace;
//     const result = await task.run(trace);
//     const serializedResult = await task.serializers.output(result);
//     const deserializedResult =
//       await task.deserializers.output(serializedResult);
//     results.push(deserializedResult);
//   }

//   assert(
//     results.length === traces.length,
//     "results length does not match traces length"
//   );
//   // assert(results.length === 202, "results length does not match 202");
// });
