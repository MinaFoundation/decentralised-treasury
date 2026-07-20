"use client";

import { resolveEndpointUrl } from "../../endpoint-settings/lib/endpoint-url";

interface AuroSendTransactionResult {
  hash?: string;
  code?: number;
  message?: string;
  signedData?: string | { zkappCommand?: unknown };
}

interface AuroWalletProvider {
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
