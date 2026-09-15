import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  ledgerSigningReviewHandler,
  WalletSigningReviewCard,
} from "./wallet-signing-review";

afterEach(cleanup);

it("shows the full Ledger hash and clears it between approval requests", () => {
  const onReview = vi.fn();
  const progress = ledgerSigningReviewHandler(onReview);
  progress({
    type: "signature-requested",
    accountIndex: 7,
    publicKey: "B62signer",
    hash: "11259375",
  });
  const first = onReview.mock.lastCall![0];
  expect(first.hash).toBe(
    "0000000000000000000000000000000000000000000000000000000000abcdef",
  );
  render(<WalletSigningReviewCard review={first} />);
  expect(screen.getByLabelText("Ledger signing hash").textContent).toBe(
    first.hash,
  );
  expect(screen.getByText("B62signer")).toBeTruthy();
  progress({
    type: "signature-verified",
    accountIndex: 7,
    publicKey: "B62signer",
    hash: "11259375",
  });
  expect(onReview).toHaveBeenLastCalledWith(null);
  progress({
    type: "signature-requested",
    accountIndex: 8,
    publicKey: "B62other",
    hash: "12345",
  });
  expect(onReview.mock.lastCall![0]).toEqual({
    wallet: "ledger",
    hash: "0".repeat(60) + "3039",
    publicKey: "B62other",
    accountIndex: 8,
  });
  progress({
    type: "account-verification-started",
    accountIndex: 8,
    publicKey: "B62other",
  });
  expect(onReview).toHaveBeenLastCalledWith(null);
});
