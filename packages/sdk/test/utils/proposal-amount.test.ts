import assert from "node:assert/strict";
import { it } from "node:test";
import { UInt64 } from "o1js";
import {
  BOND_AMOUNT_DIVISOR,
  MIN_PROPOSAL_AMOUNT,
  assertMinimumProposalAmount,
  parseProposalAmountMinaToNanomina,
} from "../../src/utils/proposal-amount.js";
import { SqliteTreasuryOwnerService } from "../../src/services/sqlite/sqlite-treasury-owner-service.js";

it("requires exactly 10 MINA and preserves integer bond rounding", () => {
  assert.equal(MIN_PROPOSAL_AMOUNT, 10_000_000_000n);
  assert.equal(
    MIN_PROPOSAL_AMOUNT / BigInt(BOND_AMOUNT_DIVISOR),
    1_000_000_000n,
  );
  for (const value of ["0", "0.000000001", "9.999999999"]) {
    assert.throws(
      () =>
        assertMinimumProposalAmount(parseProposalAmountMinaToNanomina(value)),
      /at least 10 MINA/,
    );
  }
  for (const [value, expected] of [
    ["10", 10_000_000_000n],
    ["10.000000001", 10_000_000_001n],
    ["9,600.123456789", 9_600_123_456_789n],
    ["9.9999999999", 9_999_999_999n],
  ] as const) {
    assert.equal(parseProposalAmountMinaToNanomina(value), expected);
  }
  assert.doesNotThrow(() => assertMinimumProposalAmount(MIN_PROPOSAL_AMOUNT));
});

it("rejects a low SDK amount before accessing a network or signer", async () => {
  const service = new SqliteTreasuryOwnerService();
  // No network, keys, or signer are supplied: validation must run first.
  await assert.rejects(
    () =>
      service.createProposal({
        amount: UInt64.from(MIN_PROPOSAL_AMOUNT - 1n),
      } as Parameters<typeof service.createProposal>[0]),
    /at least 10 MINA/,
  );
});
