import "reflect-metadata";
import {
  createIndexerDataSource,
  EventsApiServer,
  EventsRepository,
} from "@repo/indexer";
import { TreasuryOwnerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import { loadIndexerConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadIndexerConfig({
    treasuryOwnerContractClass: TreasuryOwnerSmartContract,
  });
  const dataSource = createIndexerDataSource(config);
  const repository = new EventsRepository(dataSource, config.databaseSchema, {
    knownEventTypes: config.knownEventTypes,
  });
  const apiServer = new EventsApiServer(repository, {
    port: config.indexerApiPort,
    pageLimitDefault: config.apiPageLimitDefault,
    pageLimitMax: config.apiPageLimitMax,
  });
  await apiServer.start();
}

main().catch((error) => {
  console.error("[indexer-api] startup failed", error);
  process.exit(1);
});
