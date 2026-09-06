export function resolveMinaNetworkId(value: string): "mainnet" | "devnet" {
  return value.trim().toUpperCase() === "MAINNET" ? "mainnet" : "devnet";
}
