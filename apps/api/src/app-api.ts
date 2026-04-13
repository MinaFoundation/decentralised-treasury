import "reflect-metadata";
import { createIndexerDataSource } from "@repo/indexer";
import { TreasuryOwnerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import { loadApiConfig } from "./config.js";
import { HttpApiServer } from "./http-api-server.js";
import { LifecycleVotingLedgerServiceRegistry } from "./processors/proposals/lifecycle-voting-ledger-service-registry.js";
import { createProposalContentRoutes } from "./proposal-content-routes.js";
import { createProposalListRoutes } from "./proposal-list-routes.js";
import { createProposalSearchRoutes } from "./proposal-search-routes.js";
import { LifecycleStakingLedgerServiceRegistry } from "./staking-ledger/lifecycle-staking-ledger-service-registry.js";
import { createStakingLedgerWitnessRoutes } from "./staking-ledger/staking-ledger-witness-routes.js";
import { createVotingLedgerAccountRoutes } from "./voting-ledger/voting-ledger-account-routes.js";

async function main(): Promise<void> {
  const config = loadApiConfig({
    treasuryOwnerContractClass: TreasuryOwnerSmartContract,
  });
  const dataSource = createIndexerDataSource(config);
  const stakingLedgerServices = new LifecycleStakingLedgerServiceRegistry();
  const votingLedgerServices = new LifecycleVotingLedgerServiceRegistry();

  await dataSource.initialize();

  const stakingLedgerRoutes = createStakingLedgerWitnessRoutes({
    stakingLedgerServices,
  });
  const proposalContentRoutes = createProposalContentRoutes({
    dataSource,
    maxProposalContentsChars: config.proposalContentMaxChars,
  });
  const proposalSearchRoutes = createProposalSearchRoutes({
    dataSource,
    pageLimitDefault: config.apiPageLimitDefault,
    pageLimitMax: config.apiPageLimitMax,
  });
  const proposalListRoutes = createProposalListRoutes({
    dataSource,
    pageLimitDefault: config.apiPageLimitDefault,
    pageLimitMax: config.apiPageLimitMax,
  });
  const votingLedgerAccountRoutes = createVotingLedgerAccountRoutes({
    votingLedgerServices,
  });

  const apiServer = new HttpApiServer({
    name: "app-api",
    port: config.apiPort,
    registerRoutes: async (app) => {
      stakingLedgerRoutes(app);
      votingLedgerAccountRoutes(app);
      proposalContentRoutes(app);
      proposalListRoutes(app);
      proposalSearchRoutes(app);
    },
    onStop: async () => {
      await Promise.all([
        dataSource.destroy().catch(() => null),
        stakingLedgerServices.close().catch(() => null),
        votingLedgerServices.close().catch(() => null),
      ]);
    },
  });

  try {
    await apiServer.start();
  } catch (error) {
    await Promise.all([
      dataSource.destroy().catch(() => null),
      stakingLedgerServices.close().catch(() => null),
      votingLedgerServices.close().catch(() => null),
    ]);
    throw error;
  }
}

main().catch((error) => {
  console.error("[app-api] startup failed", error);
  process.exit(1);
});
