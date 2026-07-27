"use client";

import { useEffect, useRef } from "react";
import { useAppShellStore } from "../../app-shell/store/app-shell-store";
import { useEndpointSettingsStore } from "../../endpoint-settings/store/endpoint-settings-store";
import { useMinaBlockStore } from "../../mina-blocks/store/mina-block-store";
import { useTreasuryStore } from "../../treasury/store/treasury-store";
import { fetchMinaAccountBalance } from "../lib/mina-accounts";
import { fetchWalletLifecycleAccountInfo } from "../lib/treasury-header-api";
import { useTreasuryHeaderStore } from "../store/treasury-header-store";

export function useWalletAccountInfo(): void {
  const settings = useEndpointSettingsStore((state) => state.value);
  const hydrated = useEndpointSettingsStore((state) => state.hydrated);
  const wallet = useTreasuryHeaderStore((state) => state.wallet);
  const currentLifecycleId = useTreasuryStore(
    (state) => state.currentLifecycleId,
  );
  const setWalletAccountInfo = useTreasuryHeaderStore(
    (state) => state.setWalletAccountInfo,
  );
  const setWalletAccountInfoLoading = useTreasuryHeaderStore(
    (state) => state.setWalletAccountInfoLoading,
  );
  const setWalletState = useTreasuryHeaderStore(
    (state) => state.setWalletState,
  );
  const setAppError = useAppShellStore((state) => state.setError);
  const refreshToken = useMinaBlockStore((state) => state.refreshToken);
  const loadedIdentityRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      !hydrated ||
      wallet.status !== "connected" ||
      !wallet.address ||
      !settings.minaNodeUrl
    ) {
      loadedIdentityRef.current = null;
      return;
    }

    let cancelled = false;
    const address = wallet.address;
    const apiUrl = settings.apiUrl;
    const minaNodeUrl = settings.minaNodeUrl;
    const shouldFetchLifecycleInfo =
      currentLifecycleId != null && Boolean(apiUrl);
    const identity = JSON.stringify({
      address,
      apiUrl,
      minaNodeUrl,
      currentLifecycleId,
    });
    const isInitialLoad = loadedIdentityRef.current !== identity;

    const load = async () => {
      if (isInitialLoad) {
        setWalletAccountInfo(undefined);
        setWalletAccountInfoLoading(true);
      }
      const [minaBalanceResult, lifecycleAccountInfoResult] =
        await Promise.allSettled([
          fetchMinaAccountBalance(minaNodeUrl, address),
          shouldFetchLifecycleInfo
            ? fetchWalletLifecycleAccountInfo(
                apiUrl,
                currentLifecycleId,
                address,
              )
            : Promise.resolve(undefined),
        ]);

      if (cancelled) {
        return;
      }

      const minaBalance =
        minaBalanceResult.status === "fulfilled"
          ? minaBalanceResult.value
          : undefined;
      const lifecycleAccountInfo =
        lifecycleAccountInfoResult.status === "fulfilled"
          ? lifecycleAccountInfoResult.value
          : undefined;

      if (minaBalance || lifecycleAccountInfo) {
        setWalletAccountInfo({
          minaBalance,
          delegatedTo: lifecycleAccountInfo?.delegatedTo,
          votingWeight: lifecycleAccountInfo?.votingWeight,
        });
        loadedIdentityRef.current = identity;
      } else if (isInitialLoad) {
        setWalletAccountInfo(undefined);
      }

      if (minaBalanceResult.status === "rejected") {
        const message =
          minaBalanceResult.reason instanceof Error
            ? minaBalanceResult.reason.message
            : "Failed to load wallet account info.";
        setWalletState({
          error: message,
        });
        setAppError(message);
      } else {
        setWalletState({
          error: null,
        });
      }
      if (isInitialLoad) {
        setWalletAccountInfoLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [
    currentLifecycleId,
    hydrated,
    refreshToken,
    setWalletAccountInfo,
    setWalletAccountInfoLoading,
    setWalletState,
    setAppError,
    settings.apiUrl,
    settings.minaNodeUrl,
    wallet.address,
    wallet.status,
  ]);
}
