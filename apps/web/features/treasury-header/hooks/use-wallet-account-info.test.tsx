import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAccount } from "o1js";
import { useEndpointSettingsStore } from "../../endpoint-settings/store/endpoint-settings-store";
import { useMinaBlockStore } from "../../mina-blocks/store/mina-block-store";
import { useTreasuryStore } from "../../treasury/store/treasury-store";
import { useTreasuryHeaderStore } from "../store/treasury-header-store";
import * as minaAccounts from "../lib/mina-accounts";
import * as treasuryHeaderApi from "../lib/treasury-header-api";
import { useWalletAccountInfo } from "./use-wallet-account-info";

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
        toString: () => "4200000000",
      },
    },
    error: undefined,
  } as never),
}));

describe("useWalletAccountInfo", () => {
  beforeEach(() => {
    vi.mocked(fetchAccount).mockResolvedValue({
      account: {
        balance: {
          toString: () => "4200000000",
        },
      },
      error: undefined,
    } as never);
    useEndpointSettingsStore.getState().reset();
    useTreasuryStore.getState().reset();
    useTreasuryHeaderStore.getState().reset();
    useMinaBlockStore.getState().reset();
    useEndpointSettingsStore.getState().hydrateSettings({
      networkId: "MAINNET",
      apiUrl: "http://127.0.0.1:4000",
      indexerApiUrl: "http://127.0.0.1:4001",
      processorApiUrl: "http://127.0.0.1:4002",
      minaNodeUrl: "http://127.0.0.1:8080/graphql",
    });
    useTreasuryStore.getState().setTreasuryState({
      currentLifecycleId: 12,
    });
    useTreasuryHeaderStore.getState().setWalletState({
      status: "connected",
      address: "B62qwallet",
      isAuroInstalled: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("loads wallet balance and lifecycle account info", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            delegatePublicKey: "B62qdelegate",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            voteWeight: "120000000000",
          }),
        ),
      );

    renderHook(() => useWalletAccountInfo());

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        useTreasuryHeaderStore.getState().wallet.accountInfo?.minaBalance,
      ).toBe("4.2 MINA");
    });

    expect(
      useTreasuryHeaderStore.getState().wallet.accountInfo?.delegatedTo,
    ).toBe("B62qdelegate");
    expect(
      useTreasuryHeaderStore.getState().wallet.accountInfo?.votingWeight,
    ).toBe("120 MINA");
  });

  it("loads wallet account info for lifecycle zero", async () => {
    useTreasuryStore.getState().setTreasuryState({
      currentLifecycleId: 0,
    });

    const balanceSpy = vi
      .spyOn(minaAccounts, "fetchMinaAccountBalance")
      .mockResolvedValue("4.2 MINA");
    const lifecycleSpy = vi
      .spyOn(treasuryHeaderApi, "fetchWalletLifecycleAccountInfo")
      .mockResolvedValue({
        delegatedTo: "B62qdelegate",
        votingWeight: "120 MINA",
      });

    renderHook(() => useWalletAccountInfo());

    await waitFor(() => {
      expect(balanceSpy).toHaveBeenCalledWith(
        "http://127.0.0.1:8080/graphql",
        "B62qwallet",
      );
      expect(lifecycleSpy).toHaveBeenCalledWith(
        "http://127.0.0.1:4000",
        0,
        "B62qwallet",
      );
      expect(
        useTreasuryHeaderStore.getState().wallet.accountInfo?.minaBalance,
      ).toBe("4.2 MINA");
    });
  });

  it("loads wallet balance even when lifecycle is unavailable", async () => {
    useTreasuryStore.getState().setTreasuryState({
      currentLifecycleId: undefined,
    });

    const balanceSpy = vi
      .spyOn(minaAccounts, "fetchMinaAccountBalance")
      .mockResolvedValue("4.2 MINA");
    const lifecycleSpy = vi.spyOn(
      treasuryHeaderApi,
      "fetchWalletLifecycleAccountInfo",
    );

    renderHook(() => useWalletAccountInfo());

    await waitFor(() => {
      expect(balanceSpy).toHaveBeenCalledWith(
        "http://127.0.0.1:8080/graphql",
        "B62qwallet",
      );
      expect(
        useTreasuryHeaderStore.getState().wallet.accountInfo?.minaBalance,
      ).toBe("4.2 MINA");
    });

    expect(lifecycleSpy).not.toHaveBeenCalled();
    expect(useTreasuryHeaderStore.getState().wallet.error).toBeNull();
  });

  it("keeps account info visible during a block refresh", async () => {
    let resolveBalance: ((value: string) => void) | undefined;
    let resolveLifecycle:
      | ((
          value: Awaited<
            ReturnType<typeof treasuryHeaderApi.fetchWalletLifecycleAccountInfo>
          >,
        ) => void)
      | undefined;
    vi.spyOn(minaAccounts, "fetchMinaAccountBalance")
      .mockResolvedValueOnce("4.2 MINA")
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveBalance = resolve;
          }),
      );
    vi.spyOn(treasuryHeaderApi, "fetchWalletLifecycleAccountInfo")
      .mockResolvedValueOnce({
        delegatedTo: "B62qdelegate",
        votingWeight: "120 MINA",
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLifecycle = resolve;
          }),
      );

    renderHook(() => useWalletAccountInfo());

    await waitFor(() => {
      expect(
        useTreasuryHeaderStore.getState().wallet.accountInfo?.votingWeight,
      ).toBe("120 MINA");
    });

    act(() => {
      useMinaBlockStore.getState().forceRefresh();
    });

    expect(
      useTreasuryHeaderStore.getState().wallet.accountInfo?.votingWeight,
    ).toBe("120 MINA");
    expect(useTreasuryHeaderStore.getState().wallet.accountInfoLoading).toBe(
      false,
    );

    resolveBalance?.("4.3 MINA");
    resolveLifecycle?.({
      delegatedTo: "B62qdelegate",
      votingWeight: "121 MINA",
    });

    await waitFor(() => {
      expect(
        useTreasuryHeaderStore.getState().wallet.accountInfo?.votingWeight,
      ).toBe("121 MINA");
    });
  });
});
