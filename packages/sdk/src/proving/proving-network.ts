import { Cache, Mina } from "o1js";
import { join } from "node:path";
import { resolveTreasuryNetwork } from "../utils/mina-network.js";

export function configureProvingNetwork() {
  const network = resolveTreasuryNetwork(process.env.NETWORK);
  Mina.setActiveInstance(
    Mina.Network({
      mina: process.env.MINA_NODE_URL ?? "http://127.0.0.1:8080/graphql",
      networkId: network,
    }),
  );
  return {
    network,
    cache: Cache.FileSystem(join(process.cwd(), "cache", network)),
  };
}
