"use client";

import { resolveEndpointUrl } from "../../endpoint-settings/lib/endpoint-url";

interface AuroSendTransactionResult {
  hash?: string;
  code?: number;
  message?: string;
  signedData?: string | { zkappCommand?: unknown };
}

interface AuroWalletProvider {
  requestAccounts?: () => Promise<string[]>;
  request?: (args: {
    method: string;
    params?: unknown;
  }) => Promise<AuroSendTransactionResult>;
  sendTransaction?: (args: {
    onlySign?: boolean;
    transaction: string | object;
    feePayer?: {
      fee?: number;
      memo?: string;
    };
    nonce?: number;
  }) => Promise<AuroSendTransactionResult>;
}

interface SendZkappGraphQlResponse {
  data?: {
    sendZkapp?: {
      zkapp?: {
        hash?: string;
        id?: string;
      };
    };
  };
  errors?: Array<{ message?: string }>;
}

const SEND_ZKAPP_MUTATION = `
  mutation SendSignedZkapp($zkappCommandInput: ZkappCommandInput!) {
    sendZkapp(input: { zkappCommand: $zkappCommandInput }) {
      zkapp {
        hash
        id
      }
    }
  }
`;

function readFeePayerPublicKey(transactionJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(transactionJson) as unknown;
  } catch {
    throw new Error("Prepared transaction data is invalid. Please try again.");
  }

  const publicKey =
    typeof parsed === "object" &&
    parsed !== null &&
    "feePayer" in parsed &&
    typeof parsed.feePayer === "object" &&
    parsed.feePayer !== null &&
    "body" in parsed.feePayer &&
    typeof parsed.feePayer.body === "object" &&
    parsed.feePayer.body !== null &&
    "publicKey" in parsed.feePayer.body &&
    typeof parsed.feePayer.body.publicKey === "string"
      ? parsed.feePayer.body.publicKey
      : null;

  if (!publicKey) {
    throw new Error(
      "Prepared transaction does not contain a fee payer. Please try again.",
    );
  }

  return publicKey;
}

async function assertAuroAccountMatchesTransaction(
  provider: AuroWalletProvider,
  transactionJson: string,
  expectedSenderAddress: string,
): Promise<void> {
  const feePayerPublicKey = readFeePayerPublicKey(transactionJson);
  if (feePayerPublicKey !== expectedSenderAddress) {
    throw new Error(
      "This transaction was prepared for a different account. Please retry with the currently connected account.",
    );
  }

  if (!provider.requestAccounts) {
    throw new Error(
      "Unable to verify the selected Auro account. Reconnect Auro and try again.",
    );
  }

  const selectedAddress = (await provider.requestAccounts())[0];
  if (!selectedAddress) {
    throw new Error(
      "No account is selected in Auro. Select an account and retry.",
    );
  }
  if (selectedAddress !== expectedSenderAddress) {
    throw new Error(
      `Auro is currently using ${selectedAddress}, but this transaction was prepared for ${expectedSenderAddress}. Switch accounts and retry.`,
    );
  }

  console.info("[auro-wallet] verified transaction signer", {
    selectedAddress,
    feePayerPublicKey,
  });
}

function parseSignedZkappCommand(
  signedData: AuroSendTransactionResult["signedData"],
): unknown {
  if (!signedData) {
    throw new Error("Auro wallet did not return signed transaction data.");
  }

  const parsed =
    typeof signedData === "string"
      ? (JSON.parse(signedData) as unknown)
      : signedData;

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "zkappCommand" in parsed
  ) {
    return (parsed as { zkappCommand?: unknown }).zkappCommand;
  }

  throw new Error("Auro wallet returned signed data without a zkApp command.");
}

async function submitSignedZkappCommand(
  minaNodeUrl: string,
  zkappCommand: unknown,
): Promise<string> {
  const response = await fetch(resolveEndpointUrl(minaNodeUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: SEND_ZKAPP_MUTATION,
      variables: {
        zkappCommandInput: zkappCommand,
      },
    }),
  });

  const payload = (await response.json()) as SendZkappGraphQlResponse;
  const errorMessage = payload.errors
    ?.map((error) => error.message)
    .filter((message): message is string => Boolean(message))
    .join("; ");
  if (!response.ok || errorMessage) {
    throw new Error(
      errorMessage ||
        `Mina node rejected zkApp submission (${response.status}).`,
    );
  }

  const hash = payload.data?.sendZkapp?.zkapp?.hash;
  if (!hash) {
    throw new Error("Mina node did not return a transaction hash.");
  }

  return hash;
}

export async function signWithAuroWalletAndSubmitZkapp(
  minaNodeUrl: string,
  transactionJson: string,
  expectedSenderAddress: string,
  fee: string,
  memo: string,
  nonce?: number,
): Promise<string> {
  const provider = typeof window === "undefined" ? undefined : window.mina;
  const auroProvider = provider as AuroWalletProvider | undefined;
  if (!auroProvider?.sendTransaction && !auroProvider?.request) {
    throw new Error(
      "Connected Auro wallet does not support transaction signing.",
    );
  }

  await assertAuroAccountMatchesTransaction(
    auroProvider,
    transactionJson,
    expectedSenderAddress,
  );

  const sendTransactionArgs = {
    onlySign: true,
    transaction: transactionJson,
    feePayer: {
      fee: Number(fee),
      memo,
    },
    nonce,
  };

  let result: AuroSendTransactionResult;
  if (auroProvider.sendTransaction) {
    result = await auroProvider.sendTransaction(sendTransactionArgs);
  } else if (auroProvider.request) {
    result = await auroProvider.request({
      method: "mina_sendTransaction",
      params: [sendTransactionArgs],
    });
  } else {
    throw new Error(
      "Connected Auro wallet does not support transaction signing.",
    );
  }

  if (result.code && result.code !== 0) {
    throw new Error(
      result.message ||
        `Auro wallet rejected transaction with code ${result.code}.`,
    );
  }

  const signedZkappCommand = parseSignedZkappCommand(result.signedData);
  return submitSignedZkappCommand(minaNodeUrl, signedZkappCommand);
}
