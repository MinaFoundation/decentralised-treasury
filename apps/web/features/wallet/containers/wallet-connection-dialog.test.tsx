import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalletConnectionDialog } from "./wallet-connection-dialog";

describe("WalletConnectionDialog", () => {
  afterEach(cleanup);
  beforeEach(() => {
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, "hid", {
      configurable: true,
      value: {},
    });
  });

  it("does not show redundant instructions for an installed Auro wallet", () => {
    const onConnect = vi.fn();
    render(
      <WalletConnectionDialog
        open
        onOpenChange={vi.fn()}
        auroInstalled
        onConnect={onConnect}
        onInstallAuro={vi.fn()}
      />,
    );

    expect(screen.getByText("Auro Wallet available")).toBeTruthy();
    expect(screen.getByText("Ready to connect")).toBeTruthy();
    expect(
      screen.queryByText("Use the account that is currently selected in Auro."),
    ).toBeNull();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("links to Auro installation when the extension is unavailable", () => {
    const onInstallAuro = vi.fn();
    render(
      <WalletConnectionDialog
        open
        onOpenChange={vi.fn()}
        auroInstalled={false}
        onConnect={vi.fn()}
        onInstallAuro={onInstallAuro}
      />,
    );

    expect(screen.getByText("Auro Wallet unavailable")).toBeTruthy();
    expect(screen.getByText("Install Auro Wallet to continue")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Install Auro" }));
    expect(onInstallAuro).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Install Auro for Chrome" }),
    ).toBeNull();
  });

  it("passes the selected Ledger account index to the wallet boundary", async () => {
    const onConnect = vi.fn().mockResolvedValue(undefined);
    render(
      <WalletConnectionDialog
        open
        onOpenChange={vi.fn()}
        auroInstalled
        onConnect={onConnect}
        onInstallAuro={vi.fn()}
      />,
    );

    const ledgerTab = screen.getByRole("tab", { name: "Ledger" });
    fireEvent.mouseDown(ledgerTab);
    fireEvent.click(ledgerTab);
    await waitFor(() =>
      expect(ledgerTab).toHaveAttribute("data-state", "active"),
    );
    fireEvent.change(screen.getByLabelText("Ledger account index"), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => {
      expect(onConnect).toHaveBeenCalledWith("ledger", { accountIndex: 12 });
    });
  });

  it("shows the required Mina app version and blind-signing setting", async () => {
    render(
      <WalletConnectionDialog
        open
        onOpenChange={vi.fn()}
        auroInstalled
        onConnect={vi.fn()}
        onInstallAuro={vi.fn()}
      />,
    );

    const ledgerTab = screen.getByRole("tab", { name: "Ledger" });
    fireEvent.mouseDown(ledgerTab);
    fireEvent.click(ledgerTab);

    expect(
      await screen.findByText(
        "Before you connect, open Mina app 1.6.7 or newer on your Ledger device and enable blind signing.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Supported devices:/)).toBeNull();
    expect(screen.getByText(/enable blind signing/i)).toBeTruthy();
  });

  it("rejects a fractional Ledger account index", async () => {
    const onConnect = vi.fn();
    render(
      <WalletConnectionDialog
        open
        onOpenChange={vi.fn()}
        auroInstalled
        onConnect={onConnect}
        onInstallAuro={vi.fn()}
      />,
    );

    const ledgerTab = screen.getByRole("tab", { name: "Ledger" });
    fireEvent.mouseDown(ledgerTab);
    fireEvent.click(ledgerTab);
    await waitFor(() =>
      expect(ledgerTab).toHaveAttribute("data-state", "active"),
    );
    fireEvent.change(screen.getByLabelText("Ledger account index"), {
      target: { value: "1.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(
      await screen.findByText(/integer from 0 through 4294967295/),
    ).toBeTruthy();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("shows the Ledger support error below the provider tabs", async () => {
    render(
      <WalletConnectionDialog
        open
        onOpenChange={vi.fn()}
        auroInstalled
        ledgerSupported={false}
        onConnect={vi.fn()}
        onInstallAuro={vi.fn()}
      />,
    );

    const ledgerTab = screen.getByRole("tab", { name: "Ledger" });
    fireEvent.mouseDown(ledgerTab);
    fireEvent.click(ledgerTab);

    const supportError = await screen.findByText(
      "Ledger requires WebHID in a secure Chromium browser context.",
    );
    expect(supportError.closest('[role="tabpanel"]')).toBeNull();
    const connectButton = screen.getByRole("button", { name: "Connect" });
    expect(connectButton).toHaveClass("w-full");
    expect(supportError).toHaveClass("w-full", "text-center");
    expect(
      connectButton.compareDocumentPosition(supportError) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows a loading state while the selected provider is prompting", async () => {
    let finishConnect: (() => void) | undefined;
    const onConnect = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishConnect = resolve;
        }),
    );
    render(
      <WalletConnectionDialog
        open
        onOpenChange={vi.fn()}
        auroInstalled
        onConnect={onConnect}
        onInstallAuro={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    const loadingButton = screen.getByRole("button", {
      name: "Connecting...",
    });
    expect(loadingButton.getAttribute("aria-busy")).toBe("true");
    expect(loadingButton).toBeDisabled();
    expect(screen.getByText("Confirm in Auro")).toBeTruthy();
    expect(
      screen.getByText("Approve the account connection request in Auro Wallet."),
    ).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Auro" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Ledger" })).toBeDisabled();

    finishConnect?.();
    await waitFor(() => expect(onConnect).toHaveBeenCalledWith("auro"));
  });

  it("guides the user to confirm the Ledger connection on the device", async () => {
    const onConnect = vi.fn(() => new Promise<void>(() => undefined));
    render(
      <WalletConnectionDialog
        open
        onOpenChange={vi.fn()}
        auroInstalled
        onConnect={onConnect}
        onInstallAuro={vi.fn()}
      />,
    );

    const ledgerTab = screen.getByRole("tab", { name: "Ledger" });
    fireEvent.mouseDown(ledgerTab);
    fireEvent.click(ledgerTab);
    await waitFor(() =>
      expect(ledgerTab).toHaveAttribute("data-state", "active"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByText("Confirm on device")).toBeTruthy();
    expect(
      screen.getByText(/Approve the address request in the Mina app/),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Ledger account index")).toBeNull();
  });
});
