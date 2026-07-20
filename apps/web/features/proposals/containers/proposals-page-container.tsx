"use client";

import { useEffect, useMemo, useState, type JSX } from "react";
import { useRouter } from "next/navigation";
import { useAppShellStore } from "../../app-shell/store/app-shell-store";
import { useEndpointSettingsState } from "../../endpoint-settings/store/endpoint-settings-store.selectors";
import { useMinaBlockStore } from "../../mina-blocks/store/mina-block-store";
import { useTreasuryState } from "../../treasury/store/treasury-store.selectors";
import {
  fetchProposalItems,
  mapProposalItemToEntry,
} from "../../treasury-header/lib/treasury-header-api";
import { TreasuryProposalsTable } from "@repo/ui/treasury-proposals-table";
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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!settings.hydrated || !settings.value.apiUrl) {
      setEntries([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void fetchProposalItems(settings.value.apiUrl, lifecycleId, 200)
      .then((items) => {
        if (cancelled) {
          return;
        }
        setEntries(items.map(mapProposalItemToEntry));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setEntries([]);
        setAppError(
          error instanceof Error ? error.message : "Failed to fetch proposals.",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    lifecycleId,
    refreshToken,
    setAppError,
    settings.hydrated,
    settings.value.apiUrl,
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
