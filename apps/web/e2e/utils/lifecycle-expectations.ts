/** Independent integer oracle for the documented snapshot-based thresholds.
 * Inputs are nanomina. Constants match treasury-constants.ts; no chain calls.
 */
export function lifecycleExpectations(
  amount: bigint,
  ownerSnapshotBalance: bigint,
  totalCurrency: bigint,
) {
  const ratio = (amount * 10_000n) / ownerSnapshotBalance;
  const capped = ratio > 10_000n ? 10_000n : ratio;
  const curve = (constant: bigint) =>
    (capped * 10_000n) / (capped + (constant * (10_000n - capped)) / 10_000n);
  const participation = 2_000n + (3_000n * curve(500n)) / 10_000n;
  const approval = 5_100n + (1_900n * curve(1_000n)) / 10_000n;
  return {
    requiredParticipationBp: String(participation),
    requiredApprovalBp: String(approval),
    requiredParticipation: String((totalCurrency * participation) / 10_000n),
    amountWithBond: String(amount + amount / 10n),
  };
}
