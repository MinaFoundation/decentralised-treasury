import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEndpointSettingsStore } from "../../endpoint-settings/store/endpoint-settings-store";
import { initialMinaBlockState, useMinaBlockStore } from "../store/mina-block-store";
import { useMinaBlockPoller } from "./use-mina-block-poller";

describe("useMinaBlockPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useEndpointSettingsStore.getState().reset();
    useMinaBlockStore.setState(initialMinaBlockState);
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

  it("registers a new block and increments refresh token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              bestChain: [
                {
                  stateHash: "hash-1",
                  protocolState: {
                    consensusState: {
                      blockHeight: "42",
                    },
                  },
                },
              ],
            },
          }),
        ),
      );

    renderHook(() => useMinaBlockPoller());

    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useMinaBlockStore.getState().latestBlockHeight).toBe(42);

    expect(useMinaBlockStore.getState().refreshToken).toBe(1);
  });

  it("does not increment refresh token when the polled block is unchanged", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              bestChain: [
                {
                  stateHash: "hash-1",
                  protocolState: {
                    consensusState: {
                      blockHeight: "42",
                    },
                  },
                },
              ],
            },
          }),
        ),
      );

    renderHook(() => useMinaBlockPoller());

    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(useMinaBlockStore.getState().refreshToken).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(2);

    expect(useMinaBlockStore.getState().refreshToken).toBe(1);
  });
});
