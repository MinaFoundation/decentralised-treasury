"use client";

import { Buffer } from "buffer";
import { Field, PublicKey, Transaction } from "o1js";
import {
  signFieldWithLedgerClient,
  signTransactionWithLedgerClient,
} from "@repo/sdk/src/signing/ledger-signing.js";

async function withLedger<T>(
  operation: (ledger: import("@zondax/ledger-mina-js").MinaApp) => Promise<T>,
): Promise<T> {
  const globals = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
  globals.Buffer ??= Buffer;

  const [transportModule, { MinaApp }] = await Promise.all([
    import("@ledgerhq/hw-transport-webhid"),
    import("@zondax/ledger-mina-js"),
  ]);
  const TransportWebHID = transportModule.default as unknown as {
    create(): Promise<ConstructorParameters<typeof MinaApp>[0]>;
  };
  const transport = await TransportWebHID.create();
  try {
    return await operation(new MinaApp(transport));
  } finally {
    await transport.close();
  }
}

function configuredFieldSignerPublicKey(): PublicKey {
  const value = process.env.NEXT_PUBLIC_LEDGER_SIGNER_PUBLIC_KEY?.trim();
  if (!value) {
    throw new Error(
      "NEXT_PUBLIC_LEDGER_SIGNER_PUBLIC_KEY is required for Ledger field signing.",
    );
  }
  return PublicKey.fromBase58(value);
}

/** Sign all required zkApp authorization slots with the connected Ledger. */
export async function signTxWithLedger(transaction: {
  toJSON(): string;
}): Promise<ReturnType<typeof Transaction.fromJSON>> {
  return await withLedger((ledger) =>
    signTransactionWithLedgerClient(transaction, ledger),
  );
}

/** Sign one break-glass field with the configured Ledger public key. */
export async function signFieldWithLedger(field: Field) {
  const expectedPublicKey = configuredFieldSignerPublicKey();
  return await withLedger((ledger) =>
    signFieldWithLedgerClient(field, ledger, expectedPublicKey),
  );
}
