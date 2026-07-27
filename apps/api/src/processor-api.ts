import "reflect-metadata";
import { createProcessorDataSource } from "@repo/processor";
import { TreasuryOwnerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import { loadApiConfig } from "./config.js";
import { HttpApiServer } from "./http-api-server.js";
import { createProcessorCrudRoutes } from "./processor-crud-routes.js";
import { proposalProcessorOutputEntities } from "./processors/proposals/processor-output-entities.js";
import { createProcessorStatusRoutes } from "./processor-status-routes.js";

async function main(): Promise<void> {
  const config = loadApiConfig({
    treasuryOwnerContractClass: TreasuryOwnerSmartContract,
  });
  const dataSource = createProcessorDataSource(
    config,
    proposalProcessorOutputEntities,
  );

  await dataSource.initialize();

  const processorCrudRoutes = createProcessorCrudRoutes({
    dataSource,
    pageLimitDefault: config.apiPageLimitDefault,
    pageLimitMax: config.apiPageLimitMax,
  });
  const processorStatusRoutes = createProcessorStatusRoutes({
    dataSource,
    processorName: config.processorName,
    eventTypes: config.knownEventTypes,
  });

  const apiServer = new HttpApiServer({
    name: "processor-api",
    port: config.processorApiPort,
    corsAllowedOrigins: config.corsAllowedOrigins,
    registerRoutes: async (app) => {
      processorStatusRoutes(app);
      processorCrudRoutes(app);
    },
    onStop: async () => {
      await dataSource.destroy().catch(() => null);
    },
  });

  try {
    await apiServer.start();
  } catch (error) {
    await dataSource.destroy().catch(() => null);
    throw error;
  }
}

main().catch((error) => {
  console.error("[processor-api] startup failed", error);
  process.exit(1);
});
