"use client";

import {
  connectAuroAccount,
  getAuroWalletClient,
  signZkappWithAuro,
} from "./auro-wallet-client";
import type {
  ProviderSession,
  WalletSigningProvider,
  ZkappSigningRequest,
} from "../wallet-provider";

function createSession(address: string): ProviderSession {
  return {
    providerId: "auro",
    address,
    displayName: "Auro",
    details: [{ label: "Wallet", value: "Auro" }],
  };
}

export const auroWalletProvider: WalletSigningProvider = {
  id: "auro",
  name: "Auro",

  async connect() {
    return createSession(await connectAuroAccount());
  },

  restore(record) {
    const value = record as { address?: unknown };
    if (typeof value.address !== "string") {
      throw new Error("The saved Auro session is invalid.");
    }
    return createSession(value.address);
  },

  async signZkapp(session, request: ZkappSigningRequest) {
    return await signZkappWithAuro({
      transactionJson: request.transactionJson,
      expectedSenderAddress: session.address,
      fee: request.fee,
      memo: request.memo,
      nonce: request.nonce,
    });
  },

  async disconnect() {},

  subscribe(_session, onChange) {
    const client = getAuroWalletClient();
    if (!client?.on) return;
    const handleAccountsChanged = (accounts: string[]) => {
      const address = accounts[0];
      onChange(address ? createSession(address) : null);
    };
    client.on("accountsChanged", handleAccountsChanged);
    return () =>
      client.removeListener?.("accountsChanged", handleAccountsChanged);
  },
};
