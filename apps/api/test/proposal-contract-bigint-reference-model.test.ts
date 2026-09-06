import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ProposalStatus,
  TreasuryProposalSmartContract,
} from "@repo/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.js";
import { UInt128, UInt64 } from "o1js";
import {
  assessReferenceFinalTally,
  referenceAcceptanceCriteria,
  referenceApprovalDecision,
  type ReferenceCriteria,
  type ReferenceDecision,
} from "./support/proposal-contract-bigint-reference.js";
const UINT64_MAX = (1n << 64n) - 1n;

function contractAcceptanceCriteria(input: {
  proposalAmount: bigint;
  treasuryBalance: bigint;
  stakingTotal: bigint;
}): Omit<ReferenceCriteria, "ratioBp"> {
  const result = TreasuryProposalSmartContract.calculateAcceptanceCriteria(
    UInt128.from(input.proposalAmount),
    UInt128.from(input.treasuryBalance),
    UInt64.from(input.stakingTotal),
  );
  return {
    requiredParticipationBp: result.requiredParticipationBp.toBigInt(),
    requiredApprovalBp: result.requiredApprovalBp.toBigInt(),
    requiredParticipation: result.requiredParticipation.toBigInt(),
  };
}

function contractApprovalDecision(input: {
  yay: bigint;
  nay: bigint;
  abstain: bigint;
  requiredParticipation: bigint;
  requiredApprovalBp: bigint;
}): ReferenceDecision {
  const result = TreasuryProposalSmartContract.calculateApprovalStatus({
    yay: UInt128.from(input.yay),
    nay: UInt128.from(input.nay),
    abstain: UInt128.from(input.abstain),
    requiredParticipation: UInt128.from(input.requiredParticipation),
    requiredApprovalBp: UInt128.from(input.requiredApprovalBp),
  });
  const approved = result.approved.toBoolean();
  return {
    totalParticipatingVotes: result.totalParticipatingVotes.toBigInt(),
    requiredParticipation: result.requiredParticipation.toBigInt(),
    participationMet: result.participationMet.toBoolean(),
    totalVotes: result.totalVotes.toBigInt(),
    hasApprovalVotes: result.hasApprovalVotes.toBoolean(),
    approvalBp: result.approvalBp.toBigInt(),
    approved,
    voteResult: ProposalStatus.APPROVED.equals(result.voteResult).toBoolean()
      ? "approved"
      : "rejected",
  };
}

describe("proposal contract independent BigInt reference model", () => {
  it("does not claim full reachability from arithmetic conditions alone", () => {
    const assessment = assessReferenceFinalTally({
      lifecycleId: 1n,
      expectedLifecycleId: 1n,
      yay: 51n,
      nay: 49n,
      abstain: 0n,
      voteResult: "approved",
      requiredParticipation: 100n,
      requiredApprovalBp: 5_100n,
    });

    assert.equal(assessment.claimClass, "CONTRACT_NECESSARY_CONDITIONS");
    assert.equal(assessment.passesNecessaryConditions, true);
    assert.equal(assessment.fullReachabilityProved, false);
  });

  it("matches fixed acceptance criteria outputs", () => {
    const cases = [
      {
        input: {
          proposalAmount: 0n,
          treasuryBalance: 1n,
          stakingTotal: 10_000n,
        },
        expected: {
          ratioBp: 0n,
          requiredParticipationBp: 2_000n,
          requiredApprovalBp: 5_100n,
          requiredParticipation: 2_000n,
        },
      },
      {
        input: {
          proposalAmount: 1n,
          treasuryBalance: 1_000n,
          stakingTotal: 10_000n,
        },
        expected: {
          ratioBp: 10n,
          requiredParticipationBp: 2_058n,
          requiredApprovalBp: 5_118n,
          requiredParticipation: 2_058n,
        },
      },
      {
        input: {
          proposalAmount: 1n,
          treasuryBalance: 10n,
          stakingTotal: 10_000n,
        },
        expected: {
          ratioBp: 1_000n,
          requiredParticipationBp: 4_068n,
          requiredApprovalBp: 6_099n,
          requiredParticipation: 4_068n,
        },
      },
      {
        input: {
          proposalAmount: 1n,
          treasuryBalance: 1n,
          stakingTotal: 10_000n,
        },
        expected: {
          ratioBp: 10_000n,
          requiredParticipationBp: 5_000n,
          requiredApprovalBp: 7_000n,
          requiredParticipation: 5_000n,
        },
      },
      {
        input: {
          proposalAmount: 2n,
          treasuryBalance: 1n,
          stakingTotal: 10_001n,
        },
        expected: {
          ratioBp: 10_000n,
          requiredParticipationBp: 5_000n,
          requiredApprovalBp: 7_000n,
          requiredParticipation: 5_000n,
        },
      },
      {
        input: {
          proposalAmount: UINT64_MAX,
          treasuryBalance: UINT64_MAX,
          stakingTotal: UINT64_MAX,
        },
        expected: {
          ratioBp: 10_000n,
          requiredParticipationBp: 5_000n,
          requiredApprovalBp: 7_000n,
          requiredParticipation: 9_223_372_036_854_775_807n,
        },
      },
    ] as const;

    for (const testCase of cases) {
      assert.deepEqual(
        referenceAcceptanceCriteria(testCase.input),
        testCase.expected,
      );
      const { ratioBp: _ratioBp, ...expectedContractOutput } =
        testCase.expected;
      assert.deepEqual(
        contractAcceptanceCriteria(testCase.input),
        expectedContractOutput,
      );
    }
  });

  it("matches deterministic acceptance boundary vectors", () => {
    const balances = [1n, 2n, 3n, 10n, 999n, 10_000n, UINT64_MAX];
    const stakingTotals = [0n, 1n, 9_999n, 10_000n, UINT64_MAX];

    for (const treasuryBalance of balances) {
      const amounts = [
        0n,
        1n,
        treasuryBalance > 1n ? treasuryBalance - 1n : 0n,
        treasuryBalance,
        treasuryBalance < UINT64_MAX ? treasuryBalance + 1n : UINT64_MAX,
        UINT64_MAX,
      ];
      for (const proposalAmount of new Set(amounts)) {
        for (const stakingTotal of stakingTotals) {
          const input = { proposalAmount, treasuryBalance, stakingTotal };
          const { ratioBp: _ratioBp, ...reference } =
            referenceAcceptanceCriteria(input);
          assert.deepEqual(
            contractAcceptanceCriteria(input),
            reference,
            JSON.stringify(input, (_key, value) =>
              typeof value === "bigint" ? value.toString() : value,
            ),
          );
        }
      }
    }
  });

  it("matches fixed approval decision outputs", () => {
    const cases = [
      {
        input: {
          yay: 0n,
          nay: 0n,
          abstain: 0n,
          requiredParticipation: 0n,
          requiredApprovalBp: 0n,
        },
        expected: {
          totalParticipatingVotes: 0n,
          requiredParticipation: 0n,
          participationMet: true,
          totalVotes: 0n,
          hasApprovalVotes: false,
          approvalBp: 0n,
          approved: false,
          voteResult: "rejected",
        },
      },
      {
        input: {
          yay: 51n,
          nay: 49n,
          abstain: 0n,
          requiredParticipation: 100n,
          requiredApprovalBp: 5_100n,
        },
        expected: {
          totalParticipatingVotes: 100n,
          requiredParticipation: 100n,
          participationMet: true,
          totalVotes: 100n,
          hasApprovalVotes: true,
          approvalBp: 5_100n,
          approved: true,
          voteResult: "approved",
        },
      },
      {
        input: {
          yay: 50n,
          nay: 50n,
          abstain: 0n,
          requiredParticipation: 100n,
          requiredApprovalBp: 5_100n,
        },
        expected: {
          totalParticipatingVotes: 100n,
          requiredParticipation: 100n,
          participationMet: true,
          totalVotes: 100n,
          hasApprovalVotes: true,
          approvalBp: 5_000n,
          approved: false,
          voteResult: "rejected",
        },
      },
      {
        input: {
          yay: 7n,
          nay: 3n,
          abstain: 89n,
          requiredParticipation: 100n,
          requiredApprovalBp: 7_000n,
        },
        expected: {
          totalParticipatingVotes: 99n,
          requiredParticipation: 100n,
          participationMet: false,
          totalVotes: 10n,
          hasApprovalVotes: true,
          approvalBp: 7_000n,
          approved: false,
          voteResult: "rejected",
        },
      },
      {
        input: {
          yay: 0n,
          nay: 0n,
          abstain: 100n,
          requiredParticipation: 100n,
          requiredApprovalBp: 0n,
        },
        expected: {
          totalParticipatingVotes: 100n,
          requiredParticipation: 100n,
          participationMet: true,
          totalVotes: 0n,
          hasApprovalVotes: false,
          approvalBp: 0n,
          approved: false,
          voteResult: "rejected",
        },
      },
    ] as const;

    for (const testCase of cases) {
      assert.deepEqual(
        referenceApprovalDecision(testCase.input),
        testCase.expected,
      );
      assert.deepEqual(
        contractApprovalDecision(testCase.input),
        testCase.expected,
      );
    }
  });

  it("matches deterministic approval boundary vectors", () => {
    const voteVectors = [
      { yay: 0n, nay: 0n, abstain: 0n },
      { yay: 0n, nay: 0n, abstain: 1n },
      { yay: 1n, nay: 0n, abstain: 0n },
      { yay: 0n, nay: 1n, abstain: 0n },
      { yay: 1n, nay: 1n, abstain: 0n },
      { yay: 50n, nay: 50n, abstain: 0n },
      { yay: 51n, nay: 49n, abstain: 0n },
      { yay: 69n, nay: 31n, abstain: 100n },
      { yay: 70n, nay: 30n, abstain: 100n },
      { yay: 71n, nay: 29n, abstain: 100n },
      { yay: UINT64_MAX, nay: 0n, abstain: 0n },
      { yay: UINT64_MAX, nay: UINT64_MAX, abstain: UINT64_MAX },
    ];
    const requiredParticipations = [0n, 1n, 99n, 100n, 101n, UINT64_MAX];
    const requiredApprovalValues = [0n, 1n, 5_000n, 5_100n, 7_000n, 10_000n];

    for (const votes of voteVectors) {
      for (const requiredParticipation of requiredParticipations) {
        for (const requiredApprovalBp of requiredApprovalValues) {
          const input = {
            ...votes,
            requiredParticipation,
            requiredApprovalBp,
          };
          assert.deepEqual(
            contractApprovalDecision(input),
            referenceApprovalDecision(input),
            JSON.stringify(input, (_key, value) =>
              typeof value === "bigint" ? value.toString() : value,
            ),
          );
        }
      }
    }
  });
});
