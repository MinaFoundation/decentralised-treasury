import type { PrivateKey, PublicKey } from "o1js";

export interface UnsignedMinaTransaction {
  toJSON(): string;
}

export interface SendableMinaTransaction {
  send(): Promise<{ hash?: string; wait?: () => Promise<unknown> }>;
}

export type TransactionSigner = (
  transaction: UnsignedMinaTransaction,
) => Promise<SendableMinaTransaction>;

export function resolveSigningPublicKey(options: {
  label: string;
  privateKey?: PrivateKey;
  publicKey?: PublicKey;
}): PublicKey {
  const publicKey = options.publicKey ?? options.privateKey?.toPublicKey();
  if (!publicKey) {
    throw new Error(
      `${options.label} public key or private key is required for transaction signing.`,
    );
  }
  if (
    options.privateKey &&
    !options.privateKey.toPublicKey().equals(publicKey).toBoolean()
  ) {
    throw new Error(
      `${options.label} public key does not match its private key.`,
    );
  }
  return publicKey;
}

export function requireInMemoryPrivateKeys(options: {
  transactionSigner?: TransactionSigner;
  keys: Array<{ label: string; privateKey?: PrivateKey }>;
}): PrivateKey[] {
  if (options.transactionSigner) return [];
  return options.keys.map(({ label, privateKey }) => {
    if (!privateKey) {
      throw new Error(
        `${label} private key is required without an external transaction signer.`,
      );
    }
    return privateKey;
  });
}
