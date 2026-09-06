"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import {
  WalletSessionProvider as SharedWalletSessionProvider,
  useWalletSession as useSharedWalletSession,
  type WalletSessionState,
} from "@repo/ui/wallet-session-provider";
import type { ZkappSigningRequest } from "@repo/ui/wallet-provider";
import { useMinaBlockStore } from "../../mina-blocks/store/mina-block-store";
import { useTreasuryHeaderStore } from "../../treasury-header/store/treasury-header-store";
import { submitSignedZkappCommand } from "../lib/zkapp-submission";
import { getAuroWalletClient } from "../providers/auro-wallet-client";
import { auroWalletProvider } from "../providers/auro-wallet-provider";
import { ledgerWalletProvider } from "../providers/ledger-wallet-provider";

interface WalletSessionContextValue {
  connectWallet: () => void;
  disconnectWallet: () => Promise<void>;
  signAndSubmitZkapp: (request: ZkappSigningRequest) => Promise<string>;
}

const WalletSessionContext = createContext<WalletSessionContextValue | null>(
  null,
);
const providers = [auroWalletProvider, ledgerWalletProvider] as const;

function WalletSessionBridge({ children }: { children: ReactNode }) {
  const { connectWallet, disconnectWallet, signZkapp } =
    useSharedWalletSession();
  const signAndSubmitZkapp = useCallback(
    async (request: ZkappSigningRequest): Promise<string> => {
      const signedCommand = await signZkapp(request);
      return await submitSignedZkappCommand(
        request.minaNodeUrl,
        signedCommand,
        request.signal,
      );
    },
    [signZkapp],
  );
  const value = useMemo(
    () => ({ connectWallet, disconnectWallet, signAndSubmitZkapp }),
    [connectWallet, disconnectWallet, signAndSubmitZkapp],
  );
  return (
    <WalletSessionContext.Provider value={value}>
      {children}
    </WalletSessionContext.Provider>
  );
}

export function WalletSessionProvider({ children }: { children: ReactNode }) {
  const setWalletState = useTreasuryHeaderStore(
    (state) => state.setWalletState,
  );
  const forceRefresh = useMinaBlockStore((state) => state.forceRefresh);
  const updateWalletState = useCallback(
    (wallet: WalletSessionState) => {
      setWalletState({
        ...wallet,
        accountInfo: undefined,
        accountInfoLoading: false,
      });
    },
    [setWalletState],
  );
  const refreshForSession = useCallback(() => {
    forceRefresh();
  }, [forceRefresh]);

  return (
    <SharedWalletSessionProvider
      providers={providers}
      auroInstalled={Boolean(getAuroWalletClient())}
      onInstallAuro={() => {
        window.open(
          "https://chromewebstore.google.com/detail/auro-wallet/cnmamaachppnkjgnildpdmkaakejnhae",
          "_blank",
          "noopener,noreferrer",
        );
      }}
      onWalletStateChange={updateWalletState}
      onSessionChange={refreshForSession}
    >
      <WalletSessionBridge>{children}</WalletSessionBridge>
    </SharedWalletSessionProvider>
  );
}

export function useWalletSessionController(): WalletSessionContextValue {
  const value = useContext(WalletSessionContext);
  if (!value) {
    throw new Error("WalletSessionProvider is missing.");
  }
  return value;
}
