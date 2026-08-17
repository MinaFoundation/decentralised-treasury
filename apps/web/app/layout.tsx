import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GlobalErrorNotification } from "../features/app-shell/containers/global-error-notification";
import { RuntimeConfigScript } from "../features/runtime-config/containers/runtime-config-script";
import { TreasuryHeaderContainer } from "../features/treasury-header/containers/treasury-header-container";
import { TreasuryStatusFooterContainer } from "../features/treasury-header/containers/treasury-status-footer-container";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mina Decentralized Treasury",
  description: "Client-side treasury shell using shared UI containers.",
};

// Rendered per request so `RuntimeConfigScript` reads the environment of the
// container that is serving the page. Prerendering this layout would freeze the
// build machine's configuration into the HTML and undo the whole point of a
// generic image.
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <RuntimeConfigScript />
      </head>
      <body>
        <Providers>
          <div className="min-h-screen bg-background">
            <GlobalErrorNotification />
            <div className="mx-auto w-full max-w-[92rem] px-3 sm:px-5 lg:px-6">
              <TreasuryHeaderContainer />
              <main className="w-full py-6">{children}</main>
              <TreasuryStatusFooterContainer />
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
