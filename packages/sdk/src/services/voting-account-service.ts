import { Capturable } from "../providers/context-provider.js";
import { VotingAccount } from "../provable/staking-ledger-to-voting-ledger.js";

export class VotingAccountService {
  public getVotingAccount: (publicKey: string) => Promise<VotingAccount>;
  public setVotingAccount: (
    publicKey: string,
    votingAccount: VotingAccount
  ) => Promise<void>;
}

export class PrefilledVotingAccountInMemoryService
  implements VotingAccountService
{
  public votingAccounts: Record<string, VotingAccount[] | undefined> = {};

  public async getVotingAccount(publicKey: string): Promise<VotingAccount> {
    const votingAccounts = this.votingAccounts[publicKey] ?? [];
    const votingAccount = votingAccounts.shift() ?? VotingAccount.dummy();
    this.votingAccounts[publicKey] = votingAccounts;
    return votingAccount ?? VotingAccount.dummy();
  }

  public async prefillVotingAccounts(
    publicKey: string,
    votingAccounts: VotingAccount[]
  ): Promise<void> {
    this.votingAccounts[publicKey] = votingAccounts;
  }

  public async setVotingAccount(
    publicKey: string,
    votingAccount: VotingAccount
  ): Promise<void> {
    console.log(
      "skipping set voting account on prefilled voting account service",
      publicKey,
      votingAccount
    );
  }
}

export class VotingAccountInMemoryService
  implements VotingAccountService, Capturable<Record<string, VotingAccount[]>>
{
  public votingAccounts: Record<string, VotingAccount | undefined> = {};
  public captured: Record<string, VotingAccount[]> = {};

  public startCapture(): void {
    this.captured = {};
  }

  public async getVotingAccount(publicKey: string): Promise<VotingAccount> {
    const votingAccount =
      this.votingAccounts[publicKey] ?? VotingAccount.dummy();
    this.captured[publicKey] ??= [];
    this.captured[publicKey].push(votingAccount);
    return votingAccount;
  }

  public async setVotingAccount(
    publicKey: string,
    votingAccount: VotingAccount
  ): Promise<void> {
    this.votingAccounts[publicKey] = votingAccount;
  }
}
