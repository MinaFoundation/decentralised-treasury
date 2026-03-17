import { Command } from "commander";
import { Provable } from "o1js";
import { PersistentStakingLedger } from "../ledgers/staking-ledger/persistent-staking-ledger.js";
import { createSqliteStakingLedgerStorage } from "../storage/sqlite/factory/sqlite-staking-ledger-storage.js";

export async function getRootHash({
  lifecycleId,
}: {
  lifecycleId: string;
}) {
  const stakingLedgerStorage = createSqliteStakingLedgerStorage(lifecycleId);
  const stakingLedger = new PersistentStakingLedger(
    stakingLedgerStorage.accountStorage,
    stakingLedgerStorage.merkleTreeStorage,
  );
  const rootHash = await stakingLedger.getRoot();
  await stakingLedger.close();
  Provable.log("rootHash", rootHash);
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
  const stakingLedgerStorage = createSqliteStakingLedgerStorage(lifecycleId);
  const stakingLedger = new PersistentStakingLedger(
    stakingLedgerStorage.accountStorage,
    stakingLedgerStorage.merkleTreeStorage,
  );
  let accounts = await stakingLedger.readStakingLedger(stakingLedgerPath);
  await stakingLedger.hydrateAccounts(accounts, startIndex, endIndex);
  await stakingLedger.close();
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
  const stakingLedgerStorage = createSqliteStakingLedgerStorage(lifecycleId);
  const stakingLedger = new PersistentStakingLedger(
    stakingLedgerStorage.accountStorage,
    stakingLedgerStorage.merkleTreeStorage,
  );
  const accounts = await stakingLedger.getAllAccounts();
  await stakingLedger.hydrateMerkleTree(accounts, startIndex, endIndex);
  await stakingLedger.close();
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
    .requiredOption("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
    .requiredOption(
      "--staking-ledger-path <staking-ledger-path>",
      "Staking ledger path"
    )
    .option("--start-index <start-index>", "Start index", parseInt)
    .option("--end-index <end-index>", "End index", parseInt)
    .action(fromFile);

  command
    .command("hydrate-account-storage")
    .requiredOption("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
    .requiredOption(
      "--staking-ledger-path <staking-ledger-path>",
      "Staking ledger path"
    )
    .option("--start-index <start-index>", "Start index", parseInt)
    .option("--end-index <end-index>", "End index", parseInt)
    .action(hydrateAccounts);

  command
    .command("hydrate-merkle-tree")
    .requiredOption("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
    .option("--start-index <start-index>", "Start index", parseInt)
    .option("--end-index <end-index>", "End index", parseInt)
    .action(hydrateMerkleTree);

  command
    .command("get-root-hash")
    .requiredOption("--lifecycle-id <lifecycle-id>", "Lifecycle ID")
    .action(getRootHash);
}
