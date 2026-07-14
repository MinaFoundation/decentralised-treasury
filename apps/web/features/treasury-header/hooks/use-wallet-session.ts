"use client";

import { useEffect } from "react";
import { useAppShellStore } from "../../app-shell/store/app-shell-store";
import { useMinaBlockStore } from "../../mina-blocks/store/mina-block-store";
import {
  clearPersistedWalletSession,
  persistWalletSession,
  readPersistedWalletSession,
} from "../lib/wallet-session-storage";
import { useTreasuryHeaderStore } from "../store/treasury-header-store";

interface AuroWalletProvider {
  requestAccounts?: () => Promise<string[]>;
  sendTransaction?: (args: {
    onlySign?: boolean;
    nonce?: number;
    transaction: string | object;
    feePayer?: {
      fee?: number;
      memo?: string;
    };
  }) => Promise<{
    hash?: string;
    code?: number;
    message?: string;
    signedData?: string;
  }>;
  on?: (eventName: string, listener: (accounts: string[]) => void) => void;
  removeListener?: (
    eventName: string,
    listener: (accounts: string[]) => void,
  ) => void;
}

declare global {
  interface Window {
    mina?: AuroWalletProvider;
  }
}

export function useWalletSession() {
  const wallet = useTreasuryHeaderStore((state) => state.wallet);
  const setWalletState = useTreasuryHeaderStore(
    (state) => state.setWalletState,
  );
  const setAppError = useAppShellStore((state) => state.setError);
  const forceRefresh = useMinaBlockStore((state) => state.forceRefresh);

  useEffect(() => {
    const provider = typeof window === "undefined" ? undefined : window.mina;
    let cancelled = false;

    setWalletState({
      loading: false,
      isAuroInstalled: Boolean(provider),
    });

    const handleAccountsChanged = (accounts: string[]) => {
      const nextAddress = accounts[0];

      if (nextAddress) {
        persistWalletSession(nextAddress);
      } else {
        clearPersistedWalletSession();
      }

      setWalletState({
        loading: false,
        address: nextAddress,
        status: nextAddress ? "connected" : "disconnected",
        error: null,
        accountInfo: undefined,
        accountInfoLoading: false,
      });
      forceRefresh();
    };

    if (provider?.on) {
      provider.on("accountsChanged", handleAccountsChanged);
    }

    const persistedSession = readPersistedWalletSession();
    if (persistedSession?.connected && provider?.requestAccounts) {
      setWalletState({
        loading: false,
        error: null,
      });

      void provider
        .requestAccounts()
        .then((accounts) => {
          if (cancelled) {
            return;
          }

          handleAccountsChanged(accounts);
        })
        .catch(() => {
          if (cancelled) {
            return;
          }

          clearPersistedWalletSession();
          setWalletState({
            loading: false,
            status: "disconnected",
            address: undefined,
            error: null,
            accountInfo: undefined,
            accountInfoLoading: false,
          });
        });
    }

    if (!persistedSession?.connected || !provider?.requestAccounts) {
      setWalletState({
        loading: false,
      });
    }

    return () => {
      cancelled = true;
      provider?.removeListener?.("accountsChanged", handleAccountsChanged);
    };
  }, [forceRefresh, setWalletState]);

  const connectWallet = async () => {
    const provider = typeof window === "undefined" ? undefined : window.mina;

    if (!provider?.requestAccounts) {
      setWalletState({
        loading: false,
        isAuroInstalled: false,
        status: "disconnected",
      });
      return;
    }

    setWalletState({
      loading: false,
      status: "connecting",
      error: null,
    });

    try {
      const accounts = await provider.requestAccounts();
      const nextAddress = accounts[0];

      if (nextAddress) {
        persistWalletSession(nextAddress);
      } else {
        clearPersistedWalletSession();
      }

      setWalletState({
        loading: false,
        address: nextAddress,
        status: nextAddress ? "connected" : "disconnected",
        error: null,
      });
      forceRefresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Wallet connection failed.";
      setWalletState({
        loading: false,
        status: "error",
        error: message,
      });
      setAppError(message);
    }
  };

  const disconnectWallet = () => {
    clearPersistedWalletSession();
    setWalletState({
      loading: false,
      status: "disconnected",
      address: undefined,
      accountInfo: undefined,
      accountInfoLoading: false,
      error: null,
    });
  };

  return {
    wallet,
    connectWallet,
    disconnectWallet,
  };
}
