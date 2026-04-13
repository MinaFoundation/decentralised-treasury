import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WalletButton } from "./wallet-button";

afterEach(() => {
  cleanup();
});

describe("WalletButton", () => {
  it("shows the wrapped action only when connected", () => {
    const { rerender } = render(
      <WalletButton status="disconnected">
        <button type="button">New proposal</button>
      </WalletButton>,
    );

    expect(screen.queryByRole("button", { name: "New proposal" })).toBeNull();
    const connectButton = screen.getByRole("button", { name: "Connect Auro" });
    expect(connectButton.className.includes("bg-primary")).toBe(true);

    rerender(
      <WalletButton status="connected">
        <button type="button">New proposal</button>
      </WalletButton>,
    );

    expect(screen.getByRole("button", { name: "New proposal" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect Auro" })).toBeNull();
  });

  it("supports a render function for connected content", () => {
    render(
      <WalletButton
        status="connected"
        address="B62qwalletconnected1234567890abcdef"
      >
        {({ address }) => <button type="button">{address}</button>}
      </WalletButton>,
    );

    expect(
      screen.getByRole("button", { name: "B62qwalletconnected1234567890abcdef" }),
    ).toBeTruthy();
  });

  it("falls back to install when the wallet is unavailable", () => {
    render(
      <WalletButton status="disconnected" isAuroInstalled={false}>
        <button type="button">New proposal</button>
      </WalletButton>,
    );

    expect(screen.getByRole("button", { name: "Install Auro" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New proposal" })).toBeNull();
  });

  it("renders the plain wallet button when no child action is provided", () => {
    render(<WalletButton status="disconnected" />);

    expect(screen.getByRole("button", { name: "Connect Auro" })).toBeTruthy();
  });
});
