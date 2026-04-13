"use client";

import { useEffect } from "react";
import { useAppShellStore } from "../../app-shell/store/app-shell-store";
import { useEndpointSettingsStore } from "../../endpoint-settings/store/endpoint-settings-store";
import { useMinaBlockStore } from "../../mina-blocks/store/mina-block-store";
import { fetchProposalSearchResults } from "../lib/treasury-header-api";
import { useTreasuryHeaderStore } from "../store/treasury-header-store";

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_LOADING_DELAY_MS = 150;

export function useHeaderSearch(): void {
  const apiUrl = useEndpointSettingsStore((state) => state.value.apiUrl);
  const hydrated = useEndpointSettingsStore((state) => state.hydrated);
  const query = useTreasuryHeaderStore((state) => state.search.query);
  const setSearchResults = useTreasuryHeaderStore((state) => state.setSearchResults);
  const setSearchLoading = useTreasuryHeaderStore((state) => state.setSearchLoading);
  const setSearchError = useTreasuryHeaderStore((state) => state.setSearchError);
  const setAppError = useAppShellStore((state) => state.setError);
  const refreshToken = useMinaBlockStore((state) => state.refreshToken);

  useEffect(() => {
    if (!hydrated || !apiUrl) {
      return;
    }

    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setSearchLoading(false);
      setSearchError(null);
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    let loadingTimeoutId: number | undefined;
    setSearchError(null);
    setSearchLoading(false);

    const timeoutId = window.setTimeout(() => {
      loadingTimeoutId = window.setTimeout(() => {
        if (!cancelled) {
          setSearchLoading(true);
        }
      }, SEARCH_LOADING_DELAY_MS);

      void fetchProposalSearchResults(apiUrl, normalizedQuery)
        .then((results) => {
          if (!cancelled) {
            setSearchResults(results);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            const message = error instanceof Error ? error.message : "Proposal search failed.";
            setSearchError(message);
            setAppError(message);
            setSearchResults([]);
          }
        })
        .finally(() => {
          if (loadingTimeoutId !== undefined) {
            window.clearTimeout(loadingTimeoutId);
          }
          if (!cancelled) {
            setSearchLoading(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      if (loadingTimeoutId !== undefined) {
        window.clearTimeout(loadingTimeoutId);
      }
    };
  }, [
    apiUrl,
    hydrated,
    query,
    refreshToken,
    setSearchError,
    setSearchLoading,
    setSearchResults,
    setAppError,
  ]);
}
