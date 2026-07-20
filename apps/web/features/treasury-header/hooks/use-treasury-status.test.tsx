import { renderHook, waitFor } from "@testing-library/react";
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
    process.env.NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS =
      originalOwnerAddress;
    process.env.NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION =
      originalLifecyclePeriodDuration;
    vi.restoreAllMocks();
  });

  it("loads health and lifecycle context for the footer", async () => {
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
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            archive: {
              canonicalMaxBlockHeight: 100,
              pendingMaxBlockHeight: 102,
            },
            remainingCanonicalBlocks: 0,
            remainingPendingBlocks: 2,
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
    expect(useTreasuryStore.getState().health.apiStatus).toBe("healthy");
    expect(useTreasuryStore.getState().health.indexerStatus).toBe("degraded");
  });
});
