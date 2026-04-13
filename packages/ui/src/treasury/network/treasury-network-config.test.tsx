import { describe, expect, it } from "vitest";
import {
  resolveTreasuryNetworkLabel,
  resolveTreasuryNetworkOptions,
} from "./treasury-network-config";

describe("treasury-network-config", () => {
  it("includes built-in networks by default", () => {
    const networks = resolveTreasuryNetworkOptions();
    const ids = networks.map((network) => network.id);

    expect(ids).toContain("MAINNET");
    expect(ids).toContain("DEVNET");
    expect(ids).toContain("LIGHTNET");
  });

  it("extends networks from env-style config", () => {
    const networks = resolveTreasuryNetworkOptions({
      networkConfigRaw: JSON.stringify([
        "MAINNET",
        "DEVNET",
        "LIGHTNET",
        { id: "stagingnet", label: "Stagingnet" },
      ]),
    });

    expect(networks.find((network) => network.id === "STAGINGNET")?.label).toBe(
      "Stagingnet",
    );
  });

  it("resolves labels from configured networks", () => {
    const networks = resolveTreasuryNetworkOptions({
      networkConfigRaw: '["MAINNET","DEVNET","LIGHTNET","internal_net"]',
    });

    expect(resolveTreasuryNetworkLabel("INTERNAL_NET", networks)).toBe("Internal Net");
    expect(resolveTreasuryNetworkLabel("MAINNET", networks)).toBe("Mainnet");
  });
});
