import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMinaBlockStore } from "../../mina-blocks/store/mina-block-store";
import { WALLET_SESSION_STORAGE_KEY } from "../lib/wallet-session-storage";
import { useTreasuryHeaderStore } from "../store/treasury-header-store";
import { useWalletSession } from "./use-wallet-session";

type AccountsChangedListener = (accounts: string[]) => void;

describe("useWalletSession", () => {
  let requestAccountsMock: ReturnType<typeof vi.fn>;
  let onMock: ReturnType<typeof vi.fn>;
  let removeListenerMock: ReturnType<typeof vi.fn>;
  let accountsChangedListener: AccountsChangedListener | undefined;

  beforeEach(() => {
    requestAccountsMock = vi.fn().mockResolvedValue(["B62qwallet"]);
    onMock = vi.fn((eventName: string, listener: AccountsChangedListener) => {
      if (eventName === "accountsChanged") {
        accountsChangedListener = listener;
      }
    });
    removeListenerMock = vi.fn();

    useTreasuryHeaderStore.getState().reset();
    useMinaBlockStore.getState().reset();
    window.localStorage.clear();
    accountsChangedListener = undefined;
    window.mina = {
      requestAccounts: requestAccountsMock as () => Promise<string[]>,
      on: onMock as (eventName: string, listener: AccountsChangedListener) => void,
      removeListener: removeListenerMock as (
        eventName: string,
        listener: AccountsChangedListener,
      ) => void,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    delete window.mina;
  });

  it("persists wallet connection after an explicit connect", async () => {
    const { result } = renderHook(() => useWalletSession());

    await act(async () => {
      await result.current.connectWallet();
    });

    expect(useTreasuryHeaderStore.getState().wallet.status).toBe("connected");
    expect(useTreasuryHeaderStore.getState().wallet.address).toBe("B62qwallet");
    expect(window.localStorage.getItem(WALLET_SESSION_STORAGE_KEY)).toBe(
      JSON.stringify({ connected: true, address: "B62qwallet" }),
    );
  });

  it("restores a previously connected wallet across refresh", async () => {
    window.localStorage.setItem(
      WALLET_SESSION_STORAGE_KEY,
      JSON.stringify({ connected: true, address: "B62qwallet" }),
    );
    useTreasuryHeaderStore.getState().reset();

    renderHook(() => useWalletSession());

    expect(useTreasuryHeaderStore.getState().wallet.loading).toBe(false);
    expect(useTreasuryHeaderStore.getState().wallet.isAuroInstalled).toBe(true);

    await waitFor(() => {
      expect(useTreasuryHeaderStore.getState().wallet.status).toBe("connected");
    });

    expect(requestAccountsMock).toHaveBeenCalledTimes(1);
    expect(useTreasuryHeaderStore.getState().wallet.address).toBe("B62qwallet");
    expect(useTreasuryHeaderStore.getState().wallet.loading).toBe(false);
  });

  it("clears persisted wallet state on disconnect", () => {
    window.localStorage.setItem(
      WALLET_SESSION_STORAGE_KEY,
      JSON.stringify({ connected: true, address: "B62qwallet" }),
    );

    const { result } = renderHook(() => useWalletSession());

    act(() => {
      result.current.disconnectWallet();
    });

    expect(useTreasuryHeaderStore.getState().wallet.status).toBe("disconnected");
    expect(window.localStorage.getItem(WALLET_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("keeps local storage in sync with accountsChanged events", () => {
    renderHook(() => useWalletSession());

    act(() => {
      accountsChangedListener?.(["B62qnext"]);
    });

    expect(useTreasuryHeaderStore.getState().wallet.address).toBe("B62qnext");
    expect(window.localStorage.getItem(WALLET_SESSION_STORAGE_KEY)).toBe(
      JSON.stringify({ connected: true, address: "B62qnext" }),
    );

    act(() => {
      accountsChangedListener?.([]);
    });

    expect(useTreasuryHeaderStore.getState().wallet.status).toBe("disconnected");
    expect(window.localStorage.getItem(WALLET_SESSION_STORAGE_KEY)).toBeNull();
  });
});
