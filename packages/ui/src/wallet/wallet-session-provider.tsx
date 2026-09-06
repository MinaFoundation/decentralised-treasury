"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { WalletConnectionDialog } from "./wallet-connection-dialog";
import type {
  ProviderSession,
  WalletProviderId,
  WalletSigningProvider,
  ZkappSigningRequest,
} from "./wallet-provider";
import type { WalletConnectionStatus, WalletDetail } from "./wallet-types";

export type { ProviderSession } from "./wallet-provider";

export const WALLET_SESSION_STORAGE_KEY = "treasury-wallet-session";

export interface WalletSessionState {
  loading: boolean;
  status: WalletConnectionStatus;
  address?: string;
  details?: WalletDetail[];
  error: string | null;
}

export interface WalletSessionContextValue {
  wallet: WalletSessionState;
  session: ProviderSession | null;
  connectWallet: () => void;
  disconnectWallet: () => Promise<void>;
  signZkapp: (request: ZkappSigningRequest) => Promise<unknown>;
}

export interface WalletSessionProviderProps {
  children: ReactNode;
  providers: readonly WalletSigningProvider[];
  auroInstalled: boolean;
  ledgerSupported?: boolean;
  onInstallAuro: () => void;
  storageKey?: string;
  persistSession?: boolean;
  initialSession?: ProviderSession | null;
  onWalletStateChange?: (state: WalletSessionState) => void;
  onSessionChange?: (session: ProviderSession | null) => void;
}

type PersistedWalletSession =
  | { version: 2; providerId: "auro"; address: string }
  | {
      version: 2;
      providerId: "ledger";
      address: string;
      accountIndex: number;
    };

const initialWalletState: WalletSessionState = {
  loading: true,
  status: "disconnected",
  error: null,
};

const WalletSessionContext = createContext<WalletSessionContextValue | null>(
  null,
);

function getLedgerAccountIndex(session: ProviderSession): number {
  const accountIndex = (
    session.data as { accountIndex?: unknown } | undefined
  )?.accountIndex;
  if (
    typeof accountIndex !== "number" ||
    !Number.isSafeInteger(accountIndex) ||
    accountIndex < 0 ||
    accountIndex > 0xffff_ffff
  ) {
    throw new Error("The Ledger account index is missing or invalid.");
  }
  return accountIndex;
}

function readPersistedSession(storageKey: string): PersistedWalletSession | null {
  if (typeof window === "undefined") return null;
  const rawValue = window.localStorage.getItem(storageKey);
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    if (
      parsed.version === 2 &&
      parsed.providerId === "auro" &&
      typeof parsed.address === "string"
    ) {
      return parsed as PersistedWalletSession;
    }
    if (
      parsed.version === 2 &&
      parsed.providerId === "ledger" &&
      typeof parsed.address === "string" &&
      Number.isSafeInteger(parsed.accountIndex) &&
      Number(parsed.accountIndex) >= 0 &&
      Number(parsed.accountIndex) <= 0xffff_ffff
    ) {
      return parsed as PersistedWalletSession;
    }
    if (parsed.connected === true && typeof parsed.address === "string") {
      return { version: 2, providerId: "auro", address: parsed.address };
    }
  } catch {
    // Remove the invalid record below.
  }
  window.localStorage.removeItem(storageKey);
  return null;
}

function persistWalletSession(
  storageKey: string,
  session: ProviderSession,
): void {
  if (typeof window === "undefined") return;
  const record: PersistedWalletSession =
    session.providerId === "ledger"
      ? {
          version: 2,
          providerId: "ledger",
          address: session.address,
          accountIndex: getLedgerAccountIndex(session),
        }
      : { version: 2, providerId: "auro", address: session.address };
  window.localStorage.setItem(storageKey, JSON.stringify(record));
}

export function WalletSessionProvider({
  children,
  providers,
  auroInstalled,
  ledgerSupported,
  onInstallAuro,
  storageKey = WALLET_SESSION_STORAGE_KEY,
  persistSession = true,
  initialSession,
  onWalletStateChange,
  onSessionChange,
}: WalletSessionProviderProps) {
  const providerMap = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  );
  const activeSessionRef = useRef<ProviderSession | null>(null);
  const [session, setSession] = useState<ProviderSession | null>(null);
  const [wallet, setWallet] =
    useState<WalletSessionState>(initialWalletState);
  const [dialogOpen, setDialogOpen] = useState(false);

  const applySession = useCallback(
    (nextSession: ProviderSession, save = true) => {
      activeSessionRef.current = nextSession;
      setSession(nextSession);
      if (persistSession && save) {
        persistWalletSession(storageKey, nextSession);
      }
      setWallet({
        loading: false,
        status: "connected",
        address: nextSession.address,
        details: nextSession.details,
        error: null,
      });
    },
    [persistSession, storageKey],
  );

  const clearSession = useCallback(() => {
    activeSessionRef.current = null;
    setSession(null);
    if (persistSession && typeof window !== "undefined") {
      window.localStorage.removeItem(storageKey);
    }
    setWallet({
      loading: false,
      status: "disconnected",
      error: null,
    });
  }, [persistSession, storageKey]);

  useEffect(() => {
    onWalletStateChange?.(wallet);
  }, [onWalletStateChange, wallet]);

  useEffect(() => {
    onSessionChange?.(session);
  }, [onSessionChange, session]);

  useEffect(() => {
    if (initialSession !== undefined) {
      if (initialSession) applySession(initialSession, false);
      else clearSession();
      return;
    }
    if (!persistSession) {
      clearSession();
      return;
    }

    const persisted = readPersistedSession(storageKey);
    if (!persisted) {
      clearSession();
      return;
    }
    const provider = providerMap.get(persisted.providerId);
    if (!provider || (persisted.providerId === "auro" && !auroInstalled)) {
      clearSession();
      return;
    }
    try {
      applySession(provider.restore(persisted), false);
    } catch {
      clearSession();
    }
  }, [
    applySession,
    auroInstalled,
    clearSession,
    initialSession,
    persistSession,
    providerMap,
    storageKey,
  ]);

  useEffect(() => {
    if (!session) return;
    const provider = providerMap.get(session.providerId);
    return provider?.subscribe?.(session, (nextSession) => {
      if (nextSession) applySession(nextSession);
      else clearSession();
    });
  }, [applySession, clearSession, providerMap, session]);

  const connectProvider = useCallback(
    async (
      providerId: WalletProviderId,
      input?: { accountIndex: number },
    ) => {
      const provider = providerMap.get(providerId);
      if (!provider) {
        throw new Error(`Unsupported wallet provider ${providerId}.`);
      }
      setWallet((current) => ({
        ...current,
        loading: false,
        status: "connecting",
        error: null,
      }));
      try {
        applySession(await provider.connect(input));
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Wallet connection failed.";
        setWallet({
          loading: false,
          status: "error",
          error: message,
        });
        throw cause;
      }
    },
    [applySession, providerMap],
  );

  const disconnectWallet = useCallback(async () => {
    const currentSession = activeSessionRef.current;
    try {
      if (currentSession) {
        await providerMap
          .get(currentSession.providerId)
          ?.disconnect(currentSession);
      }
    } finally {
      clearSession();
    }
  }, [clearSession, providerMap]);

  const signZkapp = useCallback(
    async (request: ZkappSigningRequest): Promise<unknown> => {
      request.signal?.throwIfAborted();
      const currentSession = activeSessionRef.current;
      if (!currentSession) {
        throw new Error("Connect a wallet before you sign the transaction.");
      }
      if (currentSession.address !== request.expectedSenderAddress) {
        throw new Error(
          "The connected wallet does not match the transaction sender.",
        );
      }
      const provider = providerMap.get(currentSession.providerId);
      if (!provider) {
        throw new Error("The connected wallet provider is not available.");
      }
      const result = await provider.signZkapp(currentSession, request);
      request.signal?.throwIfAborted();
      return result;
    },
    [providerMap],
  );

  const value = useMemo<WalletSessionContextValue>(
    () => ({
      wallet,
      session,
      connectWallet: () => setDialogOpen(true),
      disconnectWallet,
      signZkapp,
    }),
    [disconnectWallet, session, signZkapp, wallet],
  );

  return createElement(
    WalletSessionContext.Provider,
    { value },
    children,
    createElement(WalletConnectionDialog, {
      open: dialogOpen,
      onOpenChange: setDialogOpen,
      auroInstalled,
      ledgerSupported,
      onConnect: connectProvider,
      onInstallAuro,
    }),
  );
}

export function useWalletSession(): WalletSessionContextValue {
  const value = useContext(WalletSessionContext);
  if (!value) {
    throw new Error("WalletSessionProvider is missing.");
  }
  return value;
}
