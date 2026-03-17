import { MerkleTreeStorage } from "../../storage/merkle-tree-storage.js";
import { VotingAccountStorage } from "../../storage/voting-account-storage.js";
import { VotingAccount } from "../../provable/voting-account.js";
import {
  BaseVotingLedger,
} from "./voting-ledger.js";

export class PersistentVotingLedger extends BaseVotingLedger {
  public constructor(
    public votingAccountStorage: VotingAccountStorage,
    merkleTreeStorage: MerkleTreeStorage,
  ) {
    super(merkleTreeStorage);
  }

  public async getVotingAccount(publicKey: string): Promise<VotingAccount> {
    return (
      (await this.votingAccountStorage.getVotingAccount(publicKey)) ??
      VotingAccount.empty()
    );
  }

  public async setVotingAccount(
    publicKey: string,
    votingAccount: VotingAccount,
  ): Promise<void> {
    await this.votingAccountStorage.setVotingAccount(publicKey, votingAccount);
  }

  public async close(): Promise<void> {
    await this.votingAccountStorage.close();
    await this.merkleTreeStorage.close();
  }
}
