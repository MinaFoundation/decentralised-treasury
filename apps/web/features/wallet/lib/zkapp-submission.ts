"use client";

import { resolveEndpointUrl } from "../../endpoint-settings/lib/endpoint-url";

const SEND_ZKAPP_MUTATION = `
  mutation SendSignedZkapp($zkappCommandInput: ZkappCommandInput!) {
    sendZkapp(input: { zkappCommand: $zkappCommandInput }) {
      zkapp { hash id }
    }
  }
`;

export async function submitSignedZkappCommand(
  minaNodeUrl: string,
  zkappCommand: unknown,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(resolveEndpointUrl(minaNodeUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      query: SEND_ZKAPP_MUTATION,
      variables: { zkappCommandInput: zkappCommand },
    }),
  });
  const payload = (await response.json()) as {
    data?: { sendZkapp?: { zkapp?: { hash?: string } } };
    errors?: Array<{ message?: string }>;
  };
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
