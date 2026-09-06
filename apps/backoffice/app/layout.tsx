import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RuntimeConfigScript } from "../features/runtime-config";
import { BackofficeHeaderControls } from "../features/backoffice-header-controls";
import { BackofficeProviders } from "../features/backoffice-providers";
import { TreasuryLogoIcon } from "@repo/ui/treasury-logo-icon";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mina Treasury Back Office",
  description: "Break-glass operations for the Mina decentralized treasury.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <RuntimeConfigScript />
      </head>
      <body>
        <BackofficeProviders>
          <div className="min-h-screen">
            <header className="border-b bg-white">
              <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
                <TreasuryLogoIcon />
                <div>
                  <div className="font-semibold">Mina Treasury</div>
                  <div className="text-sm text-muted-foreground">
                    Back office
                  </div>
                </div>
                <BackofficeHeaderControls />
              </div>
            </header>
            <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
              {children}
            </main>
          </div>
        </BackofficeProviders>
      </body>
    </html>
  );
}
