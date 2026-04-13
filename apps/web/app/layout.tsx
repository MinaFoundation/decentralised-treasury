import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GlobalErrorNotification } from "../features/app-shell/containers/global-error-notification";
import { TreasuryHeaderContainer } from "../features/treasury-header/containers/treasury-header-container";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mina Decentralized Treasury",
  description: "Client-side treasury shell using shared UI containers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="min-h-screen bg-background">
            <GlobalErrorNotification />
            <div className="mx-auto w-full max-w-[92rem] px-3 sm:px-5 lg:px-6">
              <TreasuryHeaderContainer />
              <main className="w-full py-6">
                {children}
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
