import "reflect-metadata";
import { EventsProcessor } from "@repo/processor";
import { TreasuryOwnerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import { loadApiConfig } from "./config.js";
import { ProposalCreatedEventHandler } from "./processors/proposals/proposal-created-event-handler.js";
import { ProposalPauseToggledEventHandler } from "./processors/proposals/proposal-pause-toggled-event-handler.js";
import { ProposalExecutedEventHandler } from "./processors/proposals/proposal-executed-event-handler.js";
import { LifecycleVotingLedgerServiceRegistry } from "./processors/proposals/lifecycle-voting-ledger-service-registry.js";
import { ProposalVoteDispatchedEventHandler } from "./processors/proposals/proposal-vote-dispatched-event-handler.js";
import { ProposalVotesTalliedEventHandler } from "./processors/proposals/proposal-votes-tallied-event-handler.js";
import { proposalProcessorOutputEntities } from "./processors/proposals/processor-output-entities.js";
import { LifecycleStakingLedgerServiceRegistry } from "./staking-ledger/lifecycle-staking-ledger-service-registry.js";

async function main(): Promise<void> {
  const config = loadApiConfig({
    treasuryOwnerContractClass: TreasuryOwnerSmartContract,
  });
  const stakingLedgerServices = new LifecycleStakingLedgerServiceRegistry();
  const votingLedgerServices = new LifecycleVotingLedgerServiceRegistry();
  const setup = {
    handlers: [
      new ProposalCreatedEventHandler({
        stakingLedgerServices,
        treasuryOwnerPublicKey: config.treasuryOwnerContractAddress,
      }),
      new ProposalPauseToggledEventHandler(),
      new ProposalVoteDispatchedEventHandler(votingLedgerServices, undefined, {
        stakingLedgerServices,
        treasuryOwnerPublicKey: config.treasuryOwnerContractAddress,
      }),
      new ProposalVotesTalliedEventHandler(),
      new ProposalExecutedEventHandler(),
    ],
    outputEntitySchemas: proposalProcessorOutputEntities,
  };
  const processor = EventsProcessor.fromConfig(
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
      await Promise.allSettled([
        processor.stop(),
        stakingLedgerServices.close(),
        votingLedgerServices.close(),
      ]);
    })();
    await shutdownPromise;
  };

  process.once("SIGINT", () => {
    console.log("[events-processor] received SIGINT, shutting down");
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    console.log("[events-processor] received SIGTERM, shutting down");
    void shutdown().finally(() => process.exit(0));
  });

  try {
    await processor.start();
  } catch (error) {
    await shutdown();
    throw error;
  }
}

main().catch((error) => {
  console.error("[events-processor] startup failed", error);
  process.exit(1);
});
