"use client";

import { resolveEndpointUrl } from "../../endpoint-settings/lib/endpoint-url";
import { getRuntimeConfig } from "../../runtime-config/lib/get-runtime-config";

const INCLUSION_POLL_INTERVAL_MS = 2_500;

// How long to wait for inclusion, counted in slots rather than wall-clock.
//
// This was a flat three minutes, which is only meaningful if you know the chain.
// On a 90s-slot devnet it is two slots, against an average block interval of
// about three minutes - so roughly half of all transactions "timed out" while
// sitting perfectly healthily in the mempool, and were included moments after
// the flow had given up and skipped content attachment.
//
// Ten slots is around five block intervals on that chain, and scales by itself
// on a faster or slower one.
const INCLUSION_TIMEOUT_SLOTS = 10;
const FALLBACK_SLOT_DURATION_MS = 180_000;
const MIN_INCLUSION_TIMEOUT_MS = 5 * 60_000;

export function resolveInclusionTimeoutMs(): number {
  const parsed = Number.parseInt(getRuntimeConfig().slotDurationMs ?? "", 10);
  const slotDurationMs =
    Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_SLOT_DURATION_MS;
  return Math.max(
    slotDurationMs * INCLUSION_TIMEOUT_SLOTS,
    MIN_INCLUSION_TIMEOUT_MS,
  );
}
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
  const timeoutMs = resolveInclusionTimeoutMs();

  while (true) {
    signal?.throwIfAborted();

    if (await isZkappTransactionIncluded(minaNodeUrl, transactionHash)) {
      return;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("Timed out while waiting for transaction inclusion.");
    }

    await sleep(INCLUSION_POLL_INTERVAL_MS, signal);
  }
}
