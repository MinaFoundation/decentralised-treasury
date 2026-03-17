import { Account } from "../../provable/account.js";
import { MerkleTreeStorage } from "../../storage/merkle-tree-storage.js";
import { AccountStorage } from "../../storage/account-storage.js";
import { BaseStakingLedger } from "./staking-ledger.js";

export class PersistentStakingLedger extends BaseStakingLedger {
  public constructor(
    public accountStorage: AccountStorage,
    merkleTreeStorage: MerkleTreeStorage,
  ) {
    super(merkleTreeStorage);
  }

  public async close(): Promise<void> {
    await this.accountStorage.close();
    await this.merkleTreeStorage.close();
  }

  public async getAllAccounts(): Promise<Account[]> {
    return await this.accountStorage.getAllAccounts();
  }

  public async accountCount(): Promise<number> {
    return await this.accountStorage.count();
  }

  public async getAccount(index: bigint): Promise<Account> {
    return (await this.accountStorage.getAccount(index)) ?? Account.empty();
  }

  public async setAccount(index: bigint, account: Account): Promise<void> {
    await this.accountStorage.setAccount(index, account);
  }
}
