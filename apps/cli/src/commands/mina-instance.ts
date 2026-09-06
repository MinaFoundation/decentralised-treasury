import { Option } from "commander";
import { Mina } from "o1js";

export type MinaNetworkId = "mainnet" | "devnet" | "testnet";

export function minaNetworkIdOption(): Option {
  return new Option("--network-id <network-id>", "Mina signature network")
    .choices(["mainnet", "devnet", "testnet"])
    .argParser((value) => value.toLowerCase())
    .env("MINA_NETWORK_ID")
    .default("devnet");
}

export function configureMinaNetwork(
  minaNodeUrl: string,
  networkId: MinaNetworkId,
): void {
  Mina.setActiveInstance(
    Mina.Network({
      mina: minaNodeUrl,
      networkId,
    }),
  );
}
