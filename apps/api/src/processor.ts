import "reflect-metadata";
import { EventsProcessor, ProcessorCrudApiServer } from "@repo/processor";
import { TreasuryOwnerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import { loadIndexerConfig } from "./config.js";
import { ProposalCreatedEventHandler } from "./processors/proposals/proposal-created-event-handler.js";
import { ProposalEntity } from "./processors/proposals/proposal-entity.js";

async function main(): Promise<void> {
  const config = loadIndexerConfig({
    treasuryOwnerContractClass: TreasuryOwnerSmartContract,
  });
  const setup = {
    handlers: [new ProposalCreatedEventHandler()],
    outputEntitySchemas: [ProposalEntity],
  };
  const processor = EventsProcessor.fromConfig(config, setup);
  const processorApiServer = ProcessorCrudApiServer.fromConfig(
    config,
    setup.outputEntitySchemas,
  );

  await processor.start();
  try {
    await processorApiServer.start();
  } catch (error) {
    await processor.stop().catch(() => null);
    throw error;
  }
}

main().catch((error) => {
  console.error("[events-processor] startup failed", error);
  process.exit(1);
});
