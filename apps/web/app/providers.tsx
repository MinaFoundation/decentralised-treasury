"use client";

import type { ReactNode } from "react";
import { TreasuryIntlProvider } from "@repo/ui/i18n";
import { useEndpointSettings } from "../features/endpoint-settings/hooks/use-endpoint-settings";
import { useMinaBlockPoller } from "../features/mina-blocks/hooks/use-mina-block-poller";

function TreasuryAppBootstrap(): null {
  useEndpointSettings();
  useMinaBlockPoller();
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <TreasuryIntlProvider>
      <TreasuryAppBootstrap />
      {children}
    </TreasuryIntlProvider>
  );
}
