import "reflect-metadata";
import { EventsIndexer } from "@repo/indexer";
import { TreasuryOwnerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import { loadApiConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadApiConfig({
    treasuryOwnerContractClass: TreasuryOwnerSmartContract,
  });
  const indexer = EventsIndexer.fromConfig(config);
  await indexer.start();
}

main().catch((error) => {
  console.error("[events-indexer] startup failed", error);
  process.exit(1);
});
