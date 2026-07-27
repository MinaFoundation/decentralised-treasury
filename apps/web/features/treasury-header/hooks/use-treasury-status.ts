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

interface IndexerStatusResponse {
  archive?: {
    pendingMaxBlockHeight?: number | null;
  };
  pendingCursor?: number | null;
}

interface ProcessorStatusResponse {
  remainingEvents?: number | null;
}

export function useTreasuryStatus(): void {
  const hydrated = useEndpointSettingsStore((state) => state.hydrated);
  const minaNodeUrl = useEndpointSettingsStore(
    (state) => state.value.minaNodeUrl,
  );
  const indexerApiUrl = useEndpointSettingsStore(
    (state) => state.value.indexerApiUrl,
  );
  const processorApiUrl = useEndpointSettingsStore(
    (state) => state.value.processorApiUrl,
  );
  const setTreasuryState = useTreasuryStore((state) => state.setTreasuryState);
  const lastCheckedAt = useMinaBlockStore((state) => state.lastCheckedAt);
  const latestBlockHeight = useMinaBlockStore(
    (state) => state.latestBlockHeight,
  );
  const minaBlockError = useMinaBlockStore((state) => state.error);
  const refreshToken = useMinaBlockStore((state) => state.refreshToken);

  useEffect(() => {
    if (!hydrated) {
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
          indexerApiUrl,
          processorApiUrl,
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
          indexerStatusResult,
          processorStatusResult,
          currentLifecycleSnapshotResult,
          treasuryPausedResult,
        ] = await Promise.allSettled([
          indexerApiUrl
            ? fetch(resolveEndpointUrl(indexerApiUrl, "/status"))
            : Promise.resolve(null),
          processorApiUrl
            ? fetch(resolveEndpointUrl(processorApiUrl, "/status"))
            : Promise.resolve(null),
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

        const indexerStatusResponse =
          indexerStatusResult.status === "fulfilled"
            ? indexerStatusResult.value
            : null;
        const processorStatusResponse =
          processorStatusResult.status === "fulfilled"
            ? processorStatusResult.value
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

        const indexerPayload =
          indexerStatusResponse && indexerStatusResponse.ok
            ? ((await indexerStatusResponse.json()) as IndexerStatusResponse)
            : null;
        const processorPayload =
          processorStatusResponse && processorStatusResponse.ok
            ? ((await processorStatusResponse.json()) as ProcessorStatusResponse)
            : null;
        const archiveBlockHeight =
          indexerPayload?.archive?.pendingMaxBlockHeight;
        const indexerBlockHeight = indexerPayload?.pendingCursor;
        const processorRemainingEvents = processorPayload?.remainingEvents;
        const previousHealth = useTreasuryStore.getState().health;
        console.log("[treasury-status] lifecycle snapshot", {
          snapshot: currentLifecycleSnapshot,
          nodeBlockHeight: latestBlockHeight,
          archiveBlockHeight,
          indexerBlockHeight,
          processorRemainingEvents,
          treasuryPaused,
        });

        const hasArchiveBlockHeight = Number.isFinite(archiveBlockHeight);
        const hasIndexerBlockHeight = Number.isFinite(indexerBlockHeight);
        const hasProcessorRemainingEvents = Number.isFinite(
          processorRemainingEvents,
        );
        const hasNodeBlockHeight = Number.isFinite(latestBlockHeight);

        if (!cancelled) {
          setTreasuryState({
            ...(treasuryPausedResult.status === "fulfilled"
              ? { paused: treasuryPaused }
              : {}),
            ...(currentLifecycleSnapshot
              ? {
                  currentLifecycleId:
                    currentLifecycleSnapshot.currentLifecycleId,
                  lifecycleStarted: currentLifecycleSnapshot.lifecycleStarted,
                  currentPeriod: currentLifecycleSnapshot.currentPeriod,
                  currentPeriodProgress:
                    currentLifecycleSnapshot.currentPeriodProgress,
                  currentGlobalSlot: currentLifecycleSnapshot.currentGlobalSlot,
                  treasuryDeployedAtSlot:
                    currentLifecycleSnapshot.treasuryDeployedAtSlot,
                }
              : {}),
            health: {
              nodeBlockHeight: hasNodeBlockHeight
                ? latestBlockHeight
                : previousHealth.nodeBlockHeight,
              nodeFresh: hasNodeBlockHeight && !minaBlockError,
              archiveBlockHeight: hasArchiveBlockHeight
                ? Number(archiveBlockHeight)
                : previousHealth.archiveBlockHeight,
              archiveFresh: hasArchiveBlockHeight,
              indexerBlockHeight: hasIndexerBlockHeight
                ? Number(indexerBlockHeight)
                : previousHealth.indexerBlockHeight,
              indexerFresh: hasIndexerBlockHeight,
              processorRemainingEvents: hasProcessorRemainingEvents
                ? Number(processorRemainingEvents)
                : previousHealth.processorRemainingEvents,
              processorFresh: hasProcessorRemainingEvents,
              updatedAt: new Date().toLocaleTimeString(),
            },
          });
        }
      } catch (error) {
        console.error("[treasury-status] refresh failed", error);
        if (!cancelled) {
          const previousHealth = useTreasuryStore.getState().health;
          setTreasuryState({
            health: {
              ...previousHealth,
              nodeFresh: false,
              archiveFresh: false,
              indexerFresh: false,
              processorFresh: false,
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
    hydrated,
    indexerApiUrl,
    lastCheckedAt,
    latestBlockHeight,
    minaBlockError,
    minaNodeUrl,
    processorApiUrl,
    refreshToken,
    setTreasuryState,
  ]);
}
