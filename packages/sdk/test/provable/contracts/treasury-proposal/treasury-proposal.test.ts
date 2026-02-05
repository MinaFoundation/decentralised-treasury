import test from "node:test";
import assert from "node:assert/strict";
import { TreasuryProposalSmartContract } from "../../../../src/provable/contracts/treasury-proposal/treasury-proposal.js";
import { PrivateKey, Provable, PublicKey, UInt64 } from "o1js";

test("calculate acceptance criteria", async (t) => {
  const testCases = [
    {
      label: "1% of treasury",
      proposalAmount: 100,
      treasuryBalance: 10_000,
      expected: {
        requiredParticipationBp: 1138,
        requiredApprovalBp: 5006,
      },
    },
    {
      label: "10% of treasury",
      proposalAmount: 1000,
      treasuryBalance: 10_000,
      expected: {
        requiredParticipationBp: 2272,
        requiredApprovalBp: 5065,
      },
    },
    {
      label: "25% of treasury",
      proposalAmount: 2500,
      treasuryBalance: 10_000,
      expected: {
        requiredParticipationBp: 3800,
        requiredApprovalBp: 5187,
      },
    },
    {
      label: "50% of treasury",
      proposalAmount: 5000,
      treasuryBalance: 10_000,
      expected: {
        requiredParticipationBp: 5666,
        requiredApprovalBp: 5499,
      },
    },
    {
      label: "90% of treasury",
      proposalAmount: 9000,
      treasuryBalance: 10_000,
      expected: {
        requiredParticipationBp: 7631,
        requiredApprovalBp: 6928,
      },
    },
    {
      label: "100% of treasury",
      proposalAmount: 10_000,
      treasuryBalance: 10_000,
      expected: {
        requiredParticipationBp: 8000,
        requiredApprovalBp: 8000,
      },
    },
  ];

  const proposalPublicKey = PrivateKey.random().toPublicKey();
  const proposal = new TreasuryProposalSmartContract(proposalPublicKey);

  for (const testCase of testCases) {
    await t.test(testCase.label, () => {
      const acceptanceCriteria = proposal.calculateAcceptanceCriteria(
        UInt64.from(testCase.proposalAmount),
        UInt64.from(testCase.treasuryBalance)
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