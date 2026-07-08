"use client";

import { resolveEndpointUrl } from "../../endpoint-settings/lib/endpoint-url";

const INCLUSION_POLL_INTERVAL_MS = 2_500;
const INCLUSION_TIMEOUT_MS = 3 * 60_000;

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

export async function waitForTransactionInclusion(
  minaNodeUrl: string,
  transactionHash: string,
  signal?: AbortSignal,
): Promise<void> {
  const { fetchTransactionStatus } = await import("o1js");
  const startedAt = Date.now();

  while (true) {
    signal?.throwIfAborted();

    const status = String(
      await fetchTransactionStatus(transactionHash, resolveEndpointUrl(minaNodeUrl)),
    ).toUpperCase();
    if (status === "INCLUDED") {
      return;
    }
    if (Date.now() - startedAt >= INCLUSION_TIMEOUT_MS) {
      throw new Error("Timed out while waiting for transaction inclusion.");
    }

    await sleep(INCLUSION_POLL_INTERVAL_MS, signal);
  }
}
