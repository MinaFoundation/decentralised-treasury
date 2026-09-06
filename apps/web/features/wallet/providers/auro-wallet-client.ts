"use client";

interface AuroResult {
  code?: number;
  message?: string;
  signedData?: string | { zkappCommand?: unknown };
}

export interface AuroWalletClient {
  requestAccounts?: () => Promise<string[]>;
  request?: (args: { method: string; params?: unknown }) => Promise<AuroResult>;
  sendTransaction?: (args: {
    onlySign?: boolean;
    transaction: string | object;
    feePayer?: { fee?: number; memo?: string };
    nonce?: number;
  }) => Promise<AuroResult>;
  on?: (eventName: string, listener: (accounts: string[]) => void) => void;
  removeListener?: (
    eventName: string,
    listener: (accounts: string[]) => void,
  ) => void;
}

declare global {
  interface Window {
    mina?: AuroWalletClient;
  }
}

export function getAuroWalletClient(): AuroWalletClient | undefined {
  return typeof window === "undefined" ? undefined : window.mina;
}

export async function connectAuroAccount(): Promise<string> {
  const accounts = await getAuroWalletClient()?.requestAccounts?.();
  const address = accounts?.[0];
  if (!address) {
    throw new Error("Auro is not installed or has no selected account.");
  }
  return address;
}

function readFeePayer(transactionJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(transactionJson);
  } catch {
    throw new Error("Prepared transaction data is invalid. Please try again.");
  }
  const value = parsed as {
    feePayer?: { body?: { publicKey?: unknown } };
  };
  if (typeof value.feePayer?.body?.publicKey !== "string") {
    throw new Error("Prepared transaction does not contain a fee payer.");
  }
  return value.feePayer.body.publicKey;
}

function extractSignedCommand(signedData: AuroResult["signedData"]): unknown {
  if (!signedData) {
    throw new Error("Auro wallet did not return signed transaction data.");
  }
  const parsed =
    typeof signedData === "string" ? JSON.parse(signedData) : signedData;
  if (parsed && typeof parsed === "object" && "zkappCommand" in parsed) {
    return parsed.zkappCommand;
  }
  throw new Error("Auro wallet returned data without a zkApp command.");
}

export async function signZkappWithAuro(input: {
  transactionJson: string;
  expectedSenderAddress: string;
  fee: string;
  memo: string;
  nonce?: number;
}): Promise<unknown> {
  const provider = getAuroWalletClient();
  if (
    !provider?.requestAccounts ||
    (!provider.sendTransaction && !provider.request)
  ) {
    throw new Error("Auro does not support zkApp transaction signing.");
  }
  if (readFeePayer(input.transactionJson) !== input.expectedSenderAddress) {
    throw new Error("The prepared transaction has a different fee payer.");
  }
  const selectedAddress = (await provider.requestAccounts())[0];
  if (selectedAddress !== input.expectedSenderAddress) {
    throw new Error(
      `Auro is using ${selectedAddress ?? "no account"}, not ${input.expectedSenderAddress}.`,
    );
  }
  const args = {
    onlySign: true,
    transaction: input.transactionJson,
    feePayer: { fee: Number(input.fee), memo: input.memo },
    nonce: input.nonce,
  };
  const result = provider.sendTransaction
    ? await provider.sendTransaction(args)
    : await provider.request!({
        method: "mina_sendTransaction",
        params: [args],
      });
  if (result.code && result.code !== 0) {
    throw new Error(
      result.message || `Auro rejected the transaction with code ${result.code}.`,
    );
  }
  return extractSignedCommand(result.signedData);
}
