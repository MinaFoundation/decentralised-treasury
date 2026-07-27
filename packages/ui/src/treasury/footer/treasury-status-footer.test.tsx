import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TreasuryStatusFooter } from "./treasury-status-footer";

afterEach(() => {
  cleanup();
});

describe("TreasuryStatusFooter", () => {
  it("renders component progress using pending block heights", () => {
    render(
      <TreasuryStatusFooter
        networkId="MAINNET"
        health={{
          nodeBlockHeight: 12345,
          nodeFresh: true,
          archiveBlockHeight: 12345,
          archiveFresh: true,
          indexerBlockHeight: 12343,
          indexerFresh: true,
          processorRemainingEvents: 2,
          processorFresh: true,
        }}
      />,
    );

    expect(screen.getByText("Network")).toBeTruthy();
    expect(screen.getByText("Mainnet")).toBeTruthy();
    expect(screen.getByText("Node")).toBeTruthy();
    expect(screen.getByText("#12345")).toBeTruthy();
    expect(screen.getByText("Archive")).toBeTruthy();
    expect(screen.getByText("Up to date · #12345")).toBeTruthy();
    expect(screen.getByText("Indexer")).toBeTruthy();
    expect(screen.getByText("Behind by 2 · #12343")).toBeTruthy();
    expect(screen.getByText("Processor")).toBeTruthy();
    expect(screen.getByText("2 events pending")).toBeTruthy();
    expect(screen.queryByText("API")).toBeNull();
    expect(screen.queryByText("Lag")).toBeNull();
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

  it("renders a shortened build SHA", () => {
    const footer = render(
      <TreasuryStatusFooter
        networkId="MAINNET"
        buildSha="0123456789abcdef0123456789abcdef"
      />,
    );

    expect(footer.container.textContent).toContain("Build");
    expect(footer.container.textContent).toContain("0123456789ab");
  });

  it("falls back to dash for missing metric values", () => {
    render(<TreasuryStatusFooter networkId="DEVNET" />);
    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
  });

  it("shows all downstream components as up to date", () => {
    render(
      <TreasuryStatusFooter
        networkId="DEVNET"
        health={{
          nodeBlockHeight: 200,
          nodeFresh: true,
          archiveBlockHeight: 200,
          archiveFresh: true,
          indexerBlockHeight: 200,
          indexerFresh: true,
          processorRemainingEvents: 0,
          processorFresh: true,
        }}
      />,
    );

    expect(screen.getAllByText("Up to date · #200")).toHaveLength(2);
    expect(screen.getByText("Up to date")).toBeTruthy();
  });
});
