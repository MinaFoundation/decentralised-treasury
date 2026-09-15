import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  WalletSessionProvider,
  useWalletSession,
} from "./wallet-session-provider";
import type { ProviderSession, WalletSigningProvider } from "./wallet-provider";

afterEach(cleanup);

it("REVIEW DEFECT: disconnecting while Ledger signs must discard the completed result", async () => {
  let complete!: (value: unknown) => void;
  const signing = new Promise((resolve) => {
    complete = resolve;
  });
  const session: ProviderSession = {
    providerId: "ledger",
    address: "sender",
    displayName: "Ledger",
    details: [],
    data: { accountIndex: 0 },
  };
  const providers: WalletSigningProvider[] = [
    {
      id: "ledger",
      name: "Ledger",
      connect: async () => session,
      restore: () => session,
      signZkapp: vi.fn(() => signing),
      disconnect: async () => {},
    },
  ];
  let wallet!: ReturnType<typeof useWalletSession>;
  function Consumer() {
    wallet = useWalletSession();
    return null;
  }
  render(
    <WalletSessionProvider
      providers={providers}
      auroInstalled={false}
      initialSession={session}
      persistSession={false}
      onInstallAuro={() => {}}
    >
      <Consumer />
    </WalletSessionProvider>,
  );
  await waitFor(() => expect(wallet.session).toBe(session));
  const result = wallet.signZkapp({
    transactionJson: "{}",
    expectedSenderAddress: "sender",
    networkId: "devnet",
    minaNodeUrl: "https://mina.example/graphql",
    fee: "0.1",
    memo: "",
  });
  await act(async () => {
    await wallet.disconnectWallet();
  });
  expect(wallet.session).toBeNull();
  complete({ signed: true });
  await expect(result).rejects.toThrow(/changed|disconnect|cancel/i);
});

it("an explicit abort discards a late Ledger result", async () => {
  let complete!: (value: unknown) => void;
  const signing = new Promise((resolve) => {
    complete = resolve;
  });
  const session: ProviderSession = {
    providerId: "ledger",
    address: "sender",
    displayName: "Ledger",
    details: [],
    data: { accountIndex: 0 },
  };
  const providers: WalletSigningProvider[] = [
    {
      id: "ledger",
      name: "Ledger",
      connect: async () => session,
      restore: () => session,
      signZkapp: vi.fn(() => signing),
      disconnect: async () => {},
    },
  ];
  let wallet!: ReturnType<typeof useWalletSession>;
  function Consumer() {
    wallet = useWalletSession();
    return null;
  }
  render(
    <WalletSessionProvider
      providers={providers}
      auroInstalled={false}
      initialSession={session}
      persistSession={false}
      onInstallAuro={() => {}}
    >
      <Consumer />
    </WalletSessionProvider>,
  );
  await waitFor(() => expect(wallet.session).toBe(session));
  const controller = new AbortController();
  const result = wallet.signZkapp({
    transactionJson: "{}",
    expectedSenderAddress: "sender",
    networkId: "devnet",
    minaNodeUrl: "https://mina.example/graphql",
    fee: "0.1",
    memo: "",
    signal: controller.signal,
  });
  controller.abort();
  complete({ signed: true });
  await expect(result).rejects.toThrow(/abort/i);
});
