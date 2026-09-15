import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  WalletSessionProvider,
  useWalletSession,
} from "./wallet-session-provider";
import type {
  ProviderSession,
  WalletSigningProvider,
  WalletSigningReviewHandler,
} from "./wallet-provider";

afterEach(cleanup);

for (const change of [
  "account notification",
  "provider switch",
  "disconnect pending",
  "disconnect and restore",
  "unmount",
  "unchanged",
] as const) {
  it(`settles asynchronous signing safely after ${change}`, async () => {
    let complete!: (value: unknown) => void;
    const signing = new Promise((resolve) => {
      complete = resolve;
    });
    let finishDisconnect!: () => void;
    const disconnecting = new Promise<void>((resolve) => {
      finishDisconnect = resolve;
    });
    const session: ProviderSession = {
      providerId: "ledger",
      address: "sender",
      displayName: "Ledger",
      details: [],
      data: { accountIndex: 0 },
    };
    let report!: WalletSigningReviewHandler;
    const onReview = vi.fn();
    const review = {
      wallet: "ledger" as const,
      hash: "0".repeat(60) + "3039",
      publicKey: "sender",
      accountIndex: 0,
    };
    let notify!: (next: ProviderSession | null) => void;
    const providers: WalletSigningProvider[] = ["ledger", "auro"].map((id) => ({
      id: id as "ledger" | "auro",
      name: id,
      connect: async () => session,
      restore: () => session,
      signZkapp: vi.fn((_session, request) => {
        report = request.onSigningReview!;
        report(review);
        return signing;
      }),
      disconnect: () => disconnecting,
      subscribe: (_session, callback) => {
        notify = callback;
        return () => {};
      },
    }));
    let wallet!: ReturnType<typeof useWalletSession>;
    function Consumer() {
      wallet = useWalletSession();
      return null;
    }
    const tree = (active: ProviderSession | null) => (
      <WalletSessionProvider
        providers={providers}
        auroInstalled
        initialSession={active}
        persistSession={false}
        onInstallAuro={() => {}}
      >
        <Consumer />
      </WalletSessionProvider>
    );
    const view = render(tree(session));
    await waitFor(() => expect(wallet.session).toBe(session));
    const result = wallet.signZkapp({
      onSigningReview: onReview,
      transactionJson: "{}",
      expectedSenderAddress: "sender",
      networkId: "devnet",
      minaNodeUrl: "https://mina.example/graphql",
      fee: "0.1",
      memo: "",
    });
    expect(onReview).toHaveBeenLastCalledWith(review);
    let disconnect: Promise<void> | undefined;
    await act(async () => {
      if (change === "account notification")
        notify({ ...session, address: "other" });
      if (change === "provider switch")
        view.rerender(tree({ ...session, providerId: "auro" }));
      if (
        change === "disconnect pending" ||
        change === "disconnect and restore"
      )
        disconnect = wallet.disconnectWallet();
      if (change === "unmount") view.unmount();
    });
    if (change === "disconnect and restore") {
      view.rerender(tree(null));
      view.rerender(tree(session));
      await waitFor(() => expect(wallet.session).toBe(session));
    }
    if (change !== "unchanged") {
      expect(onReview).toHaveBeenLastCalledWith(null);
      const calls = onReview.mock.calls.length;
      report(review);
      expect(onReview).toHaveBeenCalledTimes(calls);
    }
    complete({ signed: true });
    if (change === "unchanged")
      await expect(result).resolves.toEqual({ signed: true });
    else await expect(result).rejects.toThrow(/changed|disconnect|cancel/i);
    await act(async () => {
      finishDisconnect();
      await disconnect;
    });
    if (change === "disconnect and restore")
      expect(wallet.session).toBe(session);
    expect(onReview).toHaveBeenLastCalledWith(null);
    expect(providers[0]!.signZkapp).toHaveBeenCalledOnce();
  });
}
