import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEndpointSettingsStore } from "../../endpoint-settings/store/endpoint-settings-store";
import { useMinaBlockStore } from "../../mina-blocks/store/mina-block-store";
import { useTreasuryStore } from "../../treasury/store/treasury-store";
import * as minaAccounts from "../lib/mina-accounts";
import { useTreasuryHeaderBalance } from "./use-treasury-header-balance";

vi.mock("o1js", () => ({
  Mina: {
    Network: (config: unknown) => config,
    setActiveInstance: vi.fn(),
  },
  PublicKey: {
    fromBase58: (value: string) => value,
  },
  fetchAccount: vi.fn().mockResolvedValue({
    account: {
      balance: {
        toString: () => "124000000000",
      },
    },
    error: null,
  }),
}));

describe("useTreasuryHeaderBalance", () => {
  const originalOwnerAddress =
    process.env.NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS = "B62qtreasury";
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
    vi.restoreAllMocks();
  });

  it("loads only the treasury owner balance for the header", async () => {
    renderHook(() => useTreasuryHeaderBalance());

    await waitFor(() => {
      expect(useTreasuryStore.getState().balance).toBe("124000000000");
    });

    expect(useTreasuryStore.getState().error).toBeNull();
  });

  it("keeps the current balance visible during a block refresh", async () => {
    let resolveRefresh: ((value: string) => void) | undefined;
    vi.spyOn(minaAccounts, "fetchMinaAccountBalanceNanomina")
      .mockResolvedValueOnce("124000000000")
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveRefresh = resolve;
          }),
      );

    renderHook(() => useTreasuryHeaderBalance());

    await waitFor(() => {
      expect(useTreasuryStore.getState().balance).toBe("124000000000");
    });

    act(() => {
      useMinaBlockStore.getState().forceRefresh();
    });

    expect(useTreasuryStore.getState().balance).toBe("124000000000");
    expect(useTreasuryStore.getState().loading).toBe(false);

    resolveRefresh?.("125000000000");

    await waitFor(() => {
      expect(useTreasuryStore.getState().balance).toBe("125000000000");
    });
  });
});
