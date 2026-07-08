"use client";

import { useEffect } from "react";
import { resolveEndpointUrl } from "../../endpoint-settings/lib/endpoint-url";
import { useEndpointSettingsStore } from "../../endpoint-settings/store/endpoint-settings-store";
import { useMinaBlockStore } from "../../mina-blocks/store/mina-block-store";
import {
  fetchCurrentTreasuryLifecycleSnapshot,
  fetchTreasuryPausedState,
} from "../../treasury/lib/treasury-lifecycle";
import { useTreasuryStore } from "../../treasury/store/treasury-store";

const DEFAULT_INDEXER_API_URL = "/indexer";

interface HealthzResponse {
  ok?: boolean;
}

interface IndexerStatusResponse {
  archive?: {
    canonicalMaxBlockHeight?: number | null;
    pendingMaxBlockHeight?: number | null;
  };
  remainingCanonicalBlocks?: number | null;
  remainingPendingBlocks?: number | null;
}

export function useTreasuryStatus(): void {
  const apiUrl = useEndpointSettingsStore((state) => state.value.apiUrl);
  const hydrated = useEndpointSettingsStore((state) => state.hydrated);
  const minaNodeUrl = useEndpointSettingsStore(
    (state) => state.value.minaNodeUrl,
  );
  const setTreasuryState = useTreasuryStore((state) => state.setTreasuryState);
  const lastCheckedAt = useMinaBlockStore((state) => state.lastCheckedAt);
  const refreshToken = useMinaBlockStore((state) => state.refreshToken);
  const indexerApiUrl =
    process.env.NEXT_PUBLIC_INDEXER_API_URL ?? DEFAULT_INDEXER_API_URL;

  useEffect(() => {
    if (!hydrated || !apiUrl || !indexerApiUrl) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const treasuryOwnerAddress =
          process.env.NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS;
        const lifecyclePeriodDuration = Number.parseInt(
          process.env.NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION ?? "",
          10,
        );
        const shouldFetchOnChainTreasuryState = Boolean(
          minaNodeUrl && treasuryOwnerAddress,
        );
        console.log("[treasury-status] refreshing", {
          apiUrl,
          indexerApiUrl,
          minaNodeUrl,
          refreshToken,
          lastCheckedAt,
          treasuryOwnerAddress,
          lifecyclePeriodDuration,
          shouldFetchOnChainTreasuryState,
        });
        if (!shouldFetchOnChainTreasuryState) {
          console.warn(
            "[treasury-status] skipping on-chain treasury state fetch",
            {
              hasMinaNodeUrl: Boolean(minaNodeUrl),
              hasTreasuryOwnerAddress: Boolean(treasuryOwnerAddress),
              minaNodeUrl,
              treasuryOwnerAddress,
            },
          );
        }
        const resolvedMinaNodeUrl = minaNodeUrl
          ? resolveEndpointUrl(minaNodeUrl)
          : "";
        const resolvedTreasuryOwnerAddress = treasuryOwnerAddress ?? "";
        const [
          healthzResult,
          indexerStatusResult,
          currentLifecycleSnapshotResult,
          treasuryPausedResult,
        ] = await Promise.allSettled([
          fetch(resolveEndpointUrl(indexerApiUrl, "/healthz")),
          fetch(resolveEndpointUrl(indexerApiUrl, "/status")),
          shouldFetchOnChainTreasuryState
            ? fetchCurrentTreasuryLifecycleSnapshot(
                resolvedMinaNodeUrl,
                resolvedTreasuryOwnerAddress,
                lifecyclePeriodDuration,
              )
            : Promise.resolve(undefined),
          shouldFetchOnChainTreasuryState
            ? fetchTreasuryPausedState(
                resolvedMinaNodeUrl,
                resolvedTreasuryOwnerAddress,
              )
            : Promise.resolve(false),
        ]);

        const healthzResponse =
          healthzResult.status === "fulfilled" ? healthzResult.value : null;
        const indexerStatusResponse =
          indexerStatusResult.status === "fulfilled"
            ? indexerStatusResult.value
            : null;
        const currentLifecycleSnapshot =
          currentLifecycleSnapshotResult.status === "fulfilled"
            ? currentLifecycleSnapshotResult.value
            : undefined;
        const treasuryPaused =
          treasuryPausedResult.status === "fulfilled"
            ? treasuryPausedResult.value
            : false;

        if (currentLifecycleSnapshotResult.status === "rejected") {
          console.error(
            "[treasury-status] lifecycle snapshot fetch failed",
            currentLifecycleSnapshotResult.reason,
          );
        } else {
          console.log("[treasury-status] lifecycle snapshot fetch settled", {
            value: currentLifecycleSnapshotResult.value,
          });
        }

        const healthzPayload =
          healthzResponse && healthzResponse.ok
            ? ((await healthzResponse.json()) as HealthzResponse)
            : null;
        const indexerPayload =
          indexerStatusResponse && indexerStatusResponse.ok
            ? ((await indexerStatusResponse.json()) as IndexerStatusResponse)
            : null;
        const remainingBlocks = indexerPayload
          ? Number(indexerPayload.remainingCanonicalBlocks ?? 0) +
            Number(indexerPayload.remainingPendingBlocks ?? 0)
          : null;
        console.log("[treasury-status] lifecycle snapshot", {
          snapshot: currentLifecycleSnapshot,
          remainingBlocks,
          treasuryPaused,
        });

        if (!cancelled) {
          setTreasuryState({
            paused: treasuryPaused,
            currentLifecycleId: currentLifecycleSnapshot?.currentLifecycleId,
            lifecycleStarted: currentLifecycleSnapshot?.lifecycleStarted,
            currentPeriod: currentLifecycleSnapshot?.currentPeriod,
            currentPeriodProgress:
              currentLifecycleSnapshot?.currentPeriodProgress,
            currentGlobalSlot: currentLifecycleSnapshot?.currentGlobalSlot,
            treasuryDeployedAtSlot:
              currentLifecycleSnapshot?.treasuryDeployedAtSlot,
            health: {
              apiStatus: healthzResponse
                ? healthzResponse.ok && healthzPayload?.ok !== false
                  ? "healthy"
                  : "down"
                : "unknown",
              indexerStatus:
                remainingBlocks === null
                  ? "unknown"
                  : remainingBlocks > 0
                    ? "degraded"
                    : "healthy",
              latestLiveSlot:
                indexerPayload?.archive?.pendingMaxBlockHeight ?? null,
              latestIndexedSlot:
                indexerPayload?.archive?.canonicalMaxBlockHeight ?? null,
              slotLag: remainingBlocks ?? undefined,
              updatedAt: new Date().toLocaleTimeString(),
            },
          });
        }
      } catch (error) {
        console.error("[treasury-status] refresh failed", error);
        if (!cancelled) {
          setTreasuryState({
            health: {
              apiStatus: "down",
              indexerStatus: "unknown",
              updatedAt: new Date().toLocaleTimeString(),
            },
          });
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [
    apiUrl,
    hydrated,
    indexerApiUrl,
    lastCheckedAt,
    minaNodeUrl,
    refreshToken,
    setTreasuryState,
  ]);
}
