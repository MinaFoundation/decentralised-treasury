import { KeyvSqlite } from "@keyv/sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Field } from "o1js";
import { PersistentStakingLedger } from "../../ledgers/staking-ledger/persistent-staking-ledger.js";
import { createSqliteStakingLedgerStorage } from "../../storage/sqlite/factory/sqlite-staking-ledger-storage.js";
import type { Account } from "../../provable/account.js";
import type { PrefixedMerkleWitness36 } from "../../provable/merkle-tree/prefixed-merkle-tree.js";
import {
  getSqliteDbPath,
  getSqliteInMemoryDbPath,
} from "../../storage/sqlite/sqlite-db-path.js";
import { applyFastSqlitePragmas } from "../../storage/sqlite/sqlite-fast-pragmas.js";
import {
  type HydrateAccountsOptions,
  type HydrateMerkleTreeOptions,
  type StakingLedgerService,
} from "../staking-ledger-service.js";

export interface SqliteStakingLedgerServiceOptions {
  lifecycleId: string;
  inMemory?: boolean;
  dbPath?: string;
}

export class SqliteStakingLedgerService implements StakingLedgerService {
  private readonly sqliteStore: KeyvSqlite;
  private stakingLedger?: PersistentStakingLedger;

  public constructor(
    private readonly options: SqliteStakingLedgerServiceOptions,
  ) {
    const dbPath =
      options.dbPath ??
      (options.inMemory
        ? getSqliteInMemoryDbPath(options.lifecycleId)
        : getSqliteDbPath(options.lifecycleId));

    if (!options.inMemory) {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this.sqliteStore = new KeyvSqlite({ uri: dbPath });
    const disconnect = this.sqliteStore.disconnect.bind(this.sqliteStore);
    this.sqliteStore.disconnect = async () => {
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
  }

  public async hydrateAccounts({
    stakingLedgerPath,
    startIndex = 0,
    endIndex,
  }: HydrateAccountsOptions): Promise<void> {
    const stakingLedger = this.getStartedLedger();
    const accounts = await stakingLedger.readStakingLedger(stakingLedgerPath);
    await stakingLedger.hydrateAccounts(accounts, startIndex, endIndex);
  }

  public async hydrateMerkleTree({
    startIndex = 0,
    endIndex,
  }: HydrateMerkleTreeOptions = {}): Promise<void> {
    const stakingLedger = this.getStartedLedger();
    const accounts = await stakingLedger.getAllAccounts();
    await stakingLedger.hydrateMerkleTree(accounts, startIndex, endIndex);
  }

  public async getAllAccounts(): Promise<Account[]> {
    const stakingLedger = this.getStartedLedger();
    return await stakingLedger.getAllAccounts();
  }

  public async getAccount(index: bigint): Promise<Account> {
    const stakingLedger = this.getStartedLedger();
    return await stakingLedger.getAccount(index);
  }

  public async getAccountByPublicKey(
    publicKey: string,
  ): Promise<{ index: bigint; account: Account } | null> {
    const stakingLedger = this.getStartedLedger();
    return await stakingLedger.getAccountByPublicKey(publicKey);
  }

  public async getWitness(index: bigint): Promise<PrefixedMerkleWitness36> {
    const stakingLedger = this.getStartedLedger();
    return await stakingLedger.getWitness(index);
  }

  public async getRootHash(): Promise<Field> {
    const stakingLedger = this.getStartedLedger();
    return await stakingLedger.getRoot();
  }

  public async start(): Promise<void> {
    await applyFastSqlitePragmas(this.sqliteStore);
    const stakingLedgerStorage = createSqliteStakingLedgerStorage(
      this.options.lifecycleId,
      this.sqliteStore,
    );
    this.stakingLedger = new PersistentStakingLedger(
      stakingLedgerStorage.accountStorage,
      stakingLedgerStorage.merkleTreeStorage,
    );
  }

  public async close(): Promise<void> {
    if (this.stakingLedger) {
      await this.stakingLedger.close();
      this.stakingLedger = undefined;
    }
    await this.sqliteStore.disconnect();
  }

  private getStartedLedger(): PersistentStakingLedger {
    if (!this.stakingLedger) {
      throw new Error(
        "SqliteStakingLedgerService.start() must be called before using ledger methods",
      );
    }
    return this.stakingLedger;
  }
}
