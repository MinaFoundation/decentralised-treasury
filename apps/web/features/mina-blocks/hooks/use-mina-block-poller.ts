"use client";

import { useEffect } from "react";
import { useAppShellStore } from "../../app-shell/store/app-shell-store";
import { resolveEndpointUrl } from "../../endpoint-settings/lib/endpoint-url";
import { useEndpointSettingsStore } from "../../endpoint-settings/store/endpoint-settings-store";
import { useMinaBlockStore } from "../store/mina-block-store";

const BLOCK_POLL_INTERVAL_MS = 10_000;
const LATEST_BLOCK_QUERY = `
  query LatestBlock {
    bestChain(maxLength: 1) {
      stateHash
      protocolState {
        consensusState {
          blockHeight
        }
      }
    }
  }
`;

interface LatestBlockResponse {
  data?: {
    bestChain?: Array<{
      stateHash?: string | null;
      protocolState?: {
        consensusState?: {
          blockHeight?: string | number | null;
        } | null;
      } | null;
    }>;
  };
}

async function fetchLatestBlock(
  minaNodeUrl: string,
): Promise<{ height: number; hash: string | null }> {
  const response = await fetch(resolveEndpointUrl(minaNodeUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: LATEST_BLOCK_QUERY,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to poll Mina node: ${response.status}`);
  }

  const payload = (await response.json()) as LatestBlockResponse;
  const latestBlock = payload.data?.bestChain?.[0];
  const blockHeight = Number(latestBlock?.protocolState?.consensusState?.blockHeight ?? NaN);

  if (!Number.isFinite(blockHeight)) {
    throw new Error("Mina node response did not include a latest block height.");
  }

  return {
    height: blockHeight,
    hash: latestBlock?.stateHash ?? null,
  };
}

export function useMinaBlockPoller(): void {
  const minaNodeUrl = useEndpointSettingsStore((state) => state.value.minaNodeUrl);
  const hydrated = useEndpointSettingsStore((state) => state.hydrated);
  const setAppError = useAppShellStore((state) => state.setError);
  const setPolling = useMinaBlockStore((state) => state.setPolling);
  const setError = useMinaBlockStore((state) => state.setError);
  const recordCheck = useMinaBlockStore((state) => state.recordCheck);
  const registerBlock = useMinaBlockStore((state) => state.registerBlock);

  useEffect(() => {
    if (!hydrated || !minaNodeUrl) {
      return;
    }

    let cancelled = false;

    const poll = async (): Promise<void> => {
      setPolling(true);
      try {
        const latestBlock = await fetchLatestBlock(minaNodeUrl);
        console.log("[mina-block-poller] polled latest block", latestBlock);
        if (!cancelled) {
          registerBlock(latestBlock);
        }
      } catch (error) {
        console.error("[mina-block-poller] poll failed", error);
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Failed to poll Mina node.";
          setError(message);
          setAppError(message);
        }
      } finally {
        if (!cancelled) {
          recordCheck();
          setPolling(false);
        }
      }
    };

    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, BLOCK_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [hydrated, minaNodeUrl, recordCheck, registerBlock, setAppError, setError, setPolling]);
}
