"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { withMinimumLoadingDuration } from "../../app-shell/lib/minimum-loading-duration";
import { useAppShellStore } from "../../app-shell/store/app-shell-store";
import { useEndpointSettingsState } from "../../endpoint-settings/store/endpoint-settings-store.selectors";
import { useMinaBlockStore } from "../../mina-blocks/store/mina-block-store";
import {
  buildTreasuryLifecycleOptions,
  buildTreasuryLifecyclePeriodMetadata,
} from "../../treasury/lib/treasury-lifecycle";
import { useTreasuryState } from "../../treasury/store/treasury-store.selectors";
import { TreasuryStatusFooterContainer } from "../../treasury-header/containers/treasury-status-footer-container";
import {
  fetchProposalItemsPage,
  mapProposalItemToEntry,
} from "../../treasury-header/lib/treasury-header-api";
import {
  TreasuryCooldownPeriodTable,
  TreasuryExplorationPeriodTable,
  TreasuryProposalPeriodTable,
  type TreasuryProposalTableEntry,
  type TreasuryProposalTableSortDirection,
  type TreasuryProposalTableSortKey,
  TreasuryVotingPeriodTable,
} from "@repo/ui/treasury-proposals-table";
import {
  TreasuryLifecyclePeriodInfo,
  type TreasuryLifecyclePeriodId,
} from "@repo/ui/treasury-lifecycle-period-info";

function resolveTableComponent(
  period: TreasuryLifecyclePeriodId | undefined,
  isHistoricalLifecycle: boolean,
) {
  if (isHistoricalLifecycle) {
    return TreasuryCooldownPeriodTable;
  }

  switch (period) {
    case "proposal":
      return TreasuryProposalPeriodTable;
    case "exploration":
      return TreasuryExplorationPeriodTable;
    case "voting":
      return TreasuryVotingPeriodTable;
    case "cooldown":
    default:
      return TreasuryCooldownPeriodTable;
  }
}

function resolveInitialDashboardSort(
  period: TreasuryLifecyclePeriodId | undefined,
  isHistoricalLifecycle: boolean,
): {
  key: TreasuryProposalTableSortKey;
  direction: TreasuryProposalTableSortDirection;
  sortableColumns: TreasuryProposalTableSortKey[];
} {
  if (isHistoricalLifecycle || period === "cooldown") {
    return {
      key: "requestedAmount",
      direction: "desc",
      sortableColumns: ["proposer", "requestedAmount"],
    };
  }

  if (period === "voting") {
    return {
      key: "requestedAmount",
      direction: "desc",
      sortableColumns: ["requestedAmount"],
    };
  }

  return {
    key: "createdAt",
    direction: "desc",
    sortableColumns: ["proposer", "requestedAmount", "createdAt"],
  };
}

export function DashboardContainer({
  initialLifecycleId,
}: {
  initialLifecycleId?: number;
} = {}) {
  const router = useRouter();
  const settings = useEndpointSettingsState();
  const treasury = useTreasuryState();
  const refreshToken = useMinaBlockStore((state) => state.refreshToken);
  const setAppError = useAppShellStore((state) => state.setError);
  const [selectedLifecycleId, setSelectedLifecycleId] = useState<number | null>(
    initialLifecycleId ?? null,
  );
  const [followCurrentLifecycle, setFollowCurrentLifecycle] = useState(
    initialLifecycleId === undefined,
  );
  const [entries, setEntries] = useState<TreasuryProposalTableEntry[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 20 | 30 | 40 | 50>(10);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const loadedQueryRef = useRef<string | null>(null);

  const currentLifecycleId = treasury.currentLifecycleId;
  const lifecycleStarted = treasury.lifecycleStarted ?? true;

  useEffect(() => {
    setSelectedLifecycleId(initialLifecycleId ?? null);
    setFollowCurrentLifecycle(initialLifecycleId === undefined);
  }, [initialLifecycleId]);

  useEffect(() => {
    if (currentLifecycleId === undefined) {
      return;
    }

    setSelectedLifecycleId((previous) => {
      if (
        followCurrentLifecycle ||
        previous === null ||
        previous > currentLifecycleId
      ) {
        return currentLifecycleId;
      }
      return previous;
    });
  }, [currentLifecycleId, followCurrentLifecycle]);

  const effectiveLifecycleId = selectedLifecycleId ?? currentLifecycleId;
  const hasResolvedTreasuryStatus = treasury.health.updatedAt !== null;
  const isHistoricalLifecycle =
    effectiveLifecycleId !== undefined &&
    currentLifecycleId !== undefined &&
    effectiveLifecycleId < currentLifecycleId;
  const displayedPeriod = isHistoricalLifecycle
    ? "cooldown"
    : (treasury.currentPeriod ?? "proposal");
  const TableComponent = resolveTableComponent(
    displayedPeriod,
    isHistoricalLifecycle,
  );
  const dashboardSortConfig = useMemo(
    () => resolveInitialDashboardSort(displayedPeriod, isHistoricalLifecycle),
    [displayedPeriod, isHistoricalLifecycle],
  );
  const [sortKey, setSortKey] = useState<TreasuryProposalTableSortKey>(
    dashboardSortConfig.key,
  );
  const [sortDirection, setSortDirection] =
    useState<TreasuryProposalTableSortDirection>(dashboardSortConfig.direction);
  const slotDurationMs = Number.parseInt(
    process.env.NEXT_PUBLIC_SLOT_DURATION_MS ?? "",
    10,
  );

  useEffect(() => {
    setSortKey(dashboardSortConfig.key);
    setSortDirection(dashboardSortConfig.direction);
    setPage(1);
  }, [
    dashboardSortConfig.direction,
    dashboardSortConfig.key,
    effectiveLifecycleId,
  ]);

  const lifecycleOptions = useMemo(() => {
    if (currentLifecycleId === undefined) {
      return undefined;
    }
    return buildTreasuryLifecycleOptions(currentLifecycleId);
  }, [currentLifecycleId]);

  const lifecycleMetadata = useMemo(() => {
    if (
      effectiveLifecycleId === undefined ||
      treasury.currentGlobalSlot === undefined ||
      treasury.treasuryDeployedAtSlot === undefined
    ) {
      return undefined;
    }

    const lifecyclePeriodDuration = Number.parseInt(
      process.env.NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION ?? "",
      10,
    );
    if (
      !Number.isFinite(lifecyclePeriodDuration) ||
      lifecyclePeriodDuration <= 0
    ) {
      return undefined;
    }
    return buildTreasuryLifecyclePeriodMetadata({
      lifecycleId: effectiveLifecycleId,
      currentGlobalSlot: treasury.currentGlobalSlot,
      treasuryDeployedAtSlot: treasury.treasuryDeployedAtSlot,
      lifecyclePeriodDuration,
      slotDurationMs:
        Number.isFinite(slotDurationMs) && slotDurationMs > 0
          ? slotDurationMs
          : undefined,
    });
  }, [
    effectiveLifecycleId,
    slotDurationMs,
    treasury.currentGlobalSlot,
    treasury.treasuryDeployedAtSlot,
  ]);

  const lifecycleLoading =
    !settings.hydrated ||
    (!hasResolvedTreasuryStatus &&
      effectiveLifecycleId === undefined &&
      treasury.currentGlobalSlot === undefined &&
      treasury.treasuryDeployedAtSlot === undefined);

  const handleLifecycleChange = useCallback(
    (nextLifecycleId: number) => {
      setSelectedLifecycleId(nextLifecycleId);
      setFollowCurrentLifecycle(
        currentLifecycleId !== undefined &&
          nextLifecycleId >= currentLifecycleId,
      );
    },
    [currentLifecycleId],
  );

  const handleProposalClick = useCallback(
    (proposal: TreasuryProposalTableEntry) => {
      const nextProposalId = encodeURIComponent(
        proposal.proposalAddress ?? proposal.id,
      );
      router.push(`/proposals/${nextProposalId}`, { scroll: false });
    },
    [router],
  );

  const handleCreateProposalClick = useCallback(() => {
    const href =
      currentLifecycleId !== undefined
        ? `/proposals/create?lifecycleId=${currentLifecycleId}&from=dashboard`
        : "/proposals/create?from=dashboard";
    router.push(href, { scroll: false });
  }, [currentLifecycleId, router]);

  useEffect(() => {
    if (!settings.hydrated) {
      loadedQueryRef.current = null;
      setEntries([]);
      setTotalCount(0);
      setLoading(true);
      return;
    }
    if (!settings.value.apiUrl) {
      loadedQueryRef.current = null;
      setEntries([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }
    if (effectiveLifecycleId === undefined) {
      loadedQueryRef.current = null;
      setEntries([]);
      setTotalCount(0);
      setLoading(true);
      return;
    }

    let cancelled = false;
    const queryKey = JSON.stringify({
      apiUrl: settings.value.apiUrl,
      lifecycleId: effectiveLifecycleId,
      page,
      pageSize,
      sortKey,
      sortDirection,
    });
    const isInitialQueryLoad = loadedQueryRef.current !== queryKey;
    if (isInitialQueryLoad) {
      setLoading(true);
    }

    const request = fetchProposalItemsPage(settings.value.apiUrl, {
      lifecycleId: effectiveLifecycleId,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      sortKey,
      sortDirection,
    });

    void (isInitialQueryLoad ? withMinimumLoadingDuration(request) : request)
      .then((result) => {
        if (!cancelled) {
          setEntries(result.items.map(mapProposalItemToEntry));
          setTotalCount(result.total);
          loadedQueryRef.current = queryKey;
        }
      })
      .catch((error) => {
        if (!cancelled) {
          if (isInitialQueryLoad) {
            setEntries([]);
            setTotalCount(0);
          }
          setAppError(
            error instanceof Error
              ? error.message
              : "Failed to fetch lifecycle proposals.",
          );
        }
      })
      .finally(() => {
        if (!cancelled && isInitialQueryLoad) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    effectiveLifecycleId,
    page,
    pageSize,
    refreshToken,
    setAppError,
    settings.hydrated,
    settings.value.apiUrl,
    sortDirection,
    sortKey,
  ]);

  return (
    <section className="flex flex-col gap-6">
      <TreasuryLifecyclePeriodInfo
        loading={lifecycleLoading}
        lifecycleId={effectiveLifecycleId}
        currentPeriod={displayedPeriod}
        currentPeriodProgress={
          isHistoricalLifecycle ? 100 : treasury.currentPeriodProgress
        }
        currentSlot={treasury.currentGlobalSlot}
        isHistoricalLifecycle={
          !lifecycleStarted ? false : isHistoricalLifecycle
        }
        lifecycleOptions={lifecycleOptions}
        onLifecycleChange={handleLifecycleChange}
        periodMetadata={lifecycleMetadata}
      />
      <div className="h-px w-full bg-border/60" aria-hidden="true" />
      <TableComponent
        entries={entries}
        loading={loading}
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageChange={setPage}
        onPageSizeChange={(nextPageSize) =>
          setPageSize(nextPageSize as 10 | 20 | 30 | 40 | 50)
        }
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSortChange={(nextSortKey, nextSortDirection) => {
          setSortKey(nextSortKey);
          setSortDirection(nextSortDirection);
        }}
        sortableColumns={dashboardSortConfig.sortableColumns}
        onProposalClick={handleProposalClick}
        onCreateProposalClick={handleCreateProposalClick}
      />
      <TreasuryStatusFooterContainer />
    </section>
  );
}
