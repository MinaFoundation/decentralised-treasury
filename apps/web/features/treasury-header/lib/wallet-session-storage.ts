"use client";

export const WALLET_SESSION_STORAGE_KEY = "treasury-wallet-session";

export interface PersistedWalletSession {
  connected: boolean;
  address?: string;
}

export function isWalletProviderInstalled(): boolean | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return Boolean(window.mina);
}

export function readPersistedWalletSession(): PersistedWalletSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(WALLET_SESSION_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as PersistedWalletSession;
  } catch {
    window.localStorage.removeItem(WALLET_SESSION_STORAGE_KEY);
    return null;
  }
}

export function persistWalletSession(address?: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    WALLET_SESSION_STORAGE_KEY,
    JSON.stringify({
      connected: true,
      address,
    } satisfies PersistedWalletSession),
  );
}

export function clearPersistedWalletSession(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(WALLET_SESSION_STORAGE_KEY);
}
