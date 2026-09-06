"use client";

import { resolveMinaNetworkId } from "../../endpoint-settings/lib/mina-network-id";
import {
  connectLedgerAccount,
  signTxWithLedger,
  validateLedgerAccountIndex,
} from "../../ledger/lib/ledger-signing";
import type {
  ProviderSession,
  WalletSigningProvider,
  ZkappSigningRequest,
} from "../wallet-provider";

interface LedgerSessionData {
  accountIndex: number;
}

function readLedgerData(session: ProviderSession): LedgerSessionData {
  const value = session.data as { accountIndex?: unknown } | undefined;
  const accountIndex = value?.accountIndex;
  if (typeof accountIndex !== "number") {
    throw new Error("The Ledger account index is missing.");
  }
  validateLedgerAccountIndex(accountIndex);
  return { accountIndex };
}

function createSession(address: string, accountIndex: number): ProviderSession {
  validateLedgerAccountIndex(accountIndex);
  return {
    providerId: "ledger",
    address,
    displayName: "Ledger",
    details: [
      { label: "Wallet", value: "Ledger" },
      { label: "Account index", value: String(accountIndex) },
    ],
    data: { accountIndex } satisfies LedgerSessionData,
  };
}

export const ledgerWalletProvider: WalletSigningProvider = {
  id: "ledger",
  name: "Ledger",

  async connect(input) {
    const value = input as { accountIndex?: unknown } | undefined;
    if (typeof value?.accountIndex !== "number") {
      throw new Error("Ledger account index is required.");
    }
    const address = await connectLedgerAccount(value.accountIndex);
    return createSession(address, value.accountIndex);
  },

  restore(record) {
    const value = record as {
      address?: unknown;
      accountIndex?: unknown;
    };
    if (
      typeof value.address !== "string" ||
      typeof value.accountIndex !== "number"
    ) {
      throw new Error("The saved Ledger session is invalid.");
    }
    return createSession(value.address, value.accountIndex);
  },

  async signZkapp(session, request: ZkappSigningRequest) {
    const { Transaction } = await import("o1js");
    const networkId = resolveMinaNetworkId(request.networkId);
    const transaction = await Transaction.fromJSON(
      JSON.parse(request.transactionJson),
    );
    const signed = await signTxWithLedger(
      transaction,
      session.address,
      readLedgerData(session).accountIndex,
      networkId,
    );
    return JSON.parse(signed.toJSON());
  },

  async disconnect() {},
};
