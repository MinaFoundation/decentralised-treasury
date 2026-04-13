import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TreasuryStatusFooter } from "./treasury-status-footer";

describe("TreasuryStatusFooter", () => {
  it("renders network and live metrics", () => {
    render(
      <TreasuryStatusFooter
        networkId="MAINNET"
        health={{
          apiStatus: "healthy",
          indexerStatus: "healthy",
          latestLiveSlot: 12345,
          latestLiveBlock: 987,
        }}
      />,
    );

    expect(screen.getByText("Network")).toBeTruthy();
    expect(screen.getByText("Mainnet")).toBeTruthy();
    expect(screen.getByText("Chain")).toBeTruthy();
    expect(screen.getByText("12345")).toBeTruthy();
    expect(screen.queryByText("987")).toBeNull();
  });

  it("uses custom env-configured network label", () => {
    render(
      <TreasuryStatusFooter
        networkId="STAGINGNET"
        networkConfigRaw='[{"id":"STAGINGNET","label":"Stagingnet"}]'
      />,
    );

    expect(screen.getByText("Stagingnet")).toBeTruthy();
  });

  it("falls back to dash for missing metric values", () => {
    render(<TreasuryStatusFooter networkId="DEVNET" />);
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
  });
});
