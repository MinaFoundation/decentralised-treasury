import {
  act,
  fireEvent,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMinaBlockStore } from "../../mina-blocks/store/mina-block-store";
import { WALLET_SESSION_STORAGE_KEY } from "../../wallet/lib/wallet-session-storage";
import { useTreasuryHeaderStore } from "../store/treasury-header-store";
import { useWalletSession } from "./use-wallet-session";
import { WalletSessionProvider } from "../../wallet/containers/wallet-session-provider";

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
      on: onMock as (
        eventName: string,
        listener: AccountsChangedListener,
      ) => void,
      removeListener: removeListenerMock as (
        eventName: string,
        listener: AccountsChangedListener,
      ) => void,
    };
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <WalletSessionProvider>{children}</WalletSessionProvider>
  );

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    delete window.mina;
  });

  it("persists wallet connection after an explicit connect", async () => {
    const { result } = renderHook(() => useWalletSession(), { wrapper });

    act(() => result.current.connectWallet());
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => {
      expect(useTreasuryHeaderStore.getState().wallet.status).toBe("connected");
    });

    expect(useTreasuryHeaderStore.getState().wallet.status).toBe("connected");
    expect(useTreasuryHeaderStore.getState().wallet.address).toBe("B62qwallet");
    expect(window.localStorage.getItem(WALLET_SESSION_STORAGE_KEY)).toBe(
      JSON.stringify({
        version: 2,
        providerId: "auro",
        address: "B62qwallet",
      }),
    );
  });

  it("restores a previously connected wallet without opening Auro", async () => {
    window.localStorage.setItem(
      WALLET_SESSION_STORAGE_KEY,
      JSON.stringify({ connected: true, address: "B62qwallet" }),
    );
    useTreasuryHeaderStore.getState().reset();

    renderHook(() => useWalletSession(), { wrapper });

    expect(useTreasuryHeaderStore.getState().wallet.loading).toBe(false);

    await waitFor(() => {
      expect(useTreasuryHeaderStore.getState().wallet.status).toBe("connected");
    });

    expect(requestAccountsMock).not.toHaveBeenCalled();
    expect(useTreasuryHeaderStore.getState().wallet.address).toBe("B62qwallet");
    expect(useTreasuryHeaderStore.getState().wallet.loading).toBe(false);
  });

  it("clears persisted wallet state on disconnect", async () => {
    window.localStorage.setItem(
      WALLET_SESSION_STORAGE_KEY,
      JSON.stringify({ connected: true, address: "B62qwallet" }),
    );

    const { result } = renderHook(() => useWalletSession(), { wrapper });

    await waitFor(() => {
      expect(useTreasuryHeaderStore.getState().wallet.status).toBe("connected");
    });

    await act(async () => {
      await result.current.disconnectWallet();
    });

    expect(useTreasuryHeaderStore.getState().wallet.status).toBe(
      "disconnected",
    );
    expect(window.localStorage.getItem(WALLET_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("keeps local storage in sync with accountsChanged events", async () => {
    window.localStorage.setItem(
      WALLET_SESSION_STORAGE_KEY,
      JSON.stringify({ connected: true, address: "B62qwallet" }),
    );
    renderHook(() => useWalletSession(), { wrapper });
    await waitFor(() => {
      expect(useTreasuryHeaderStore.getState().wallet.status).toBe("connected");
    });

    act(() => {
      accountsChangedListener?.(["B62qnext"]);
    });

    expect(useTreasuryHeaderStore.getState().wallet.address).toBe("B62qnext");
    expect(window.localStorage.getItem(WALLET_SESSION_STORAGE_KEY)).toBe(
      JSON.stringify({
        version: 2,
        providerId: "auro",
        address: "B62qnext",
      }),
    );

    act(() => {
      accountsChangedListener?.([]);
    });

    expect(useTreasuryHeaderStore.getState().wallet.status).toBe(
      "disconnected",
    );
    expect(window.localStorage.getItem(WALLET_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("restores a Ledger identity without requesting an Auro account", async () => {
    window.localStorage.setItem(
      WALLET_SESSION_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        providerId: "ledger",
        address: "B62qledger",
        accountIndex: 9,
      }),
    );

    renderHook(() => useWalletSession(), { wrapper });

    await waitFor(() => {
      expect(useTreasuryHeaderStore.getState().wallet.status).toBe("connected");
    });
    expect(requestAccountsMock).not.toHaveBeenCalled();
    expect(useTreasuryHeaderStore.getState().wallet.address).toBe("B62qledger");
    expect(useTreasuryHeaderStore.getState().wallet.details).toEqual([
      { label: "Wallet", value: "Ledger" },
      { label: "Account index", value: "9" },
    ]);
  });

  it("signs and submits through the provider-neutral controller", async () => {
    const transactionJson = JSON.stringify({
      feePayer: { body: { publicKey: "B62qwallet" } },
    });
    window.mina!.sendTransaction = vi.fn().mockResolvedValue({
      signedData: JSON.stringify({
        zkappCommand: { feePayer: { authorization: "signature" } },
      }),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          data: { sendZkapp: { zkapp: { hash: "5JuHash" } } },
        }),
      }),
    );
    const { result } = renderHook(() => useWalletSession(), { wrapper });
    act(() => result.current.connectWallet());
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => {
      expect(useTreasuryHeaderStore.getState().wallet.status).toBe("connected");
    });

    await expect(
      result.current.signAndSubmitZkapp({
        transactionJson,
        expectedSenderAddress: "B62qwallet",
        minaNodeUrl: "https://mina.example/graphql",
        networkId: "DEVNET",
        fee: "0.1",
        memo: "Vote",
      }),
    ).resolves.toBe("5JuHash");
  });
});
