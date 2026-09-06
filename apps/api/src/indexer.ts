import "reflect-metadata";
import {
  createIndexerDataSource,
  EventsIndexer,
  EventsRepository,
} from "@repo/indexer";
import { TreasuryOwnerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import { pathToFileURL } from "node:url";
import { type ApiConfig, loadApiConfig } from "./config.js";

interface IndexerWorker {
  start(): Promise<void>;
}

interface RejectionRepository {
  initialize(): Promise<void>;
  resolveRejection(rejectionId: string): Promise<boolean>;
  close(): Promise<void>;
}

export interface IndexerWorkerRuntimeDependencies {
  config: ApiConfig;
  indexerFactory?: (config: ApiConfig) => IndexerWorker;
  rejectionRepositoryFactory?: (config: ApiConfig) => RejectionRepository;
  log?: (message: string) => void;
}

export interface IndexerWorkerRuntime {
  run(args: string[]): Promise<void>;
}

export function createIndexerWorkerRuntime({
  config,
  indexerFactory = (runtimeConfig) => EventsIndexer.fromConfig(runtimeConfig),
  rejectionRepositoryFactory = (runtimeConfig) =>
    new EventsRepository(
      createIndexerDataSource(runtimeConfig),
      runtimeConfig.databaseSchema,
      { knownEventTypes: runtimeConfig.knownEventTypes },
    ),
  log = console.log,
}: IndexerWorkerRuntimeDependencies): IndexerWorkerRuntime {
  return {
    async run(args: string[]): Promise<void> {
      if (args[0] === "--resolve-rejection") {
        const rejectionId = args[1];
        if (args.length !== 2 || rejectionId === undefined) {
          throw new Error(
            "Usage: indexer:resolve-rejection -- <archive-event-rejection-id>",
          );
        }
        const repository = rejectionRepositoryFactory(config);
        try {
          await repository.initialize();
          const resolved = await repository.resolveRejection(rejectionId);
          if (!resolved) {
            throw new Error(
              `Unresolved rejection ${rejectionId} was not found`,
            );
          }
          log(`[events-indexer] resolved rejection id=${rejectionId}`);
        } finally {
          await repository.close();
        }
        return;
      }
      if (args.length > 0) {
        throw new Error(`Unknown indexer argument: ${args[0]}`);
      }

      const indexer = indexerFactory(config);
      await indexer.start();
    },
  };
}

export interface IndexerWorkerMainDependencies {
  loadConfig?: () => ApiConfig;
  createRuntime?: (
    dependencies: IndexerWorkerRuntimeDependencies,
  ) => IndexerWorkerRuntime;
}

export async function main(
  args = process.argv.slice(2),
  {
    loadConfig = () =>
      loadApiConfig({
        treasuryOwnerContractClass: TreasuryOwnerSmartContract,
      }),
    createRuntime = createIndexerWorkerRuntime,
  }: IndexerWorkerMainDependencies = {},
): Promise<void> {
  const config = loadConfig();
  const runtime = createRuntime({ config });
  await runtime.run(args);
}

const entrypointPath = process.argv[1];
if (entrypointPath && import.meta.url === pathToFileURL(entrypointPath).href) {
  main().catch((error) => {
    console.error("[events-indexer] startup failed", error);
    process.exit(1);
  });
}
