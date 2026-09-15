import { Transaction } from "o1js";
import type { LedgerSigningProgress } from "@repo/sdk/src/signing/ledger-signing.js";
import { formatLedgerSigningHash as deviceHash } from "@repo/sdk/src/signing/signing-hash-format.js";

export async function logTransactionForSigning(transaction: {
  toJSON(): string;
}): Promise<void> {
  console.error(
    `[signing] Transaction ID before signing: ${await Transaction.hash(transaction.toJSON())}`,
  );
}

// Keep progress on stderr so that stdout remains available for command results.
export function logLedgerSigningProgress(
  progress: LedgerSigningProgress,
): void {
  switch (progress.type) {
    case "transaction-commitments":
      console.error(
        `[ledger] Signing commitments (hex, network=${progress.networkId}): commitment=${deviceHash(progress.commitment)}, fullCommitment=${deviceHash(progress.fullCommitment)}`,
      );
      console.error(
        "[ledger] Each signature request shows its Device hash. This signing commitment is separate from the transaction ID.",
      );
      break;
    case "account-verification-started":
      console.error(
        `[ledger] Verify account on the Ledger device (accountIndex=${progress.accountIndex}, expectedPublicKey=${progress.publicKey}).`,
      );
      break;
    case "account-verified":
      console.error(
        `[ledger] Account verified (accountIndex=${progress.accountIndex}, publicKey=${progress.publicKey}).`,
      );
      break;
    case "signature-requested":
      console.error(
        `[ledger] Waiting for signature (accountIndex=${progress.accountIndex}, publicKey=${progress.publicKey}).\n` +
          `[ledger] Device hash: ${deviceHash(progress.hash)}\n` +
          "[ledger] Compare this value with the hash on the Ledger device before approval.",
      );
      break;
    case "signature-verified":
      console.error(
        `[ledger] Signature verified (accountIndex=${progress.accountIndex}, publicKey=${progress.publicKey}, deviceHash=${deviceHash(progress.hash)}).`,
      );
      break;
  }
}
