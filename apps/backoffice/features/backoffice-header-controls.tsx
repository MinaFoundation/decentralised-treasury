"use client";

import { TreasurySettingsDialog } from "@repo/ui/treasury-settings-dialog";
import { WalletConnectButton } from "@repo/ui/wallet-connect-button";
import { useWalletSession } from "@repo/ui/wallet-session-provider";
import { useBackofficeSettings } from "./backoffice-settings";

export function BackofficeHeaderControls() {
  const { wallet, connectWallet, disconnectWallet } = useWalletSession();
  const { settings, defaultSettings, saveSettings } =
    useBackofficeSettings();

  return (
    <div className="flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:w-auto">
      <WalletConnectButton
        status={wallet.status}
        loading={wallet.loading}
        address={wallet.address}
        details={wallet.details}
        onClick={connectWallet}
        onDisconnectClick={() => void disconnectWallet()}
        className="min-w-0 flex-1 sm:min-w-[13rem] sm:flex-none"
      />
      <TreasurySettingsDialog
        value={settings}
        defaultValue={defaultSettings}
        iconOnly
        onSave={saveSettings}
      />
    </div>
  );
}
