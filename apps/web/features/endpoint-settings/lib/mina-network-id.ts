import { resolveTreasuryNetwork } from "@repo/sdk/src/utils/mina-network.js";

export function resolveMinaNetworkId(value: string): "mainnet" | "devnet" {
  return resolveTreasuryNetwork(value);
}
