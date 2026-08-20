"use client";

import { useEffect, useRef } from "react";
import { useAppShellStore } from "../../app-shell/store/app-shell-store";
import { useEndpointSettingsStore } from "../../endpoint-settings/store/endpoint-settings-store";
import { useMinaBlockStore } from "../../mina-blocks/store/mina-block-store";
import { getRuntimeConfig } from "../../runtime-config/lib/get-runtime-config";
import { useTreasuryStore } from "../../treasury/store/treasury-store";
import { fetchMinaAccountBalanceNanomina } from "../lib/mina-accounts";

export function useTreasuryHeaderBalance(): void {
  const minaNodeUrl = useEndpointSettingsStore(
    (state) => state.value.minaNodeUrl,
  );
  const hydrated = useEndpointSettingsStore((state) => state.hydrated);
  const setTreasuryState = useTreasuryStore((state) => state.setTreasuryState);
  const setAppError = useAppShellStore((state) => state.setError);
  const refreshToken = useMinaBlockStore((state) => state.refreshToken);
  const loadedIdentityRef = useRef<string | null>(null);

  useEffect(() => {
    const treasuryOwnerAddress = getRuntimeConfig().treasuryOwnerContractAddress;

    if (!hydrated || !minaNodeUrl || !treasuryOwnerAddress) {
      loadedIdentityRef.current = null;
      setTreasuryState({
        balance: undefined,
        error: null,
        loading: false,
      });
      return;
    }

    let cancelled = false;
    const identity = `${minaNodeUrl}:${treasuryOwnerAddress}`;
    const isInitialLoad = loadedIdentityRef.current !== identity;

    const load = async () => {
      setTreasuryState({
        ...(isInitialLoad ? { balance: undefined } : {}),
        loading: isInitialLoad,
        error: null,
      });

      try {
        const balance = await fetchMinaAccountBalanceNanomina(
          minaNodeUrl,
          treasuryOwnerAddress,
        );

        if (!cancelled) {
          setTreasuryState({
            balance,
            loading: false,
            error: null,
          });
          loadedIdentityRef.current = identity;
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error
              ? error.message
              : "Failed to fetch treasury balance.";
          setTreasuryState({
            ...(isInitialLoad ? { balance: undefined } : {}),
            loading: false,
            error: message,
          });
          setAppError(message);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [hydrated, minaNodeUrl, refreshToken, setTreasuryState, setAppError]);
}
