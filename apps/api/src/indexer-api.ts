import "reflect-metadata";
import { pathToFileURL } from "node:url";
import {
  ArchiveClient,
  createIndexerDataSource,
  EventsApiServer,
  type EventsApiServerOptions,
  EventsRepository,
} from "@repo/indexer";
import { TreasuryOwnerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import { type ApiConfig, loadApiConfig } from "./config.js";
import {
  createIndexerStatusRoutes,
  type IndexerStatusRoutesOptions,
} from "./indexer-status-routes.js";

interface IndexerApiServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface IndexerApiRuntimeDependencies extends IndexerStatusRoutesOptions {
  config: ApiConfig;
  serverFactory?: (
    repository: EventsRepository,
    options: EventsApiServerOptions,
  ) => IndexerApiServer;
}

export function createIndexerApiRuntime({
  config,
  repository,
  archive,
  serverFactory = (eventsRepository, options) =>
    new EventsApiServer(eventsRepository, options),
}: IndexerApiRuntimeDependencies): IndexerApiServer {
  const statusRoutes = createIndexerStatusRoutes({
    repository,
    archive,
    runtimeMaxAgeMs: Math.max(
      30_000,
      config.pollPendingIntervalMs * 3,
      config.pollCanonicalIntervalMs * 3,
      config.archiveRequestTimeoutMs * 3,
    ),
  });
  return serverFactory(repository, {
    port: config.indexerApiPort,
    pageLimitDefault: config.apiPageLimitDefault,
    pageLimitMax: config.apiPageLimitMax,
    corsAllowedOrigins: config.corsAllowedOrigins,
    registerTopLevelRoutes: async (app) => {
      statusRoutes(app);
    },
  });
}

export async function main(): Promise<void> {
  const config = loadApiConfig({
    treasuryOwnerContractClass: TreasuryOwnerSmartContract,
  });
  const dataSource = createIndexerDataSource(config);
  const repository = new EventsRepository(dataSource, config.databaseSchema, {
    knownEventTypes: config.knownEventTypes,
  });
  const archive = new ArchiveClient(config.archiveNodeUrl, {
    treasuryOwnerContractAddress: config.treasuryOwnerContractAddress,
    archiveRequestTimeoutMs: config.archiveRequestTimeoutMs,
  });
  const runtime = createIndexerApiRuntime({
    config,
    repository,
    archive,
  });
  await runtime.start();
}

const entrypointPath = process.argv[1];
if (entrypointPath && import.meta.url === pathToFileURL(entrypointPath).href) {
  main().catch((error) => {
    console.error("[indexer-api] startup failed", error);
    process.exit(1);
  });
}
