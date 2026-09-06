"use client";

import { Buffer } from "buffer";
import type {
  ProviderSession,
  WalletSigningProvider,
  ZkappSigningRequest,
} from "@repo/ui/wallet-provider";
import type { OperationPackage } from "./operations";

interface AuroResult {
  hash?: string;
  code?: number;
  message?: string;
  signedData?: string | { zkappCommand?: unknown };
}

interface AuroProvider {
  requestAccounts?: () => Promise<string[]>;
  request?: (args: { method: string; params?: unknown }) => Promise<AuroResult>;
  sendTransaction?: (args: {
    onlySign?: boolean;
    transaction: string | object;
    feePayer?: { fee?: number; memo?: string };
  }) => Promise<AuroResult>;
  on?: (eventName: string, listener: (accounts: string[]) => void) => void;
  removeListener?: (
    eventName: string,
    listener: (accounts: string[]) => void,
  ) => void;
}

declare global {
  interface Window {
    mina?: AuroProvider;
  }
}

function resolveEndpointUrl(value: string): string {
  return new URL(value, window.location.origin).toString();
}

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
    create(): Promise<ConstructorParameters<typeof MinaApp>[0]>;
    request(): Promise<ConstructorParameters<typeof MinaApp>[0]>;
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

function validateLedgerAccountIndex(accountIndex: number): void {
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
  if (typeof window === "undefined" || !window.isSecureContext) return false;
  return Boolean((navigator as Navigator & { hid?: unknown }).hid);
}

export async function connectLedgerAccount(
  accountIndex: number,
): Promise<string> {
  validateLedgerAccountIndex(accountIndex);
  if (!isLedgerBrowserSupported()) {
    throw new Error(
      "Ledger requires WebHID in a secure Chromium browser context.",
    );
  }
  const { PublicKey } = await import("o1js");
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

export async function signOperationWithLedger(
  operation: OperationPackage,
  participantIndex: number,
  ledgerAccountIndex: number,
): Promise<string> {
  const [{ Field, PublicKey }, { signFieldWithLedgerClient }] = await Promise.all([
    import("o1js"),
    import("@repo/sdk/src/signing/ledger-signing.js"),
  ]);
  const expectedPublicKey = PublicKey.fromBase58(
    operation.participants[participantIndex]!,
  );
  const signature = await withLedger((ledger) =>
    signFieldWithLedgerClient(
      Field(operation.messageHash),
      ledger,
      expectedPublicKey,
      ledgerAccountIndex,
    ),
  );
  return signature.toBase58();
}

export async function connectAuro(): Promise<string> {
  const accounts = await window.mina?.requestAccounts?.();
  const account = accounts?.[0];
  if (!account) throw new Error("Auro did not return an account.");
  return account;
}

export function isAuroInstalled(): boolean {
  return typeof window !== "undefined" && Boolean(window.mina);
}

function extractSignedCommand(signedData: AuroResult["signedData"]): unknown {
  if (!signedData) throw new Error("Auro did not return signed transaction data.");
  const parsed = typeof signedData === "string" ? JSON.parse(signedData) : signedData;
  if (parsed && typeof parsed === "object" && "zkappCommand" in parsed) {
    return parsed.zkappCommand;
  }
  throw new Error("Auro returned signed data without a zkApp command.");
}

export async function signWithAuro(
  transactionJson: string,
  senderAddress: string,
  fee: string,
  memo: string,
): Promise<unknown> {
  const provider = window.mina;
  if (!provider?.requestAccounts || (!provider.sendTransaction && !provider.request)) {
    throw new Error("Auro is not installed or does not support zkApp signing.");
  }
  const selected = (await provider.requestAccounts())[0];
  if (selected !== senderAddress) {
    throw new Error(`Auro is using ${selected ?? "no account"}, not ${senderAddress}.`);
  }
  const parsed = JSON.parse(transactionJson) as {
    feePayer?: { body?: { publicKey?: string } };
  };
  if (parsed.feePayer?.body?.publicKey !== senderAddress) {
    throw new Error("The prepared transaction has another fee payer.");
  }
  const args = {
    onlySign: true,
    transaction: transactionJson,
    feePayer: { fee: Number(fee), memo },
  };
  const result = provider.sendTransaction
    ? await provider.sendTransaction(args)
    : await provider.request!({ method: "mina_sendTransaction", params: [args] });
  if (result.code && result.code !== 0) {
    throw new Error(result.message || `Auro rejected the transaction with code ${result.code}.`);
  }
  return extractSignedCommand(result.signedData);
}

export async function signTransactionWithLedger(
  transactionJson: string,
  accountIndices: ReadonlyMap<string, number>,
  networkId: string,
): Promise<unknown> {
  const [{ Transaction }, { signTransactionWithLedgerClient }] = await Promise.all([
    import("o1js"),
    import("@repo/sdk/src/signing/ledger-signing.js"),
  ]);
  const transaction = Transaction.fromJSON(JSON.parse(transactionJson));
  const normalizedNetworkId = networkId.toLowerCase();
  if (
    normalizedNetworkId !== "mainnet" &&
    normalizedNetworkId !== "testnet" &&
    normalizedNetworkId !== "devnet"
  ) {
    throw new Error(`Ledger does not support network ID ${networkId}.`);
  }
  const signed = await withLedger((ledger) =>
    signTransactionWithLedgerClient(
      transaction,
      ledger,
      accountIndices,
      normalizedNetworkId,
    ),
  );
  return JSON.parse(signed.toJSON());
}

function createAuroSession(address: string): ProviderSession {
  return {
    providerId: "auro",
    address,
    displayName: "Auro",
    details: [{ label: "Wallet", value: "Auro" }],
  };
}

function createLedgerSession(
  address: string,
  accountIndex: number,
): ProviderSession {
  validateLedgerAccountIndex(accountIndex);
  return {
    providerId: "ledger",
    address,
    displayName: "Ledger",
    details: [
      { label: "Wallet", value: "Ledger" },
      { label: "Account index", value: String(accountIndex) },
    ],
    data: { accountIndex },
  };
}

function readLedgerSessionIndex(session: ProviderSession): number {
  const accountIndex = (
    session.data as { accountIndex?: unknown } | undefined
  )?.accountIndex;
  if (typeof accountIndex !== "number") {
    throw new Error("The Ledger account index is missing.");
  }
  validateLedgerAccountIndex(accountIndex);
  return accountIndex;
}

const auroWalletProvider: WalletSigningProvider = {
  id: "auro",
  name: "Auro",
  async connect() {
    return createAuroSession(await connectAuro());
  },
  restore(record) {
    const value = record as { address?: unknown };
    if (typeof value.address !== "string") {
      throw new Error("The saved Auro session is invalid.");
    }
    return createAuroSession(value.address);
  },
  async signZkapp(session, request: ZkappSigningRequest) {
    return await signWithAuro(
      request.transactionJson,
      session.address,
      request.fee,
      request.memo,
    );
  },
  async disconnect() {},
  subscribe(_session, onChange) {
    const provider = window.mina;
    if (!provider?.on) return;
    const handleAccountsChanged = (accounts: string[]) => {
      const address = accounts[0];
      onChange(address ? createAuroSession(address) : null);
    };
    provider.on("accountsChanged", handleAccountsChanged);
    return () =>
      provider.removeListener?.("accountsChanged", handleAccountsChanged);
  },
};

const ledgerWalletProvider: WalletSigningProvider = {
  id: "ledger",
  name: "Ledger",
  async connect(input) {
    const accountIndex = (input as { accountIndex?: unknown } | undefined)
      ?.accountIndex;
    if (typeof accountIndex !== "number") {
      throw new Error("Ledger account index is required.");
    }
    return createLedgerSession(
      await connectLedgerAccount(accountIndex),
      accountIndex,
    );
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
    return createLedgerSession(value.address, value.accountIndex);
  },
  async signZkapp(session, request: ZkappSigningRequest) {
    return await signTransactionWithLedger(
      request.transactionJson,
      new Map([[session.address, readLedgerSessionIndex(session)]]),
      request.networkId,
    );
  },
  async disconnect() {},
};

export const backofficeWalletProviders = [
  auroWalletProvider,
  ledgerWalletProvider,
] as const;

export function getSessionLedgerAccountIndex(
  session: ProviderSession | null,
): number | null {
  return session?.providerId === "ledger"
    ? readLedgerSessionIndex(session)
    : null;
}

export async function submitSignedCommand(
  minaNodeUrl: string,
  command: unknown,
): Promise<string> {
  const response = await fetch(resolveEndpointUrl(minaNodeUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query:
        "mutation BackofficeSend($input: ZkappCommandInput!) { sendZkapp(input: { zkappCommand: $input }) { zkapp { hash id } } }",
      variables: { input: command },
    }),
  });
  const payload = (await response.json()) as {
    data?: { sendZkapp?: { zkapp?: { hash?: string } } };
    errors?: Array<{ message?: string }>;
  };
  const error = payload.errors?.map((item) => item.message).filter(Boolean).join("; ");
  if (!response.ok || error) {
    throw new Error(error || `The Mina node rejected the transaction (${response.status}).`);
  }
  const hash = payload.data?.sendZkapp?.zkapp?.hash;
  if (!hash) throw new Error("The Mina node did not return a transaction hash.");
  return hash;
}

export async function waitForInclusion(
  minaNodeUrl: string,
  transactionHash: string,
  timeoutMs = 180_000,
): Promise<number | undefined> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await fetch(resolveEndpointUrl(minaNodeUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query:
          "query BackofficeInclusion { bestChain(maxLength: 20) { protocolState { consensusState { blockHeight } } transactions { zkappCommands { hash } } } }",
      }),
    });
    const payload = (await response.json()) as {
      data?: {
        bestChain?: Array<{
          protocolState?: { consensusState?: { blockHeight?: string } };
          transactions?: { zkappCommands?: Array<{ hash?: string }> };
        }>;
      };
    };
    const block = payload.data?.bestChain?.find((candidate) =>
      candidate.transactions?.zkappCommands?.some(
        (command) => command.hash === transactionHash,
      ),
    );
    if (block) {
      const height = Number(block.protocolState?.consensusState?.blockHeight);
      return Number.isFinite(height) ? height : undefined;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2_500));
  }
  throw new Error("Timed out while waiting for transaction inclusion.");
}
