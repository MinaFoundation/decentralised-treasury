"use client";

import type { LedgerSigningProgress } from "@repo/sdk/src/signing/ledger-signing.js";
import { formatLedgerSigningHash } from "@repo/sdk/src/signing/signing-hash-format.js";
import type {
  WalletSigningReview,
  WalletSigningReviewHandler,
} from "./wallet/wallet-provider";

export function ledgerSigningReviewHandler(
  onReview?: WalletSigningReviewHandler,
) {
  return (progress: LedgerSigningProgress): void => {
    if (progress.type === "signature-requested") {
      onReview?.({
        wallet: "ledger",
        hash: formatLedgerSigningHash(progress.hash),
        publicKey: progress.publicKey,
        accountIndex: progress.accountIndex,
      });
    } else {
      onReview?.(null);
    }
  };
}

export function WalletSigningReviewCard({
  review,
}: {
  review: WalletSigningReview;
}) {
  return (
    <section
      aria-label="Wallet signing review"
      aria-live="polite"
      className="w-full min-w-0 rounded-xl border border-primary/30 bg-muted/30 p-4 text-left"
    >
      <h5 className="text-sm font-semibold">Ledger signing hash</h5>
      <p className="mt-2 text-sm text-muted-foreground">
        Compare this value with the hash on Ledger before approval.
      </p>
      <code
        aria-label="Ledger signing hash"
        className="mt-3 block select-all break-all font-mono text-sm leading-6"
      >
        {review.hash}
      </code>
      <p className="mt-2 text-xs text-muted-foreground">
        Account index: {review.accountIndex}. Each signature request can show a
        different hash.
      </p>
      <p className="mt-3 text-xs text-muted-foreground">Signing account</p>
      <code className="block select-all break-all text-xs leading-5">
        {review.publicKey}
      </code>
    </section>
  );
}
