import type { PrivateKey } from "o1js";

export interface UnsignedMinaTransaction {
  toJSON(): string;
  sign(privateKeys: PrivateKey[]): SendableMinaTransaction;
}

export interface SendableMinaTransaction {
  send(): Promise<{ hash?: string; wait?: () => Promise<unknown> }>;
}

export type TransactionSigner = (
  transaction: UnsignedMinaTransaction,
) => Promise<SendableMinaTransaction>;

export function transactionSigningPublicKeys(
  transaction: Pick<UnsignedMinaTransaction, "toJSON">,
): Set<string> {
  const command = JSON.parse(transaction.toJSON()) as {
    feePayer: { body: { publicKey: string } };
    accountUpdates: Array<{
      body: { publicKey: string; authorizationKind: { isSigned: boolean } };
    }>;
  };
  return new Set([
    command.feePayer.body.publicKey,
    ...command.accountUpdates
      .filter((update) => update.body.authorizationKind.isSigned)
      .map((update) => update.body.publicKey),
  ]);
}

export function createInMemoryTransactionSigner(
  privateKeys: PrivateKey[],
): TransactionSigner {
  const keys = new Map(
    privateKeys.map((key) => [key.toPublicKey().toBase58(), key]),
  );
  return async (transaction) => {
    const requiredKeys = [...transactionSigningPublicKeys(transaction)].map(
      (publicKey) => {
        const key = keys.get(publicKey);
        if (!key) {
          throw new Error(
            `Private key is required for transaction signer ${publicKey}.`,
          );
        }
        return key;
      },
    );
    return transaction.sign(requiredKeys);
  };
}
