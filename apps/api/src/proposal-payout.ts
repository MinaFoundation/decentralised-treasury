import { BOND_AMOUNT_DIVISOR } from "@repo/sdk/src/provable/contracts/treasury-constants.js";
import { MAX_UINT64 } from "./processors/proposals/proposal-contract-domain.js";

export interface ProposalPayoutAmounts {
  totalPayoutAmount: string;
  remainingPayoutAmount: string;
  payoutAmountIntegrity: boolean;
}

/**
 * Calculate proposal payout fields with the same UInt64 boundary used by the
 * proposal contract. The mathematical total remains visible for diagnostics,
 * but an invalid contract total has no executable remaining amount.
 */
export function calculateProposalPayoutAmounts(
  amount: string,
  paidOutAmount: string,
): ProposalPayoutAmounts {
  const proposalAmount = BigInt(amount);
  const paid = BigInt(paidOutAmount);
  const total = proposalAmount + proposalAmount / BigInt(BOND_AMOUNT_DIVISOR);
  const payoutAmountIntegrity =
    proposalAmount >= 0n &&
    proposalAmount <= MAX_UINT64 &&
    total <= MAX_UINT64 &&
    paid >= 0n &&
    paid <= total;

  return {
    totalPayoutAmount: total.toString(),
    remainingPayoutAmount: payoutAmountIntegrity
      ? (total - paid).toString()
      : "0",
    payoutAmountIntegrity,
  };
}
