import { describe, expect, it } from "vitest";
import { resolveMinaNetworkId } from "./mina-network-id";

describe("Mina network ID", () => {
  it.each([
    ["MAINNET", "mainnet"],
    ["DEVNET", "devnet"],
    [" DeVnEt ", "devnet"],
  ] as const)("maps %s to %s", (configured, expected) => {
    expect(resolveMinaNetworkId(configured)).toBe(expected);
  });

  it.each(["testnet", "localnet", "", "other"])(
    "rejects unsupported network %s",
    (configured) => {
      expect(() => resolveMinaNetworkId(configured)).toThrow(
        "Network must be mainnet or devnet.",
      );
    },
  );
});
