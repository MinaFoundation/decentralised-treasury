export type TreasuryNetwork = "mainnet" | "devnet";

export function resolveTreasuryNetwork(value = "mainnet"): TreasuryNetwork {
  const network = value.trim().toLowerCase();
  if (network !== "mainnet" && network !== "devnet") {
    throw new Error("Network must be mainnet or devnet.");
  }
  return network;
}

export function minaNetworkCacheKey(
  value: TreasuryNetwork | "testnet" | { custom: string },
): string {
  return typeof value === "string"
    ? value
    : `custom-${encodeURIComponent(value.custom)}`;
}
