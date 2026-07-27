"use client";

import { TreasuryStatusFooter } from "@repo/ui/treasury-status-footer";
import { useEndpointSettingsState } from "../../endpoint-settings/store/endpoint-settings-store.selectors";
import { useTreasuryState } from "../../treasury/store/treasury-store.selectors";

export function TreasuryStatusFooterContainer() {
  const settings = useEndpointSettingsState();
  const treasury = useTreasuryState();

  return (
    <TreasuryStatusFooter
      networkId={settings.value.networkId}
      health={treasury.health}
      buildSha={process.env.NEXT_PUBLIC_BUILD_SHA}
      className="max-w-none px-0 sm:px-0 lg:px-0"
    />
  );
}
