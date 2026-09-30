// Keep these values free of o1js imports for browser form validation.
export const BOND_AMOUNT_DIVISOR = 10;

// Nanomina: a 10 MINA proposal requires a bond of at least 1 MINA.
export const MIN_PROPOSAL_AMOUNT = 1_000_000_000n * BigInt(BOND_AMOUNT_DIVISOR);

export function parseProposalAmountMinaToNanomina(value: string): bigint {
  const normalized = value.replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("Enter a valid MINA amount.");
  }
  const [whole = "0", fraction = ""] = normalized.split(".");
  return (
    BigInt(whole) * 1_000_000_000n + BigInt(`${fraction}000000000`.slice(0, 9))
  );
}

export function assertMinimumProposalAmount(amount: bigint): void {
  if (amount < MIN_PROPOSAL_AMOUNT) {
    throw new Error(
      "Proposal amount must be at least 10 MINA (10000000000 nanomina).",
    );
  }
}
