"use client";

import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import type { WalletProviderId } from "./wallet-provider";

export interface WalletConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  auroInstalled: boolean;
  ledgerSupported?: boolean;
  onConnect: (
    providerId: WalletProviderId,
    input?: { accountIndex: number },
  ) => Promise<void>;
  onInstallAuro: () => void;
}

export function isLedgerBrowserSupported(): boolean {
  if (typeof window === "undefined" || !window.isSecureContext) {
    return false;
  }
  return Boolean((navigator as Navigator & { hid?: unknown }).hid);
}

export function WalletConnectionDialog({
  open,
  onOpenChange,
  auroInstalled,
  ledgerSupported: ledgerSupportedOverride,
  onConnect,
  onInstallAuro,
}: WalletConnectionDialogProps) {
  const [choice, setChoice] = useState<WalletProviderId>("auro");
  const [accountIndex, setAccountIndex] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ledgerSupported =
    ledgerSupportedOverride ?? isLedgerBrowserSupported();
  const availabilityError =
    choice === "ledger" && !ledgerSupported
      ? "Ledger requires WebHID in a secure Chromium browser context."
      : null;

  useEffect(() => {
    if (open) {
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const connect = async () => {
    setError(null);
    setBusy(true);
    try {
      if (choice === "ledger") {
        const parsedIndex = Number(accountIndex);
        if (
          accountIndex.trim() === "" ||
          !Number.isSafeInteger(parsedIndex) ||
          parsedIndex < 0 ||
          parsedIndex > 0xffff_ffff
        ) {
          throw new Error(
            "Account index must be an integer from 0 through 4294967295.",
          );
        }
        await onConnect("ledger", { accountIndex: parsedIndex });
      } else {
        await onConnect("auro");
      }
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Wallet connection failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="border-0 outline-none sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect wallet</DialogTitle>
          <DialogDescription>
            Select the wallet that identifies your account and signs the
            current operation.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={choice}
          onValueChange={(value) => {
            setChoice(value as WalletProviderId);
            setError(null);
          }}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="auro" disabled={busy}>
              Auro
            </TabsTrigger>
            <TabsTrigger value="ledger" disabled={busy}>
              Ledger
            </TabsTrigger>
          </TabsList>

          <TabsContent value="auro">
            <div
              className="flex items-center justify-center py-4 text-center"
              role="status"
              aria-live="polite"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {busy && choice === "auro"
                    ? "Confirm in Auro"
                    : auroInstalled
                      ? "Auro Wallet available"
                      : "Auro Wallet unavailable"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {busy && choice === "auro"
                    ? "Approve the account connection request in Auro Wallet."
                    : auroInstalled
                      ? "Ready to connect"
                      : "Install Auro Wallet to continue"}
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="ledger">
            <div className="min-h-40 py-4">
              {busy && choice === "ledger" ? (
                <div
                  className="flex min-h-32 items-center justify-center text-center"
                  role="status"
                  aria-live="polite"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Confirm on device</p>
                    <p className="text-sm text-muted-foreground">
                      Approve the address request in the Mina app on your
                      Ledger device.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <label
                    htmlFor="ledger-account-index"
                    className="text-sm font-medium"
                  >
                    Ledger account index
                  </label>
                  <Input
                    id="ledger-account-index"
                    type="number"
                    min={0}
                    max={0xffff_ffff}
                    step={1}
                    value={accountIndex}
                    onChange={(event) => setAccountIndex(event.target.value)}
                    disabled={!ledgerSupported}
                  />
                  <p className="text-sm text-muted-foreground">
                    Before you connect, open Mina app 1.6.7 or newer on your
                    Ledger device and enable blind signing.
                  </p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-0">
          <Button
            type="button"
            className="w-full"
            onClick={() => {
              if (choice === "auro" && !auroInstalled) {
                onInstallAuro();
                return;
              }
              void connect();
            }}
            aria-busy={busy}
            disabled={busy || (choice === "ledger" && !ledgerSupported)}
          >
            {busy
              ? "Connecting..."
              : choice === "auro" && !auroInstalled
                ? "Install Auro"
                : "Connect"}
          </Button>
        </DialogFooter>

        {error || availabilityError ? (
          <p className="w-full text-center text-sm text-destructive">
            {error ?? availabilityError}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
