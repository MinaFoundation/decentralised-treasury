import "reflect-metadata";
import {
  ArchiveClient,
  createIndexerDataSource,
  EventsApiServer,
  EventsRepository,
} from "@repo/indexer";
import { TreasuryOwnerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import { loadApiConfig } from "./config.js";
import { createIndexerStatusRoutes } from "./indexer-status-routes.js";

async function main(): Promise<void> {
  const config = loadApiConfig({
    treasuryOwnerContractClass: TreasuryOwnerSmartContract,
  });
  const dataSource = createIndexerDataSource(config);
  const repository = new EventsRepository(dataSource, config.databaseSchema, {
    knownEventTypes: config.knownEventTypes,
  });
  const archive = new ArchiveClient(config.archiveNodeUrl, {
    treasuryOwnerContractAddress: config.treasuryOwnerContractAddress,
    treasuryOwnerTokenId: config.treasuryOwnerTokenId,
    archiveRequestTimeoutMs: config.archiveRequestTimeoutMs,
  });
  const statusRoutes = createIndexerStatusRoutes({
    repository,
    archive,
  });

  const apiServer = new EventsApiServer(repository, {
    port: config.indexerApiPort,
    pageLimitDefault: config.apiPageLimitDefault,
    pageLimitMax: config.apiPageLimitMax,
    registerTopLevelRoutes: async (app) => {
      statusRoutes(app);
    },
  });

  await apiServer.start();
}

main().catch((error) => {
  console.error("[indexer-api] startup failed", error);
  process.exit(1);
});
