"use client";

import type { ReactNode } from "react";
import { TreasuryIntlProvider } from "@repo/ui/i18n";
import {
  WalletSessionProvider,
  type ProviderSession,
} from "@repo/ui/wallet-session-provider";
import { BackofficeSettingsProvider } from "./backoffice-settings";
import {
  backofficeWalletProviders,
  isAuroInstalled,
  isLedgerBrowserSupported,
} from "./wallets";

export interface BackofficeProvidersProps {
  children: ReactNode;
  initialSession?: ProviderSession | null;
  persistSession?: boolean;
}

export function BackofficeProviders({
  children,
  initialSession,
  persistSession,
}: BackofficeProvidersProps) {
  return (
    <TreasuryIntlProvider>
      <BackofficeSettingsProvider>
        <WalletSessionProvider
          providers={backofficeWalletProviders}
          auroInstalled={isAuroInstalled()}
          ledgerSupported={isLedgerBrowserSupported()}
          initialSession={initialSession}
          persistSession={persistSession}
          onInstallAuro={() => {
            window.open(
              "https://chromewebstore.google.com/detail/auro-wallet/cnmamaachppnkjgnildpdmkaakejnhae",
              "_blank",
              "noopener,noreferrer",
            );
          }}
        >
          {children}
        </WalletSessionProvider>
      </BackofficeSettingsProvider>
    </TreasuryIntlProvider>
  );
}
