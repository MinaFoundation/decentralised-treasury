import type { TreasuryLifecyclePeriodId } from "@repo/ui/treasury-lifecycle-period-info";
import type { TreasuryProposalDetailProposal } from "@repo/ui/treasury-proposal-detail";
import type { TreasuryProposalTableEntry } from "@repo/ui/treasury-proposals-table";

function capitalizePeriod(period: TreasuryLifecyclePeriodId): TreasuryProposalTableEntry["period"] {
  switch (period) {
    case "proposal":
      return "Proposal";
    case "exploration":
      return "Exploration";
    case "voting":
      return "Voting";
    case "cooldown":
    default:
      return "Cooldown";
  }
}

function derivePresentationPeriod(
  proposalLifecycleId: number | undefined,
  currentLifecycleId: number | undefined,
  currentPeriod: TreasuryLifecyclePeriodId | undefined,
): TreasuryProposalTableEntry["period"] | undefined {
  if (proposalLifecycleId === undefined || currentLifecycleId === undefined) {
    return undefined;
  }

  if (proposalLifecycleId < currentLifecycleId) {
    return "Cooldown";
  }

  if (proposalLifecycleId > currentLifecycleId) {
    return "Proposal";
  }

  if (!currentPeriod) {
    return undefined;
  }

  return capitalizePeriod(currentPeriod);
}

export function applyDerivedProposalPresentationToEntry(
  entry: TreasuryProposalTableEntry,
  currentLifecycleId: number | undefined,
  currentPeriod: TreasuryLifecyclePeriodId | undefined,
): TreasuryProposalTableEntry {
  const period = derivePresentationPeriod(entry.lifecycleId, currentLifecycleId, currentPeriod);
  return period ? { ...entry, period } : entry;
}

export function applyDerivedProposalPresentationToDetail(
  proposal: TreasuryProposalDetailProposal,
  currentLifecycleId: number | undefined,
  currentPeriod: TreasuryLifecyclePeriodId | undefined,
): TreasuryProposalDetailProposal {
  const period = derivePresentationPeriod(proposal.lifecycleId, currentLifecycleId, currentPeriod);
  return period ? { ...proposal, period } : proposal;
}
