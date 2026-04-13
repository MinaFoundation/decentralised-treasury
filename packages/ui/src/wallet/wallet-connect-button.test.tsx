import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TreasuryIntlProvider } from "../i18n";
import { WalletConnectButton } from "./wallet-connect-button";

afterEach(() => {
  cleanup();
});

describe("WalletConnectButton", () => {
  it("renders english default connect label", () => {
    render(<WalletConnectButton status="disconnected" />);

    const button = screen.getByRole("button", {
      name: "Connect Auro",
    });
    expect(button).toBeTruthy();
    expect(button.className.includes("bg-background/95")).toBe(true);
    expect(button.className.includes("border-border/80")).toBe(true);
  });

  it("renders connecting state as busy and disabled", () => {
    render(<WalletConnectButton status="connecting" />);
    const button = screen.getByRole("button", { name: "Connecting..." });

    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("renders initial loading state before provider resolution", () => {
    render(<WalletConnectButton status="disconnected" loading />);
    const button = screen.getByRole("button", { name: "Checking Auro..." });

    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("data-auro-installed")).toBe("yes");
  });

  it("shows the persisted address while a reconnect is still loading", () => {
    render(
      <WalletConnectButton
        status="connected"
        loading
        address="B62qwalletconnected1234567890abcdef"
      />,
    );

    expect(screen.getByRole("button", { name: "B62qwa...abcdef" })).toBeTruthy();
  });

  it("does not show the account dropdown while disconnected", () => {
    render(<WalletConnectButton status="disconnected" address="B62qwalletconnected1234567890abcdef" />);

    expect(
      screen.queryByRole("button", { name: "Open wallet account details" }),
    ).toBeNull();
  });

  it("does not show the account dropdown for install state", () => {
    render(
      <WalletConnectButton
        status="connected"
        isAuroInstalled={false}
        address="B62qwalletconnected1234567890abcdef"
        accountInfo={{ minaBalance: "284,120 MINA" }}
      />,
    );

    expect(screen.getByRole("button", { name: "Install Auro" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Open wallet account details" }),
    ).toBeNull();
  });

  it("shortens wallet address when connected", () => {
    render(
      <WalletConnectButton
        status="connected"
        address="B62qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
      />,
    );

    expect(screen.getByRole("button", { name: /^B62qqq\.\.\..+$/ })).toBeTruthy();
  });

  it("shows account details with one-row full addresses and no tooltips", () => {
    render(
      <WalletConnectButton
        status="connected"
        address="B62qwalletconnected1234567890abcdef"
        accountInfo={{
          minaBalance: "284,120 MINA",
          delegatedTo: "B62qdelegatedwallet1234567890abcdefghijklmnopqrstuv9Ab2",
          delegatedVotingWeight: "264,800 MINA",
        }}
      />,
    );

    const addressButton = screen.getByRole("button", { name: "B62qwa...abcdef" });
    expect(addressButton.className.includes("rounded-r-none")).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Open wallet account details" }),
    );

    expect(screen.getByText("Wallet")).toBeTruthy();
    expect(screen.getByText("Current lifecycle")).toBeTruthy();
    expect(screen.getByText("Wallet balance")).toBeTruthy();
    expect(screen.getByText("284,120 MINA")).toBeTruthy();
    expect(screen.getByText("Voting weight")).toBeTruthy();
    expect(screen.getByText("264,800 MINA")).toBeTruthy();
    expect(screen.getByText("Voting delegation")).toBeTruthy();
    expect(screen.getByText("Wallet address")).toBeTruthy();
    const accountSections = document.querySelectorAll('[data-component="wallet-account-section"]');
    expect(accountSections).toHaveLength(2);
    const addressRows = document.querySelectorAll('[data-component="wallet-address-row"]');
    expect(addressRows).toHaveLength(2);
    const addressFields = document.querySelectorAll('[data-component="wallet-address-field"]');
    expect(addressFields).toHaveLength(2);
    expect(screen.getAllByText("B62qwalletconnected1234567890abcdef").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("B62qdelegatedwallet1234567890abcdefghijklmnopqrstuv9Ab2").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Copy address" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy delegate address" })).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "B62qwalletconnected1234567890abcdef",
      }),
    ).toBeNull();
  });

  it("renders a wider account dropdown and loading state for connected wallets", () => {
    render(
      <WalletConnectButton
        status="connected"
        address="B62qwalletconnected1234567890abcdefghijklmnopqrstuvwxyz"
        accountInfoLoading
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open wallet account details" }),
    );

    expect(screen.getByText("Wallet")).toBeTruthy();
    expect(screen.getByText("Current lifecycle")).toBeTruthy();
    expect(screen.getByText("Wallet balance")).toBeTruthy();
    expect(screen.getByText("Voting weight")).toBeTruthy();
    expect(screen.getByText("Wallet address")).toBeTruthy();
    expect(screen.getByText("Voting delegation")).toBeTruthy();
    const accountSections = document.querySelectorAll('[data-component="wallet-account-section"]');
    expect(accountSections).toHaveLength(2);
    const addressFields = document.querySelectorAll('[data-component="wallet-address-field"]');
    expect(addressFields).toHaveLength(2);
    expect(
      document.querySelector('[data-component="wallet-account-loading"]'),
    ).toBeTruthy();
  });

  it("shows loaded fields with dashes when account data is missing", () => {
    render(
      <WalletConnectButton
        status="connected"
        address="B62qwalletconnected1234567890abcdefghijklmnopqrstuvwxyz"
        accountInfo={{}}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open wallet account details" }),
    );

    expect(screen.getByText("Wallet")).toBeTruthy();
    expect(screen.getByText("Current lifecycle")).toBeTruthy();
    expect(screen.getByText("Wallet balance")).toBeTruthy();
    expect(screen.getByText("Voting weight")).toBeTruthy();
    expect(screen.getByText("Voting delegation")).toBeTruthy();
    expect(screen.getByText("Wallet address")).toBeTruthy();
    expect(screen.getAllByText("-").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("B62qwalletconnected1234567890abcdefghijklmnopqrstuvwxyz")).toBeTruthy();
  });

  it("supports hiding the account dropdown even when account details exist", () => {
    render(
      <WalletConnectButton
        status="connected"
        address="B62qwalletconnected1234567890abcdef"
        accountInfo={{ minaBalance: "284,120 MINA" }}
        showAccountDropdown={false}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Open wallet account details" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "B62qwa...abcdef" })).toBeTruthy();
  });

  it("shows full addresses as text without copy controls", () => {
    render(
      <WalletConnectButton
        status="connected"
        address="B62qwalletconnected1234567890abcdef"
        accountInfo={{
          delegatedTo: "B62qdelegatedwallet1234567890abcdefghijklmnopqrstuv9Ab2",
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open wallet account details" }),
    );

    expect(screen.queryByRole("button", { name: "Copy address" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "B62qwalletconnected1234567890abcdef" }),
    ).toBeNull();
    expect(screen.getByText("B62qwalletconnected1234567890abcdef")).toBeTruthy();
  });

  it("shows disconnect label on hover when connected", () => {
    render(
      <WalletConnectButton
        status="connected"
        address="B62qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
      />,
    );

    const walletControl = document.querySelector('[data-component="wallet-connect-control"]');
    expect(walletControl?.className.includes("min-w-[13rem]")).toBe(true);
    const button = screen.getByRole("button", { name: /^B62qqq\.\.\..+$/ });

    fireEvent.mouseEnter(button);
    const disconnectButton = screen.getByRole("button", { name: "Disconnect" });
    expect(disconnectButton).toBeTruthy();

    fireEvent.mouseLeave(button);
    expect(screen.getByRole("button", { name: /^B62qqq\.\.\..+$/ })).toBeTruthy();
  });

  it("shows disconnect label on keyboard focus when connected", () => {
    render(
      <WalletConnectButton
        status="connected"
        address="B62qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq"
      />,
    );

    const button = screen.getByRole("button", { name: /^B62qqq\.\.\..+$/ });

    fireEvent.focus(button);
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();

    fireEvent.blur(button);
    expect(screen.getByRole("button", { name: /^B62qqq\.\.\..+$/ })).toBeTruthy();
  });

  it("uses dedicated disconnect action when connected", () => {
    const onWalletClick = vi.fn();
    const onDisconnectClick = vi.fn();

    render(
      <WalletConnectButton
        status="connected"
        address="B62qwalletconnected1234567890abcdef"
        onClick={onWalletClick}
        onDisconnectClick={onDisconnectClick}
      />,
    );

    const button = screen.getByRole("button", { name: "B62qwa...abcdef" });
    fireEvent.mouseEnter(button);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(onDisconnectClick).toHaveBeenCalledTimes(1);
    expect(onWalletClick).not.toHaveBeenCalled();
  });

  it("supports i18n override messages", () => {
    render(
      <WalletConnectButton
        status="disconnected"
        messages={{
          connect: "Conectar Auro",
        }}
      />,
    );

    const button = screen.getByRole("button", {
      name: "Conectar Auro",
    });
    expect(button).toBeTruthy();
  });

  it("uses react-intl provider messages for labels", () => {
    render(
      <TreasuryIntlProvider messages={{ "ui.wallet.connect": "Conectar con Auro" }}>
        <WalletConnectButton status="disconnected" />
      </TreasuryIntlProvider>,
    );

    const button = screen.getByRole("button", {
      name: "Conectar con Auro",
    });
    expect(button).toBeTruthy();
  });

  it("shows install label when Auro is missing", () => {
    render(<WalletConnectButton status="disconnected" isAuroInstalled={false} />);

    expect(screen.getByRole("button", { name: "Install Auro" })).toBeTruthy();
  });

  it("falls back to connect label and uses the wallet action in error state", () => {
    const onClick = vi.fn();
    render(<WalletConnectButton status="error" onClick={onClick} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect Auro" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("uses dedicated install action when Auro is missing", () => {
    const onWalletClick = vi.fn();
    const onInstallClick = vi.fn();

    render(
      <WalletConnectButton
        status="disconnected"
        isAuroInstalled={false}
        onClick={onWalletClick}
        onInstallClick={onInstallClick}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Install Auro" }));

    expect(onInstallClick).toHaveBeenCalledTimes(1);
    expect(onWalletClick).not.toHaveBeenCalled();
  });

  it("falls back to wallet action when install action is not provided", () => {
    const onWalletClick = vi.fn();

    render(
      <WalletConnectButton
        status="disconnected"
        isAuroInstalled={false}
        onClick={onWalletClick}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Install Auro" }));

    expect(onWalletClick).toHaveBeenCalledTimes(1);
  });
});
