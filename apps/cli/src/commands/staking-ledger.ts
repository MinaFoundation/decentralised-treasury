import { Command, Option } from "commander";
import { LedgerHashBase58 } from "o1js";
import { SqliteStakingLedgerService } from "@repo/sdk/src/services/sqlite/sqlite-staking-ledger-service.js";
import { createDevelopmentStakingLedger } from "../lib/development-staking-ledger.js";
import { parseIntOption } from "./option-parsers.js";

export async function getRootHash({
  lifecycleId,
  expectedRootHash,
  outputFormat = "base58",
}: {
  lifecycleId: string;
  expectedRootHash?: string;
  outputFormat?: "base58" | "json";
}) {
  const service = new SqliteStakingLedgerService({ lifecycleId });
  await service.start();
  const rootHash = await service.getRootHash();
  await service.close();

  const rootHashBase58 = LedgerHashBase58.toBase58(rootHash);
  if (outputFormat === "json") {
    console.log(
      JSON.stringify(
        {
          ledgerHashBase58: rootHashBase58,
          stakingEpochDataLedgerHash: rootHash.toString(),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(rootHashBase58);
  }

  if (expectedRootHash === undefined) {
    return;
  }

  // Compared as Fields rather than as strings: the caller's value comes from
  // the chain (or an operator override), and a base58 string comparison would
  // also fail on an equal hash written in a different encoding.
  if (
    !rootHash.equals(LedgerHashBase58.fromBase58(expectedRootHash)).toBoolean()
  ) {
    throw new Error(
      `Staking ledger for lifecycle ${lifecycleId} roots to ${rootHashBase58}, but ${expectedRootHash} was expected. ` +
        `Hydrating a lifecycle from the wrong staking ledger makes every proposal in it unprovable, so this is refused.`,
    );
  }
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
    .command("create-development-snapshot")
    .description(
      "Create a simulator staking snapshot for one Treasury Owner and five voters",
    )
    .addOption(
      new Option("--output-path <output-path>", "Snapshot JSON output path")
        .env("STAKING_LEDGER_PATH")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--treasury-owner-public-key <public-key>",
        "Treasury Owner public key",
      )
        .env("TREASURY_OWNER_PUBLIC_KEY")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--voter-1-public-key <public-key>", "First voter public key")
        .env("VOTER1_PUBLIC_KEY")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--voter-2-public-key <public-key>", "Second voter public key")
        .env("VOTER2_PUBLIC_KEY")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--voter-3-public-key <public-key>", "Third voter public key")
        .env("VOTER3_PUBLIC_KEY")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--voter-4-public-key <public-key>", "Fourth voter public key")
        .env("VOTER4_PUBLIC_KEY")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--voter-5-public-key <public-key>", "Fifth voter public key")
        .env("VOTER5_PUBLIC_KEY")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--treasury-owner-balance <mina>",
        "Historical Treasury Owner balance in MINA (minimum 100)",
      )
        .env("DEVELOPMENT_TREASURY_OWNER_BALANCE")
        .default("1000"),
    )
    .addOption(
      new Option(
        "--voter-balance <mina>",
        "Self-delegated balance for each voter in MINA (minimum 100)",
      )
        .env("DEVELOPMENT_VOTER_BALANCE")
        .default("100"),
    )
    .action(async (options) => {
      const result = await createDevelopmentStakingLedger(options);
      console.log(JSON.stringify(result, null, 2));
    });

  command
    .command("from-file")
    .addOption(
      new Option("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
        .env("LIFECYCLE_ID")
        .makeOptionMandatory(),
    )
    .addOption(
      new Option(
        "--staking-ledger-path <staking-ledger-path>",
        "Staking ledger path",
      )
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
      new Option(
        "--staking-ledger-path <staking-ledger-path>",
        "Staking ledger path",
      )
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
    .addOption(
      new Option(
        "--expected-root-hash <expected-root-hash>",
        "Fail unless the hydrated ledger roots to this hash",
      ).env("EXPECTED_ROOT_HASH"),
    )
    .addOption(
      new Option("--output-format <format>", "Root output format")
        .choices(["base58", "json"])
        .env("ROOT_HASH_OUTPUT_FORMAT")
        .default("base58"),
    )
    .action(getRootHash);
}
