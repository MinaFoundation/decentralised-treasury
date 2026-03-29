import { VotingAccount } from "../../provable/voting-account.js";
import { BatchStorage } from "../batch-storage.js";
import { KeyValueEntry } from "../key-value-storage.js";
import { VotingAccountStorage } from "../voting-account-storage.js";

export class InMemoryVotingAccountStorage
  implements VotingAccountStorage, BatchStorage
{
  private readonly accounts = new Map<string, VotingAccount>();

  public constructor(private readonly parentStorage: VotingAccountStorage) {}

  public get namespace(): string {
    return this.parentStorage.namespace;
  }

  public async getVotingAccount(
    publicKey: string,
  ): Promise<VotingAccount | undefined> {
    const votingAccount = this.accounts.get(publicKey);
    if (votingAccount) {
      return votingAccount;
    }

    const parentVotingAccount =
      await this.parentStorage.getVotingAccount(publicKey);
    if (parentVotingAccount) {
      this.accounts.set(publicKey, parentVotingAccount);
    }

    return parentVotingAccount;
  }

  public async setVotingAccount(
    publicKey: string,
    votingAccount: VotingAccount,
  ): Promise<void> {
    this.accounts.set(publicKey, votingAccount);
  }

  public async clear(): Promise<void> {
    this.accounts.clear();
  }

  public collectEntries(): KeyValueEntry[] {
    return Array.from(this.accounts, ([publicKey, votingAccount]) => ({
      key: `${this.parentStorage.namespace}:${publicKey}`,
      value: JSON.stringify(VotingAccount.toJSON(votingAccount)),
    }));
  }

  public clearEntries(): void {
    this.accounts.clear();
  }

  public async close(): Promise<void> {
    this.accounts.clear();
    await this.parentStorage.close();
  }
}
