import { describe, expect, it } from "vitest";
import { resolveMinaNetworkId } from "./mina-network-id";

describe("Mina network ID", () => {
  it.each([
    ["MAINNET", "mainnet"],
    ["DEVNET", "devnet"],
    ["LOCALNET", "devnet"],
  ] as const)("maps %s to %s", (configured, expected) => {
    expect(resolveMinaNetworkId(configured)).toBe(expected);
  });
});
