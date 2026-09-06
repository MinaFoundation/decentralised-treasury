import "reflect-metadata";
import { EventsProcessor } from "@repo/processor";
import { TreasuryOwnerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import { pathToFileURL } from "node:url";
import { type ApiConfig, loadApiConfig } from "./config.js";
import { ProposalCreatedEventHandler } from "./processors/proposals/proposal-created-event-handler.js";
import { ProposalPauseToggledEventHandler } from "./processors/proposals/proposal-pause-toggled-event-handler.js";
import { ProposalExecutedEventHandler } from "./processors/proposals/proposal-executed-event-handler.js";
import { ProposalProjectionReconciler } from "./processors/proposals/proposal-projection-reconciler.js";
import { rewindProposalProjectionReplay } from "./processors/proposals/proposal-projection-replay-entity.js";
import type { LifecycleVotingLedgerServiceRegistry } from "./processors/proposals/lifecycle-voting-ledger-service-registry.js";
import { ProposalVoteDispatchedEventHandler } from "./processors/proposals/proposal-vote-dispatched-event-handler.js";
import { ProposalVotesTalliedEventHandler } from "./processors/proposals/proposal-votes-tallied-event-handler.js";
import { proposalProcessorOutputEntities } from "./processors/proposals/processor-output-entities.js";
import { LifecycleStakingLedgerServiceRegistry } from "./staking-ledger/lifecycle-staking-ledger-service-registry.js";

interface ProcessorWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
  retryBlockedEvent(): Promise<number>;
}

export interface ProcessorWorkerRuntimeDependencies {
  config: ApiConfig;
  stakingLedgerServices?: LifecycleStakingLedgerServiceRegistry;
  votingLedgerServices?: LifecycleVotingLedgerServiceRegistry;
  proposalProjectionReconciler?: ProposalProjectionReconciler;
  processorFactory?: (
    config: Parameters<typeof EventsProcessor.fromConfig>[0],
    setup: Parameters<typeof EventsProcessor.fromConfig>[1],
  ) => ProcessorWorker;
}

export interface ProcessorWorkerRuntime {
  start(): Promise<void>;
  retryBlockedEvent(): Promise<number>;
  stop(): Promise<void>;
}

export function createProcessorWorkerRuntime({
  config,
  stakingLedgerServices = new LifecycleStakingLedgerServiceRegistry(),
  votingLedgerServices,
  proposalProjectionReconciler = new ProposalProjectionReconciler(),
  processorFactory = (processorConfig, setup) =>
    EventsProcessor.fromConfig(processorConfig, setup),
}: ProcessorWorkerRuntimeDependencies): ProcessorWorkerRuntime {
  const setup = {
    handlers: [
      new ProposalCreatedEventHandler(
        {
          stakingLedgerServices,
          treasuryOwnerPublicKey: config.treasuryOwnerContractAddress,
        },
        proposalProjectionReconciler,
      ),
      new ProposalPauseToggledEventHandler(proposalProjectionReconciler),
      new ProposalVoteDispatchedEventHandler(
        undefined,
        undefined,
        {
          stakingLedgerServices,
          treasuryOwnerPublicKey: config.treasuryOwnerContractAddress,
        },
        proposalProjectionReconciler,
      ),
      new ProposalVotesTalliedEventHandler(proposalProjectionReconciler),
      new ProposalExecutedEventHandler(proposalProjectionReconciler),
    ],
    outputEntitySchemas: proposalProcessorOutputEntities,
    beforeProcessing: async ({ manager, processorName }) => {
      await rewindProposalProjectionReplay(manager, processorName);
    },
  };
  const processor = processorFactory(
    {
      databaseUrl: config.databaseUrl,
      databaseSchema: config.databaseSchema,
      processorName: config.processorName,
      processorPollIntervalMs: config.processorPollIntervalMs,
      processorBatchSize: config.processorBatchSize,
      indexerApiUrl: config.indexerApiUrl,
    },
    setup,
  );

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = async (): Promise<void> => {
    if (shutdownPromise) {
      return await shutdownPromise;
    }
    shutdownPromise = (async () => {
      const shutdownTasks = [processor.stop(), stakingLedgerServices.close()];
      if (votingLedgerServices) {
        // Retained only for callers that explicitly inject this legacy test dependency.
        shutdownTasks.push(votingLedgerServices.close());
      }
      await Promise.allSettled(shutdownTasks);
    })();
    await shutdownPromise;
  };

  return {
    async start(): Promise<void> {
      try {
        await processor.start();
      } catch (error) {
        await shutdown();
        throw error;
      }
    },
    retryBlockedEvent: () => processor.retryBlockedEvent(),
    stop: shutdown,
  };
}

type ShutdownSignal = "SIGINT" | "SIGTERM";

export interface ProcessorWorkerMainDependencies {
  loadConfig?: () => ApiConfig;
  createRuntime?: (
    dependencies: ProcessorWorkerRuntimeDependencies,
  ) => ProcessorWorkerRuntime;
  registerSignal?: (signal: ShutdownSignal, listener: () => void) => void;
  exit?: (code: number) => void;
  log?: (message: string) => void;
}

export async function main(
  args = process.argv.slice(2),
  {
    loadConfig = () =>
      loadApiConfig({
        treasuryOwnerContractClass: TreasuryOwnerSmartContract,
      }),
    createRuntime = createProcessorWorkerRuntime,
    registerSignal = (signal, listener) => process.once(signal, listener),
    exit = (code) => process.exit(code),
    log = console.log,
  }: ProcessorWorkerMainDependencies = {},
): Promise<void> {
  const retryBlocked = args.length === 1 && args[0] === "--retry-blocked";
  if (args.length > 0 && !retryBlocked) {
    throw new Error(`Unknown processor arguments: ${args.join(" ")}`);
  }

  const config = loadConfig();
  const runtime = createRuntime({ config });

  if (retryBlocked) {
    try {
      const processedRows = await runtime.retryBlockedEvent();
      if (processedRows < 1) {
        throw new Error(
          "No blocked processor event was resolved. Inspect processor_event_failures and processor_runtime_status.",
        );
      }
      log(
        `[events-processor] explicit retry succeeded (processedRows=${processedRows})`,
      );
    } finally {
      await runtime.stop();
    }
    return;
  }
  registerSignal("SIGINT", () => {
    log("[events-processor] received SIGINT, shutting down");
    void runtime.stop().finally(() => exit(0));
  });
  registerSignal("SIGTERM", () => {
    log("[events-processor] received SIGTERM, shutting down");
    void runtime.stop().finally(() => exit(0));
  });

  await runtime.start();
}

const entrypointPath = process.argv[1];
if (entrypointPath && import.meta.url === pathToFileURL(entrypointPath).href) {
  main().catch((error) => {
    console.error("[events-processor] startup failed", error);
    process.exit(1);
  });
}
