import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProviderSession,
  WalletSigningProvider,
} from "./wallet-provider";
import {
  WALLET_SESSION_STORAGE_KEY,
  WalletSessionProvider,
  useWalletSession,
} from "./wallet-session-provider";

function session(
  providerId: "auro" | "ledger",
  address: string,
  accountIndex?: number,
): ProviderSession {
  return {
    providerId,
    address,
    displayName: providerId === "auro" ? "Auro" : "Ledger",
    details: [{ label: "Wallet", value: providerId }],
    data: accountIndex === undefined ? undefined : { accountIndex },
  };
}

function TestConsumer() {
  const { wallet, session: activeSession, connectWallet, signZkapp } =
    useWalletSession();
  return (
    <div>
      <button onClick={connectWallet}>Open wallet</button>
      <button
        onClick={() =>
          void signZkapp({
            transactionJson: "{}",
            expectedSenderAddress: activeSession?.address ?? "",
            minaNodeUrl: "https://mina.example/graphql",
            networkId: "testnet",
            fee: "0.1",
            memo: "Test",
          })
        }
      >
        Sign transaction
      </button>
      <output>{wallet.address ?? "Disconnected"}</output>
    </div>
  );
}

describe("WalletSessionProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, "hid", {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("connects one Ledger account and stores its identity", async () => {
    const connectLedger = vi.fn(async (input?: unknown) => {
      const accountIndex = (input as { accountIndex: number }).accountIndex;
      return session("ledger", "B62qledger", accountIndex);
    });
    const providers: WalletSigningProvider[] = [
      {
        id: "ledger",
        name: "Ledger",
        connect: connectLedger,
        restore: () => session("ledger", "B62qledger", 0),
        signZkapp: vi.fn(),
        disconnect: vi.fn(),
      },
    ];

    render(
      <WalletSessionProvider
        providers={providers}
        auroInstalled={false}
        ledgerSupported
        onInstallAuro={vi.fn()}
      >
        <TestConsumer />
      </WalletSessionProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open wallet" }));
    const ledgerTab = screen.getByRole("tab", { name: "Ledger" });
    fireEvent.mouseDown(ledgerTab);
    fireEvent.click(ledgerTab);
    fireEvent.change(await screen.findByLabelText("Ledger account index"), {
      target: { value: "14" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(screen.getByText("B62qledger")).toBeTruthy());
    expect(connectLedger).toHaveBeenCalledWith({ accountIndex: 14 });
    expect(window.localStorage.getItem(WALLET_SESSION_STORAGE_KEY)).toBe(
      JSON.stringify({
        version: 2,
        providerId: "ledger",
        address: "B62qledger",
        accountIndex: 14,
      }),
    );
  });

  it("routes signing through the connected provider", async () => {
    const signZkapp = vi.fn().mockResolvedValue({ signed: true });
    const providers: WalletSigningProvider[] = [
      {
        id: "auro",
        name: "Auro",
        connect: async () => session("auro", "B62qauro"),
        restore: () => session("auro", "B62qauro"),
        signZkapp,
        disconnect: vi.fn(),
      },
    ];

    render(
      <WalletSessionProvider
        providers={providers}
        auroInstalled
        ledgerSupported={false}
        onInstallAuro={vi.fn()}
      >
        <TestConsumer />
      </WalletSessionProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open wallet" }));
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(screen.getByText("B62qauro")).toBeTruthy());

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Sign transaction" }),
      );
    });
    await waitFor(() => expect(signZkapp).toHaveBeenCalledOnce());
    expect(signZkapp.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ address: "B62qauro" }),
    );
  });
});
