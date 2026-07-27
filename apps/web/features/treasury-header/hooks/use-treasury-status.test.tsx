import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEndpointSettingsStore } from "../../endpoint-settings/store/endpoint-settings-store";
import { useMinaBlockStore } from "../../mina-blocks/store/mina-block-store";
import {
  fetchCurrentTreasuryLifecycleSnapshot,
  fetchTreasuryPausedState,
} from "../../treasury/lib/treasury-lifecycle";
import { useTreasuryStore } from "../../treasury/store/treasury-store";
import { useTreasuryStatus } from "./use-treasury-status";

vi.mock("../../treasury/lib/treasury-lifecycle", () => ({
  fetchCurrentTreasuryLifecycleSnapshot: vi.fn(),
  fetchTreasuryPausedState: vi.fn(),
}));

describe("useTreasuryStatus", () => {
  const originalOwnerAddress =
    process.env.NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS;
  const originalLifecyclePeriodDuration =
    process.env.NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS = "B62qtreasury";
    process.env.NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION = "7140";
    useEndpointSettingsStore.getState().reset();
    useTreasuryStore.getState().reset();
    useMinaBlockStore.getState().reset();
    useEndpointSettingsStore.getState().hydrateSettings({
      networkId: "MAINNET",
      apiUrl: "http://127.0.0.1:4000",
      indexerApiUrl: "http://127.0.0.1:4001",
      processorApiUrl: "http://127.0.0.1:4002",
      minaNodeUrl: "http://127.0.0.1:8080/graphql",
    });
  });

  afterEach(() => {
    cleanup();
    process.env.NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS =
      originalOwnerAddress;
    process.env.NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION =
      originalLifecyclePeriodDuration;
    vi.restoreAllMocks();
  });

  it("loads health and lifecycle context for the footer", async () => {
    useMinaBlockStore.getState().registerBlock({
      height: 102,
      hash: "3Nnode",
    });
    vi.mocked(fetchCurrentTreasuryLifecycleSnapshot).mockResolvedValue({
      currentGlobalSlot: 18460115,
      treasuryDeployedAtSlot: 18403000,
      currentLifecycleId: 7,
      currentPeriod: "voting",
      currentPeriodProgress: 68,
      lifecycleStarted: true,
    });
    vi.mocked(fetchTreasuryPausedState).mockResolvedValue(true);

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            archive: {
              canonicalMaxBlockHeight: 100,
              pendingMaxBlockHeight: 102,
            },
            pendingCursor: 101,
            remainingCanonicalBlocks: 0,
            remainingPendingBlocks: 2,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            processorName: "proposal-processor",
            remainingEvents: 3,
          }),
        ),
      );

    renderHook(() => useTreasuryStatus());

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(fetchCurrentTreasuryLifecycleSnapshot).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/graphql",
      process.env.NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS,
      Number.parseInt(
        process.env.NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION ?? "",
        10,
      ),
    );
    expect(fetchTreasuryPausedState).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/graphql",
      process.env.NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS,
    );
    expect(useTreasuryStore.getState().currentLifecycleId).toBe(7);
    expect(useTreasuryStore.getState().currentPeriod).toBe("voting");
    expect(useTreasuryStore.getState().currentPeriodProgress).toBe(68);
    expect(useTreasuryStore.getState().currentGlobalSlot).toBe(18460115);
    expect(useTreasuryStore.getState().treasuryDeployedAtSlot).toBe(18403000);
    expect(useTreasuryStore.getState().paused).toBe(true);
    expect(useTreasuryStore.getState().health).toMatchObject({
      nodeBlockHeight: 102,
      nodeFresh: true,
      archiveBlockHeight: 102,
      archiveFresh: true,
      indexerBlockHeight: 101,
      indexerFresh: true,
      processorRemainingEvents: 3,
      processorFresh: true,
    });
  });

  it("preserves lifecycle state when a background refresh fails", async () => {
    useTreasuryStore.getState().setTreasuryState({
      currentLifecycleId: 7,
      currentPeriod: "voting",
      currentPeriodProgress: 68,
      currentGlobalSlot: 18460115,
      treasuryDeployedAtSlot: 18403000,
      lifecycleStarted: true,
      paused: true,
      health: {
        nodeBlockHeight: 102,
        nodeFresh: true,
        archiveBlockHeight: 101,
        archiveFresh: true,
        indexerBlockHeight: 100,
        indexerFresh: true,
        processorRemainingEvents: 0,
        processorFresh: true,
        updatedAt: "before",
      },
    });
    useMinaBlockStore.getState().registerBlock({
      height: 102,
      hash: "3Nnode",
    });
    vi.mocked(fetchCurrentTreasuryLifecycleSnapshot).mockRejectedValue(
      new Error("node unavailable"),
    );
    vi.mocked(fetchTreasuryPausedState).mockRejectedValue(
      new Error("node unavailable"),
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("unavailable", { status: 503 }),
    );

    renderHook(() => useTreasuryStatus());

    await waitFor(() => {
      expect(useTreasuryStore.getState().health.updatedAt).not.toBe("before");
    });

    expect(useTreasuryStore.getState().currentLifecycleId).toBe(7);
    expect(useTreasuryStore.getState().currentPeriod).toBe("voting");
    expect(useTreasuryStore.getState().currentPeriodProgress).toBe(68);
    expect(useTreasuryStore.getState().currentGlobalSlot).toBe(18460115);
    expect(useTreasuryStore.getState().treasuryDeployedAtSlot).toBe(18403000);
    expect(useTreasuryStore.getState().lifecycleStarted).toBe(true);
    expect(useTreasuryStore.getState().paused).toBe(true);
    expect(useTreasuryStore.getState().health).toMatchObject({
      nodeBlockHeight: 102,
      nodeFresh: true,
      archiveBlockHeight: 101,
      archiveFresh: false,
      indexerBlockHeight: 100,
      indexerFresh: false,
      processorRemainingEvents: 0,
      processorFresh: false,
    });
  });
});
