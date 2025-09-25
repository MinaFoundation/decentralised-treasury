import { VotingAccount } from "../provable/staking-ledger-to-voting-ledger.js";

export class VotingAccountService {
  public getVotingAccount: (publicKey: string) => Promise<VotingAccount>;
  public setVotingAccount: (
    publicKey: string,
    votingAccount: VotingAccount
  ) => Promise<void>;
}

export class VotingAccountInMemoryService implements VotingAccountService {
  public votingAccounts: Record<string, VotingAccount | undefined> = {};

  public async getVotingAccount(publicKey: string): Promise<VotingAccount> {
    return this.votingAccounts[publicKey] ?? VotingAccount.dummy();
  }

  public async setVotingAccount(
    publicKey: string,
    votingAccount: VotingAccount
  ): Promise<void> {
    this.votingAccounts[publicKey] = votingAccount;
  }
}
