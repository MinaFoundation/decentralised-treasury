"use client";

import { useEffect } from "react";
import { useAppShellStore } from "../../app-shell/store/app-shell-store";
import { useEndpointSettingsStore } from "../../endpoint-settings/store/endpoint-settings-store";
import { useMinaBlockStore } from "../../mina-blocks/store/mina-block-store";
import { useTreasuryStore } from "../../treasury/store/treasury-store";
import { fetchMinaAccountBalanceNanomina } from "../lib/mina-accounts";

export function useTreasuryHeaderBalance(): void {
  const minaNodeUrl = useEndpointSettingsStore((state) => state.value.minaNodeUrl);
  const hydrated = useEndpointSettingsStore((state) => state.hydrated);
  const setTreasuryState = useTreasuryStore((state) => state.setTreasuryState);
  const setAppError = useAppShellStore((state) => state.setError);
  const refreshToken = useMinaBlockStore((state) => state.refreshToken);

  useEffect(() => {
    const treasuryOwnerAddress = process.env.NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS;

    if (!hydrated || !minaNodeUrl || !treasuryOwnerAddress) {
      setTreasuryState({
        balance: undefined,
        error: null,
        loading: false,
      });
      return;
    }

    let cancelled = false;

    const load = async () => {
      setTreasuryState({
        loading: true,
        error: null,
      });

      try {
        const balance = await fetchMinaAccountBalanceNanomina(minaNodeUrl, treasuryOwnerAddress);

        if (!cancelled) {
          setTreasuryState({
            balance,
            loading: false,
            error: null,
          });
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : "Failed to fetch treasury balance.";
          setTreasuryState({
            balance: undefined,
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
