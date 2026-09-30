import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Cache,
  Field,
  Provable,
  UInt64,
  UInt96,
  ZkProgram,
  setNumberOfWorkers,
} from "o1js";
import { TreasuryProposalSmartContract } from "../../../src/provable/contracts/treasury-proposal/treasury-proposal.js";

test(
  "Treasury acceptance and approval arithmetic verifies with checked UInt96",
  {
    skip: process.env.O1JS_SECURITY_PROOFS !== "true",
  },
  async () => {
    setNumberOfWorkers(2);
    const program = ZkProgram({
      name: "TreasuryUInt96Arithmetic",
      publicOutput: Provable.Array(Field, 5),
      methods: {
        evaluate: {
          privateInputs: [UInt64, UInt64, UInt64, UInt64, UInt64, UInt64],
          async method(amount, treasury, totalCurrency, yay, nay, abstain) {
            const criteria =
              TreasuryProposalSmartContract.calculateAcceptanceCriteria(
                UInt96.from(amount),
                UInt96.from(treasury),
                totalCurrency,
              );
            const approval =
              TreasuryProposalSmartContract.calculateApprovalStatus({
                yay: UInt96.from(yay),
                nay: UInt96.from(nay),
                abstain: UInt96.from(abstain),
                requiredParticipation: criteria.requiredParticipation,
                requiredApprovalBp: criteria.requiredApprovalBp,
              });
            return {
              publicOutput: [
                criteria.requiredParticipationBp.value,
                criteria.requiredApprovalBp.value,
                criteria.requiredParticipation.value,
                approval.approvalBp.value,
                approval.approved.toField(),
              ],
            };
          },
        },
      },
    });
    await program.compile({
      cache: Cache.FileSystem(
        join(tmpdir(), "treasury-uint128-compatibility-cache"),
      ),
    });
    const cases: {
      inputs: [bigint, bigint, bigint, bigint, bigint, bigint];
      expected: bigint[];
    }[] = [
      {
        inputs: [1000n, 10000n, 10000n, 6000n, 1000n, 0n],
        expected: [4068n, 6099n, 4068n, 8571n, 1n],
      },
      {
        inputs: [5000n, 10000n, 10000n, 0n, 0n, 10000n],
        expected: [4856n, 6827n, 4856n, 0n, 0n],
      },
      {
        inputs: [1n << 62n, 1n << 63n, 1n << 63n, 1n << 62n, 0n, 1n],
        expected: [4856n, 6827n, ((1n << 63n) * 4856n) / 10000n, 10000n, 1n],
      },
    ];
    for (const { inputs, expected } of cases) {
      const args = inputs.map((x) => UInt64.from(x)) as [
        UInt64,
        UInt64,
        UInt64,
        UInt64,
        UInt64,
        UInt64,
      ];
      const { proof } = await program.evaluate(...args);
      assert.deepEqual(
        proof.publicOutput.map((x) => x.toBigInt()),
        expected,
      );
      assert.equal(await program.verify(proof), true);
    }
  },
);
