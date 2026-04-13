import { Command, Option } from "commander";
import { SqliteStakingLedgerService } from "@repo/sdk/src/services/sqlite/sqlite-staking-ledger-service.js";
import { parseIntOption } from "./option-parsers.js";

export async function getRootHash({
  lifecycleId,
}: {
  lifecycleId: string;
}) {
  const service = new SqliteStakingLedgerService({ lifecycleId });
  await service.start();
  const rootHash = await service.getRootHash();
  await service.close();
  console.log(rootHash);
}

export async function hydrateAccounts({
  lifecycleId,
  stakingLedgerPath,
  startIndex,
  endIndex,
}: {
  lifecycleId: string;
  stakingLedgerPath: string;
  startIndex: number;
  endIndex: number;
}): Promise<void> {
  const service = new SqliteStakingLedgerService({ lifecycleId });
  await service.start();
  await service.hydrateAccounts({
    stakingLedgerPath,
    startIndex,
    endIndex,
  });
  await service.close();
}

export async function hydrateMerkleTree({
  lifecycleId,
  startIndex,
  endIndex,
}: {
  lifecycleId: string;
  startIndex: number;
  endIndex: number;
}): Promise<void> {
  const service = new SqliteStakingLedgerService({ lifecycleId });
  await service.start();
  await service.hydrateMerkleTree({ startIndex, endIndex });
  await service.close();
}

export async function fromFile({
  lifecycleId,
  stakingLedgerPath,
  startIndex,
  endIndex,
}: {
  lifecycleId: string;
  stakingLedgerPath: string;
  startIndex: number;
  endIndex: number;
}): Promise<void> {
  await hydrateAccounts({
    lifecycleId,
    stakingLedgerPath,
    startIndex,
    endIndex,
  });
  await hydrateMerkleTree({
    lifecycleId,
    startIndex,
    endIndex,
  });
}

export default function stakingLedgerCommandFactory(program: Command) {
  const command = program.command("staking-ledger");

  command
    .command("from-file")
    .addOption(
      new Option("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
        .env("LIFECYCLE_ID")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--staking-ledger-path <staking-ledger-path>", "Staking ledger path")
        .env("STAKING_LEDGER_PATH")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--start-index <start-index>", "Start index")
        .env("START_INDEX")
        .argParser(parseIntOption),
    )
    .addOption(
      new Option("--end-index <end-index>", "End index")
        .env("END_INDEX")
        .argParser(parseIntOption),
    )
    .action(fromFile);

  command
    .command("hydrate-account-storage")
    .addOption(
      new Option("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
        .env("LIFECYCLE_ID")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--staking-ledger-path <staking-ledger-path>", "Staking ledger path")
        .env("STAKING_LEDGER_PATH")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--start-index <start-index>", "Start index")
        .env("START_INDEX")
        .argParser(parseIntOption),
    )
    .addOption(
      new Option("--end-index <end-index>", "End index")
        .env("END_INDEX")
        .argParser(parseIntOption),
    )
    .action(hydrateAccounts);

  command
    .command("hydrate-merkle-tree")
    .addOption(
      new Option("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
        .env("LIFECYCLE_ID")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--start-index <start-index>", "Start index")
        .env("START_INDEX")
        .argParser(parseIntOption),
    )
    .addOption(
      new Option("--end-index <end-index>", "End index")
        .env("END_INDEX")
        .argParser(parseIntOption),
    )
    .action(hydrateMerkleTree);

  command
    .command("get-root-hash")
    .addOption(
      new Option("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
        .env("LIFECYCLE_ID")
        .makeOptionMandatory(),
    )
    .action(getRootHash);
}
