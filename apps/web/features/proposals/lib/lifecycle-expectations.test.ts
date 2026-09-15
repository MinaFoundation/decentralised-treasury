import { expect, it } from "vitest";
import { lifecycleExpectations } from "../../../e2e/utils/lifecycle-expectations";

it.each([
  {
    name: "lifecycle 0: 1 MINA proposal, five 100 MINA voters",
    amount: 1_000_000_000n,
    total: 1_500_000_000_000n,
    expected: {
      requiredParticipationBp: "2058",
      requiredApprovalBp: "5118",
      requiredParticipation: "308700000000",
      amountWithBond: "1100000000",
    },
  },
  {
    name: "lifecycle 1: 2 MINA proposal, five 200 MINA voters",
    amount: 2_000_000_000n,
    total: 2_000_000_000_000n,
    expected: {
      requiredParticipationBp: "2115",
      requiredApprovalBp: "5137",
      requiredParticipation: "423000000000",
      amountWithBond: "2200000000",
    },
  },
])("snapshot acceptance oracle: $name", ({ amount, total, expected }) => {
  expect(lifecycleExpectations(amount, 1_000_000_000_000n, total)).toEqual(
    expected,
  );
});
