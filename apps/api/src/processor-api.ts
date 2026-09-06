import "reflect-metadata";
import { pathToFileURL } from "node:url";
import { createProcessorDataSource } from "@repo/processor";
import { TreasuryOwnerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import type { DataSource } from "typeorm";
import { type ApiConfig, loadApiConfig } from "./config.js";
import { qualifyTableName, resolveDatabaseSchema } from "./database-schema.js";
import {
  HttpApiServer,
  type HttpApiServerLifecycle,
  type HttpApiServerOptions,
} from "./http-api-server.js";
import { createProcessorCrudRoutes } from "./processor-crud-routes.js";
import { proposalProcessorOutputEntities } from "./processors/proposals/processor-output-entities.js";
import {
  assertProcessorReady,
  createProcessorStatusRoutes,
} from "./processor-status-routes.js";

export interface ProcessorApiRuntimeDependencies {
  config: ApiConfig;
  dataSource: DataSource;
  serverFactory?: (options: HttpApiServerOptions) => HttpApiServerLifecycle;
}

export interface ProcessorApiRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createProcessorApiRuntime({
  config,
  dataSource,
  serverFactory = (options) => new HttpApiServer(options),
}: ProcessorApiRuntimeDependencies): ProcessorApiRuntime {
  const processorCrudRoutes = createProcessorCrudRoutes({
    dataSource,
    pageLimitDefault: config.apiPageLimitDefault,
    pageLimitMax: config.apiPageLimitMax,
  });
  const processorStatusRoutes = createProcessorStatusRoutes({
    dataSource,
    databaseSchema: config.databaseSchema,
    processorName: config.processorName,
    eventTypes: config.knownEventTypes,
    heartbeatMaxAgeMs: Math.max(30_000, config.processorPollIntervalMs * 3),
  });
  const resolvedSchema = resolveDatabaseSchema(
    dataSource,
    config.databaseSchema,
  );
  const offsetsTable = qualifyTableName(resolvedSchema, "processor_offsets");
  const proposalsTable = qualifyTableName(
    resolvedSchema,
    "processor_proposals",
  );

  let dependencyClosed = false;
  const closeDependency = async (): Promise<void> => {
    if (dependencyClosed) {
      return;
    }
    dependencyClosed = true;
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  };

  const apiServer = serverFactory({
    name: "processor-api",
    port: config.processorApiPort,
    corsAllowedOrigins: config.corsAllowedOrigins,
    checkReady: async () => {
      if (!dataSource.isInitialized) {
        throw new Error("Database is not initialized");
      }
      await Promise.all([
        dataSource.query(`SELECT 1 FROM ${offsetsTable} LIMIT 1`),
        dataSource.query(`SELECT 1 FROM ${proposalsTable} LIMIT 1`),
      ]);
      await assertProcessorReady({
        dataSource,
        databaseSchema: config.databaseSchema,
        processorName: config.processorName,
        heartbeatMaxAgeMs: Math.max(30_000, config.processorPollIntervalMs * 3),
      });
    },
    registerRoutes: async (app) => {
      processorStatusRoutes(app);
      processorCrudRoutes(app);
    },
    onStop: closeDependency,
  });

  return {
    async start(): Promise<void> {
      try {
        if (!dataSource.isInitialized) {
          await dataSource.initialize();
        }
        await apiServer.start();
      } catch (error) {
        await closeDependency().catch(() => undefined);
        throw error;
      }
    },
    async stop(): Promise<void> {
      try {
        await apiServer.stop();
      } finally {
        await closeDependency();
      }
    },
  };
}

export async function main(): Promise<void> {
  const config = loadApiConfig({
    treasuryOwnerContractClass: TreasuryOwnerSmartContract,
  });
  const runtime = createProcessorApiRuntime({
    config,
    dataSource: createProcessorDataSource(
      config,
      proposalProcessorOutputEntities,
    ),
  });
  await runtime.start();
}

const entrypointPath = process.argv[1];
if (entrypointPath && import.meta.url === pathToFileURL(entrypointPath).href) {
  main().catch((error) => {
    console.error("[processor-api] startup failed", error);
    process.exit(1);
  });
}
