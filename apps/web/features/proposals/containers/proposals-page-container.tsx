"use client";

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { useRouter } from "next/navigation";
import { withMinimumLoadingDuration } from "../../app-shell/lib/minimum-loading-duration";
import { useAppShellStore } from "../../app-shell/store/app-shell-store";
import { useEndpointSettingsState } from "../../endpoint-settings/store/endpoint-settings-store.selectors";
import { useMinaBlockStore } from "../../mina-blocks/store/mina-block-store";
import { useTreasuryState } from "../../treasury/store/treasury-store.selectors";
import {
  fetchProposalItemsPage,
  mapProposalItemToEntry,
} from "../../treasury-header/lib/treasury-header-api";
import {
  TreasuryProposalsTable,
  type TreasuryProposalTableSortDirection,
  type TreasuryProposalTableSortKey,
} from "@repo/ui/treasury-proposals-table";
import { Skeleton } from "@repo/ui/components/ui/skeleton";
import { applyDerivedProposalPresentationToEntry } from "../lib/proposal-presentation";

export function ProposalsPageContainer({
  lifecycleId,
}: {
  lifecycleId?: number;
} = {}): JSX.Element {
  const router = useRouter();
  const settings = useEndpointSettingsState();
  const treasury = useTreasuryState();
  const refreshToken = useMinaBlockStore((state) => state.refreshToken);
  const setAppError = useAppShellStore((state) => state.setError);
  const [entries, setEntries] = useState<
    ReturnType<typeof mapProposalItemToEntry>[]
  >([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 20 | 30 | 40 | 50>(10);
  const [totalCount, setTotalCount] = useState(0);
  const [sortKey, setSortKey] =
    useState<TreasuryProposalTableSortKey>("createdAt");
  const [sortDirection, setSortDirection] =
    useState<TreasuryProposalTableSortDirection>("desc");
  const [loading, setLoading] = useState(true);
  const loadedQueryRef = useRef<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [lifecycleId]);

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

    let cancelled = false;
    const queryKey = JSON.stringify({
      apiUrl: settings.value.apiUrl,
      lifecycleId,
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
      lifecycleId,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      sortKey,
      sortDirection,
    });

    void (isInitialQueryLoad ? withMinimumLoadingDuration(request) : request)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setEntries(result.items.map(mapProposalItemToEntry));
        setTotalCount(result.total);
        loadedQueryRef.current = queryKey;
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (isInitialQueryLoad) {
          setEntries([]);
          setTotalCount(0);
        }
        setAppError(
          error instanceof Error ? error.message : "Failed to fetch proposals.",
        );
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
    lifecycleId,
    page,
    pageSize,
    refreshToken,
    setAppError,
    settings.hydrated,
    settings.value.apiUrl,
    sortDirection,
    sortKey,
  ]);

  const sortedEntries = useMemo(
    () =>
      entries.map((entry) =>
        applyDerivedProposalPresentationToEntry(
          entry,
          treasury.currentLifecycleId,
          treasury.currentPeriod,
        ),
      ),
    [entries, treasury.currentLifecycleId, treasury.currentPeriod],
  );

  const handleProposalClick = (proposal: (typeof entries)[number]) => {
    const nextProposalId = encodeURIComponent(
      proposal.proposalAddress ?? proposal.id,
    );
    router.push(`/proposals/${nextProposalId}`, { scroll: false });
  };

  const handleCreateProposalClick = () => {
    const href =
      treasury.currentLifecycleId !== undefined
        ? `/proposals/create?lifecycleId=${treasury.currentLifecycleId}&from=proposals`
        : "/proposals/create?from=proposals";
    router.push(href, { scroll: false });
  };

  if (!settings.hydrated) {
    return (
      <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-3 h-[36rem] w-full" />
      </section>
    );
  }

  return (
    <section className="min-w-0">
      <TreasuryProposalsTable
        entries={sortedEntries}
        loading={loading}
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageChange={setPage}
        onPageSizeChange={(nextPageSize) => {
          setPage(1);
          setPageSize(nextPageSize as 10 | 20 | 30 | 40 | 50);
        }}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSortChange={(nextSortKey, nextSortDirection) => {
          setPage(1);
          setSortKey(nextSortKey);
          setSortDirection(nextSortDirection);
        }}
        sortableColumns={[
          "lifecycleId",
          "proposer",
          "requestedAmount",
          "createdAt",
        ]}
        title="Proposals"
        description={
          lifecycleId === undefined
            ? "Browse indexed treasury proposals and open a dedicated proposal detail page for the selected record."
            : `Browse indexed treasury proposals for lifecycle ${lifecycleId} and open a dedicated proposal detail page for the selected record.`
        }
        onProposalClick={handleProposalClick}
        onCreateProposalClick={handleCreateProposalClick}
      />
    </section>
  );
}
