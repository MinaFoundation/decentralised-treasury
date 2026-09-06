import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateProposalPayoutAmounts } from "../src/proposal-payout.js";

describe("proposal payout response fields", () => {
  it("uses exact nanomina arithmetic above Number.MAX_SAFE_INTEGER", () => {
    assert.deepEqual(calculateProposalPayoutAmounts("9007199254740993", "0"), {
      totalPayoutAmount: "9907919180215092",
      remainingPayoutAmount: "9907919180215092",
      payoutAmountIntegrity: true,
    });
  });

  it("uses the contract bond floor and accepts an exact full payout", () => {
    assert.deepEqual(calculateProposalPayoutAmounts("11", "12"), {
      totalPayoutAmount: "12",
      remainingPayoutAmount: "0",
      payoutAmountIntegrity: true,
    });
  });

  it("fails closed for overpayment and a UInt64 payout-total overflow", () => {
    assert.deepEqual(calculateProposalPayoutAmounts("10", "12"), {
      totalPayoutAmount: "11",
      remainingPayoutAmount: "0",
      payoutAmountIntegrity: false,
    });
    assert.deepEqual(
      calculateProposalPayoutAmounts("18446744073709551615", "0"),
      {
        totalPayoutAmount: "20291418481080506776",
        remainingPayoutAmount: "0",
        payoutAmountIntegrity: false,
      },
    );
  });
});
