"use client";

import { resolveEndpointUrl } from "../../endpoint-settings/lib/endpoint-url";

const INCLUSION_POLL_INTERVAL_MS = 2_500;
const INCLUSION_TIMEOUT_MS = 3 * 60_000;
const BEST_CHAIN_ZKAPP_HASHES_QUERY = `
  query BestChainZkappHashes($maxLength: Int!) {
    bestChain(maxLength: $maxLength) {
      transactions {
        zkappCommands {
          hash
        }
      }
    }
  }
`;

interface BestChainZkappHashesResponse {
  data?: {
    bestChain?: Array<{
      transactions?: {
        zkappCommands?: Array<{ hash?: string | null } | null> | null;
      } | null;
    } | null> | null;
  };
  errors?: Array<{ message?: string }>;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }

    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, ms);

    const handleAbort = () => {
      window.clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };

    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

async function isZkappTransactionIncluded(
  minaNodeUrl: string,
  transactionHash: string,
): Promise<boolean> {
  const response = await fetch(resolveEndpointUrl(minaNodeUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: BEST_CHAIN_ZKAPP_HASHES_QUERY,
      variables: {
        maxLength: 20,
      },
    }),
  });

  const payload = (await response.json()) as BestChainZkappHashesResponse;
  const errorMessage = payload.errors
    ?.map((error) => error.message)
    .filter((message): message is string => Boolean(message))
    .join("; ");
  if (!response.ok || errorMessage) {
    throw new Error(
      errorMessage ||
        `Mina node failed while checking transaction inclusion (${response.status}).`,
    );
  }

  return Boolean(
    payload.data?.bestChain?.some((block) =>
      block?.transactions?.zkappCommands?.some(
        (command) => command?.hash === transactionHash,
      ),
    ),
  );
}

export async function waitForTransactionInclusion(
  minaNodeUrl: string,
  transactionHash: string,
  signal?: AbortSignal,
): Promise<void> {
  const startedAt = Date.now();

  while (true) {
    signal?.throwIfAborted();

    if (await isZkappTransactionIncluded(minaNodeUrl, transactionHash)) {
      return;
    }
    if (Date.now() - startedAt >= INCLUSION_TIMEOUT_MS) {
      throw new Error("Timed out while waiting for transaction inclusion.");
    }

    await sleep(INCLUSION_POLL_INTERVAL_MS, signal);
  }
}
