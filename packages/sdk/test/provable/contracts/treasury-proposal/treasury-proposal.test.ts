import test from "node:test";
import assert from "node:assert/strict";
import { TreasuryProposalSmartContract } from "../../../../src/provable/contracts/treasury-proposal/treasury-proposal.js";
import { PrivateKey, Provable, UInt128 } from "o1js";

test("calculate acceptance criteria", async (t) => {
  const testCases = [
    {
      label: "1% of treasury",
      proposalAmount: 100,
      treasuryBalance: 10_000,
      expected: {
        requiredParticipationBp: 2504,
        requiredApprovalBp: 5274,
      },
    },
    {
      label: "10% of treasury",
      proposalAmount: 1000,
      treasuryBalance: 10_000,
      expected: {
        requiredParticipationBp: 4068,
        requiredApprovalBp: 6099,
      },
    },
    {
      label: "25% of treasury",
      proposalAmount: 2500,
      treasuryBalance: 10_000,
      expected: {
        requiredParticipationBp: 4608,
        requiredApprovalBp: 6561,
      },
    },
    {
      label: "50% of treasury",
      proposalAmount: 5000,
      treasuryBalance: 10_000,
      expected: {
        requiredParticipationBp: 4856,
        requiredApprovalBp: 6827,
      },
    },
    {
      label: "90% of treasury",
      proposalAmount: 9000,
      treasuryBalance: 10_000,
      expected: {
        requiredParticipationBp: 4983,
        requiredApprovalBp: 6979,
      },
    },
    {
      label: "100% of treasury",
      proposalAmount: 10_000,
      treasuryBalance: 10_000,
      expected: {
        requiredParticipationBp: 5000,
        requiredApprovalBp: 7000,
      },
    },
  ];

  const proposalPublicKey = PrivateKey.random().toPublicKey();
  const proposal = new TreasuryProposalSmartContract(proposalPublicKey);

  for (const testCase of testCases) {
    await t.test(testCase.label, () => {
      const acceptanceCriteria = proposal.calculateAcceptanceCriteria(
        UInt128.from(testCase.proposalAmount),
        UInt128.from(testCase.treasuryBalance)
      );
      Provable.log(testCase.label, acceptanceCriteria);
      assert.equal(
        acceptanceCriteria.requiredParticipationBp.toBigInt(),
        BigInt(testCase.expected.requiredParticipationBp),
        `${testCase.label} requiredParticipationBp`
      );
      assert.equal(
        acceptanceCriteria.requiredApprovalBp.toBigInt(),
        BigInt(testCase.expected.requiredApprovalBp),
        `${testCase.label} requiredApprovalBp`
      );
    });
  }
});