"use client";

import { Buffer } from "buffer";
import { Field, PublicKey, Transaction, type NetworkId } from "o1js";
import {
  signFieldWithLedgerClient,
  signTransactionWithLedgerClient,
} from "@repo/sdk/src/signing/ledger-signing.js";

type BrowserLedgerTransport = ConstructorParameters<
  typeof import("@zondax/ledger-mina-js").MinaApp
>[0];

async function withLedger<T>(
  operation: (ledger: import("@zondax/ledger-mina-js").MinaApp) => Promise<T>,
  requestDevice = false,
): Promise<T> {
  const globals = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
  globals.Buffer ??= Buffer;

  const [transportModule, { MinaApp }] = await Promise.all([
    import("@ledgerhq/hw-transport-webhid"),
    import("@zondax/ledger-mina-js"),
  ]);
  const TransportWebHID = transportModule.default as unknown as {
    create(): Promise<BrowserLedgerTransport>;
    request(): Promise<BrowserLedgerTransport>;
  };
  const transport = requestDevice
    ? await TransportWebHID.request()
    : await TransportWebHID.create();
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

export function validateLedgerAccountIndex(accountIndex: number): void {
  if (
    !Number.isSafeInteger(accountIndex) ||
    accountIndex < 0 ||
    accountIndex > 0xffff_ffff
  ) {
    throw new Error(
      "Ledger account index must be an integer from 0 through 4294967295.",
    );
  }
}

export function isLedgerBrowserSupported(): boolean {
  if (typeof window === "undefined" || !window.isSecureContext) {
    return false;
  }
  return Boolean(
    (navigator as Navigator & { hid?: unknown }).hid,
  );
}

export async function connectLedgerAccount(accountIndex: number): Promise<string> {
  validateLedgerAccountIndex(accountIndex);
  if (!isLedgerBrowserSupported()) {
    throw new Error(
      "Ledger requires WebHID in a secure Chromium browser context.",
    );
  }
  return await withLedger(async (ledger) => {
    const response = await ledger.getAddress(accountIndex, true);
    if (response.returnCode !== "9000" || !response.publicKey) {
      const detail =
        response.message ??
        response.statusText ??
        `status ${response.returnCode}`;
      throw new Error(`Ledger address request failed: ${detail}`);
    }
    return PublicKey.fromBase58(response.publicKey).toBase58();
  }, true);
}

/** Sign the authorization slots owned by the selected Ledger account. */
export async function signTxWithLedger(transaction: {
  toJSON(): string;
}, address: string, accountIndex: number, networkId: NetworkId): Promise<ReturnType<typeof Transaction.fromJSON>> {
  validateLedgerAccountIndex(accountIndex);
  const normalizedAddress = PublicKey.fromBase58(address).toBase58();
  return await withLedger((ledger) =>
    signTransactionWithLedgerClient(
      transaction,
      ledger,
      new Map([[normalizedAddress, accountIndex]]),
      networkId,
    ),
  );
}

/** Sign one break-glass field with the configured Ledger public key. */
export async function signFieldWithLedger(field: Field) {
  const expectedPublicKey = configuredFieldSignerPublicKey();
  const accountIndex = Number(
    process.env.NEXT_PUBLIC_LEDGER_SIGNER_ACCOUNT_INDEX,
  );
  validateLedgerAccountIndex(accountIndex);
  return await withLedger((ledger) =>
    signFieldWithLedgerClient(field, ledger, expectedPublicKey, accountIndex),
  );
}
