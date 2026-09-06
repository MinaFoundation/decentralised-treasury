import assert from "node:assert/strict";

// These literals mirror the deployed contract constants. Keep this module
// independent from SDK constants and processor helpers. The contract parity
// test compares this model with the SDK implementation.
export const REFERENCE_BASIS_POINTS = 10_000n;
export const REFERENCE_BOND_AMOUNT_DIVISOR = 10n;
export const REFERENCE_UINT32_MAX = (1n << 32n) - 1n;
export const REFERENCE_UINT64_MAX = (1n << 64n) - 1n;
const MIN_PARTICIPATION_BP = 2_000n;
const MAX_PARTICIPATION_BP = 5_000n;
const MIN_APPROVAL_BP = 5_100n;
const MAX_APPROVAL_BP = 7_000n;
const PARTICIPATION_CURVE_CONSTANT_BP = 500n;
const APPROVAL_CURVE_CONSTANT_BP = 1_000n;

export interface ReferenceCriteria {
  ratioBp: bigint;
  requiredParticipationBp: bigint;
  requiredApprovalBp: bigint;
  requiredParticipation: bigint;
}

export interface ReferenceDecision {
  totalParticipatingVotes: bigint;
  requiredParticipation: bigint;
  participationMet: boolean;
  totalVotes: bigint;
  hasApprovalVotes: boolean;
  approvalBp: bigint;
  approved: boolean;
  voteResult: "approved" | "rejected";
}

export type HarnessClaimClass =
  | "CONTRACT_PROVED"
  | "CONTRACT_NECESSARY_CONDITIONS"
  | "PROCESSOR_POLICY";

export interface ReferenceFinalTallyAssessment {
  claimClass: "CONTRACT_PROVED" | "CONTRACT_NECESSARY_CONDITIONS";
  passesNecessaryConditions: boolean;
  fullReachabilityProved: false;
  reasons: string[];
  decision: ReferenceDecision | null;
}

export function referenceAcceptanceCriteria(input: {
  proposalAmount: bigint;
  treasuryBalance: bigint;
  stakingTotal: bigint;
}): ReferenceCriteria {
  assert.ok(input.treasuryBalance > 0n);

  const uncappedRatioBp =
    (input.proposalAmount * REFERENCE_BASIS_POINTS) / input.treasuryBalance;
  const ratioBp =
    uncappedRatioBp < REFERENCE_BASIS_POINTS
      ? uncappedRatioBp
      : REFERENCE_BASIS_POINTS;
  const remainingRatioBp = REFERENCE_BASIS_POINTS - ratioBp;
  const participationCurveDenominator =
    ratioBp +
    (PARTICIPATION_CURVE_CONSTANT_BP * remainingRatioBp) /
      REFERENCE_BASIS_POINTS;
  const participationCurveBp =
    (ratioBp * REFERENCE_BASIS_POINTS) / participationCurveDenominator;
  const approvalCurveDenominator =
    ratioBp +
    (APPROVAL_CURVE_CONSTANT_BP * remainingRatioBp) / REFERENCE_BASIS_POINTS;
  const approvalCurveBp =
    (ratioBp * REFERENCE_BASIS_POINTS) / approvalCurveDenominator;
  const requiredParticipationBp =
    MIN_PARTICIPATION_BP +
    ((MAX_PARTICIPATION_BP - MIN_PARTICIPATION_BP) * participationCurveBp) /
      REFERENCE_BASIS_POINTS;
  const requiredApprovalBp =
    MIN_APPROVAL_BP +
    ((MAX_APPROVAL_BP - MIN_APPROVAL_BP) * approvalCurveBp) /
      REFERENCE_BASIS_POINTS;

  return {
    ratioBp,
    requiredParticipationBp,
    requiredApprovalBp,
    requiredParticipation:
      (input.stakingTotal * requiredParticipationBp) / REFERENCE_BASIS_POINTS,
  };
}

export function referenceApprovalDecision(input: {
  yay: bigint;
  nay: bigint;
  abstain: bigint;
  requiredParticipation: bigint;
  requiredApprovalBp: bigint;
}): ReferenceDecision {
  const totalParticipatingVotes = input.yay + input.nay + input.abstain;
  const totalVotes = input.yay + input.nay;
  const hasApprovalVotes = totalVotes > 0n;
  const approvalBp =
    (input.yay * REFERENCE_BASIS_POINTS) / (hasApprovalVotes ? totalVotes : 1n);
  const participationMet =
    totalParticipatingVotes >= input.requiredParticipation;
  const approved =
    participationMet &&
    hasApprovalVotes &&
    approvalBp >= input.requiredApprovalBp;

  return {
    totalParticipatingVotes,
    requiredParticipation: input.requiredParticipation,
    participationMet,
    totalVotes,
    hasApprovalVotes,
    approvalBp,
    approved,
    voteResult: approved ? "approved" : "rejected",
  };
}

export function referenceTotalPayout(proposalAmount: bigint): bigint {
  return proposalAmount + proposalAmount / REFERENCE_BOND_AMOUNT_DIVISOR;
}

/**
 * This function models only field and decision conditions that are necessary
 * for tallyVotes() to succeed. A positive result does not prove full contract
 * reachability. Full reachability also needs the contract state, lifecycle,
 * action-state history, verified proofs, proof-bound voting ledger, and
 * default-token treasury-account witness.
 */
export function assessReferenceFinalTally(input: {
  lifecycleId: bigint;
  expectedLifecycleId: bigint;
  yay: bigint;
  nay: bigint;
  abstain: bigint;
  voteResult: "approved" | "rejected";
  requiredParticipation: bigint;
  requiredApprovalBp: bigint;
}): ReferenceFinalTallyAssessment {
  const reasons: string[] = [];
  if (
    input.lifecycleId < 0n ||
    input.lifecycleId > REFERENCE_UINT32_MAX ||
    input.lifecycleId !== input.expectedLifecycleId
  ) {
    reasons.push("lifecycle mismatch");
  }
  for (const [label, value] of [
    ["yay", input.yay],
    ["nay", input.nay],
    ["abstain", input.abstain],
  ] as const) {
    if (value < 0n || value > REFERENCE_UINT64_MAX) {
      reasons.push(`${label} is outside UInt64`);
    }
  }

  if (reasons.length > 0) {
    return {
      claimClass: "CONTRACT_PROVED",
      passesNecessaryConditions: false,
      fullReachabilityProved: false,
      reasons,
      decision: null,
    };
  }

  const decision = referenceApprovalDecision({
    yay: input.yay,
    nay: input.nay,
    abstain: input.abstain,
    requiredParticipation: input.requiredParticipation,
    requiredApprovalBp: input.requiredApprovalBp,
  });
  if (!decision.participationMet) {
    reasons.push("participation is below the contract threshold");
  }
  if (!decision.hasApprovalVotes) {
    reasons.push("the tally has no approval votes");
  }
  if (decision.voteResult !== input.voteResult) {
    reasons.push("the event result differs from the contract decision");
  }

  return {
    claimClass:
      reasons.length === 0
        ? "CONTRACT_NECESSARY_CONDITIONS"
        : "CONTRACT_PROVED",
    passesNecessaryConditions: reasons.length === 0,
    fullReachabilityProved: false,
    reasons,
    decision,
  };
}
