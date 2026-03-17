import { Command } from "commander";
import { Provable } from "o1js";
import { KeyvSqlite } from "@keyv/sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PersistentStakingLedger } from "../ledgers/staking-ledger/persistent-staking-ledger.js";
import { createSqliteStakingLedgerStorage } from "../storage/sqlite/factory/sqlite-staking-ledger-storage.js";
import { getSqliteDbPath } from "../storage/sqlite/sqlite-db-path.js";

function createSqliteStoreForLifecycle(lifecycleId: string): KeyvSqlite {
  const path = getSqliteDbPath(lifecycleId);
  mkdirSync(dirname(path), { recursive: true });
  const store = new KeyvSqlite({ uri: path });
  const disconnect = store.disconnect.bind(store);
  store.disconnect = async () => {
    try {
      await disconnect();
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "SQLITE_MISUSE"
      ) {
        return;
      }
      throw error;
    }
  };
  return store;
}

export async function getRootHash({
  lifecycleId,
}: {
  lifecycleId: string;
}) {
  const sqliteStore = createSqliteStoreForLifecycle(lifecycleId);
  const stakingLedgerStorage = createSqliteStakingLedgerStorage(
    lifecycleId,
    sqliteStore,
  );
  const stakingLedger = new PersistentStakingLedger(
    stakingLedgerStorage.accountStorage,
    stakingLedgerStorage.merkleTreeStorage,
  );
  const rootHash = await stakingLedger.getRoot();
  await stakingLedger.close();
  await sqliteStore.disconnect();
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
  const sqliteStore = createSqliteStoreForLifecycle(lifecycleId);
  const stakingLedgerStorage = createSqliteStakingLedgerStorage(
    lifecycleId,
    sqliteStore,
  );
  const stakingLedger = new PersistentStakingLedger(
    stakingLedgerStorage.accountStorage,
    stakingLedgerStorage.merkleTreeStorage,
  );
  let accounts = await stakingLedger.readStakingLedger(stakingLedgerPath);
  await stakingLedger.hydrateAccounts(accounts, startIndex, endIndex);
  await stakingLedger.close();
  await sqliteStore.disconnect();
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
  const sqliteStore = createSqliteStoreForLifecycle(lifecycleId);
  const stakingLedgerStorage = createSqliteStakingLedgerStorage(
    lifecycleId,
    sqliteStore,
  );
  const stakingLedger = new PersistentStakingLedger(
    stakingLedgerStorage.accountStorage,
    stakingLedgerStorage.merkleTreeStorage,
  );
  const accounts = await stakingLedger.getAllAccounts();
  await stakingLedger.hydrateMerkleTree(accounts, startIndex, endIndex);
  await stakingLedger.close();
  await sqliteStore.disconnect();
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
