import "reflect-metadata";
import { pathToFileURL } from "node:url";
import { createIndexerDataSource } from "@repo/indexer";
import { TreasuryOwnerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import type { DataSource } from "typeorm";
import { type ApiConfig, loadApiConfig } from "./config.js";
import { qualifyTableName, resolveDatabaseSchema } from "./database-schema.js";
import {
  HttpApiServer,
  type HttpApiServerLifecycle,
  type HttpApiServerOptions,
} from "./http-api-server.js";
import { LifecycleVotingLedgerServiceRegistry } from "./processors/proposals/lifecycle-voting-ledger-service-registry.js";
import { createProposalContentRoutes } from "./proposal-content-routes.js";
import { createProposalListRoutes } from "./proposal-list-routes.js";
import { createProposalSearchRoutes } from "./proposal-search-routes.js";
import { assertProcessorReady } from "./processor-status-routes.js";
import { LifecycleStakingLedgerServiceRegistry } from "./staking-ledger/lifecycle-staking-ledger-service-registry.js";
import { createStakingLedgerWitnessRoutes } from "./staking-ledger/staking-ledger-witness-routes.js";
import { createVotingLedgerAccountRoutes } from "./voting-ledger/voting-ledger-account-routes.js";

export interface AppApiRuntimeDependencies {
  config: ApiConfig;
  dataSource: DataSource;
  stakingLedgerServices: LifecycleStakingLedgerServiceRegistry;
  votingLedgerServices: LifecycleVotingLedgerServiceRegistry;
  serverFactory?: (options: HttpApiServerOptions) => HttpApiServerLifecycle;
}

export interface AppApiRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createAppApiRuntime({
  config,
  dataSource,
  stakingLedgerServices,
  votingLedgerServices,
  serverFactory = (options) => new HttpApiServer(options),
}: AppApiRuntimeDependencies): AppApiRuntime {
  const stakingLedgerRoutes = createStakingLedgerWitnessRoutes({
    stakingLedgerServices,
  });
  const proposalContentRoutes = createProposalContentRoutes({
    dataSource,
    databaseSchema: config.databaseSchema,
    maxProposalContentsChars: config.proposalContentMaxChars,
  });
  const proposalSearchRoutes = createProposalSearchRoutes({
    dataSource,
    databaseSchema: config.databaseSchema,
    pageLimitDefault: config.apiPageLimitDefault,
    pageLimitMax: config.apiPageLimitMax,
  });
  const proposalListRoutes = createProposalListRoutes({
    dataSource,
    databaseSchema: config.databaseSchema,
    pageLimitDefault: config.apiPageLimitDefault,
    pageLimitMax: config.apiPageLimitMax,
  });
  const votingLedgerAccountRoutes = createVotingLedgerAccountRoutes({
    votingLedgerServices,
  });
  const proposalsTable = qualifyTableName(
    resolveDatabaseSchema(dataSource, config.databaseSchema),
    "processor_proposals",
  );

  let dependenciesClosed = false;
  const closeDependencies = async (): Promise<void> => {
    if (dependenciesClosed) {
      return;
    }
    dependenciesClosed = true;
    await Promise.allSettled([
      dataSource.isInitialized ? dataSource.destroy() : Promise.resolve(),
      stakingLedgerServices.close(),
      votingLedgerServices.close(),
    ]);
  };

  const apiServer = serverFactory({
    name: "app-api",
    port: config.apiPort,
    corsAllowedOrigins: config.corsAllowedOrigins,
    checkReady: async () => {
      if (!dataSource.isInitialized) {
        throw new Error("Database is not initialized");
      }
      await dataSource.query(`SELECT 1 FROM ${proposalsTable} LIMIT 1`);
      await assertProcessorReady({
        dataSource,
        databaseSchema: config.databaseSchema,
        processorName: config.processorName,
        heartbeatMaxAgeMs: Math.max(30_000, config.processorPollIntervalMs * 3),
      });
    },
    registerRoutes: async (app) => {
      stakingLedgerRoutes(app);
      votingLedgerAccountRoutes(app);
      proposalContentRoutes(app);
      proposalSearchRoutes(app);
      proposalListRoutes(app);
    },
    onStop: closeDependencies,
  });

  return {
    async start(): Promise<void> {
      try {
        if (!dataSource.isInitialized) {
          await dataSource.initialize();
        }
        await apiServer.start();
      } catch (error) {
        await closeDependencies();
        throw error;
      }
    },
    async stop(): Promise<void> {
      try {
        await apiServer.stop();
      } finally {
        await closeDependencies();
      }
    },
  };
}

export async function main(): Promise<void> {
  const config = loadApiConfig({
    treasuryOwnerContractClass: TreasuryOwnerSmartContract,
  });
  const runtime = createAppApiRuntime({
    config,
    dataSource: createIndexerDataSource(config),
    stakingLedgerServices: new LifecycleStakingLedgerServiceRegistry(),
    votingLedgerServices: new LifecycleVotingLedgerServiceRegistry(),
  });
  await runtime.start();
}

const entrypointPath = process.argv[1];
if (entrypointPath && import.meta.url === pathToFileURL(entrypointPath).href) {
  main().catch((error) => {
    console.error("[app-api] startup failed", error);
    process.exit(1);
  });
}
