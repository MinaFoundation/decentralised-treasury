import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEndpointSettingsStore } from "../../endpoint-settings/store/endpoint-settings-store";
import { useMinaBlockStore } from "../../mina-blocks/store/mina-block-store";
import { useTreasuryHeaderStore } from "../store/treasury-header-store";
import { useHeaderSearch } from "./use-header-search";

describe("useHeaderSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useEndpointSettingsStore.getState().reset();
    useTreasuryHeaderStore.getState().reset();
    useMinaBlockStore.getState().reset();
    useEndpointSettingsStore.getState().hydrateSettings({
      networkId: "MAINNET",
      apiUrl: "http://127.0.0.1:4000",
      minaNodeUrl: "http://127.0.0.1:8080/graphql",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function flushAsyncWork() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("fetches search results for the current query", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "P-1",
              title: "Search result proposal",
              lifecycleId: 12,
              proposalPublicKey: "B62qproposal",
              senderPublicKey: "B62qsender",
              amount: "10 MINA",
              status: "Voting",
              createdAt: "2026-01-01",
            },
          ],
        }),
      ),
    );

    useTreasuryHeaderStore.getState().setSearchQuery("search");

    renderHook(() => useHeaderSearch());

    expect(useTreasuryHeaderStore.getState().search.loading).toBe(false);

    await vi.advanceTimersByTimeAsync(250);
    await flushAsyncWork();

    expect(useTreasuryHeaderStore.getState().search.results).toHaveLength(1);
    expect(useTreasuryHeaderStore.getState().search.loading).toBe(false);

    expect(useTreasuryHeaderStore.getState().search.results[0]?.title).toBe(
      "Search result proposal",
    );
  });

  it("only shows loading if the search request stays pending", async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    useTreasuryHeaderStore.getState().setSearchQuery("search");

    renderHook(() => useHeaderSearch());

    await vi.advanceTimersByTimeAsync(250);
    expect(useTreasuryHeaderStore.getState().search.loading).toBe(false);

    await vi.advanceTimersByTimeAsync(149);
    expect(useTreasuryHeaderStore.getState().search.loading).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(useTreasuryHeaderStore.getState().search.loading).toBe(true);

    resolveFetch?.(
      new Response(
        JSON.stringify({
          items: [],
        }),
      ),
    );
    await flushAsyncWork();

    expect(useTreasuryHeaderStore.getState().search.loading).toBe(false);
  });

  it("clears results when the query is empty", async () => {
    useTreasuryHeaderStore.getState().setSearchResults([
      {
        id: "P-1",
        title: "Old result",
        proposer: "B62qsender",
        requestedAmount: "10 MINA",
        stage: "Voting",
        period: "Voting",
        createdAt: "2026-01-01",
      },
    ]);

    renderHook(() => useHeaderSearch());
    await flushAsyncWork();

    expect(useTreasuryHeaderStore.getState().search.results).toHaveLength(0);
  });
});
