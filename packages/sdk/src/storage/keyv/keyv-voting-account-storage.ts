import { VotingAccount } from "../../provable/voting-account.js";
import { VotingAccountStorage } from "../voting-account-storage.js";
import { KeyvCounter, KeyvKeyValueStorage } from "./keyv-key-value-storage.js";
import { Keyv } from "keyv";

export class KeyvVotingAccountStorage
  extends KeyvKeyValueStorage
  implements VotingAccountStorage
{
  constructor(keyv: Keyv, namespace: string, keyvCounter: KeyvCounter) {
    super(keyv, keyvCounter, `${namespace}-voting-accounts`);
  }

  async getVotingAccount(
    publicKey: string,
  ): Promise<VotingAccount | undefined> {
    const votingAccount = await this.get(publicKey);
    return votingAccount
      ? VotingAccount.fromJSON(JSON.parse(votingAccount))
      : undefined;
  }

  async setVotingAccount(
    publicKey: string,
    votingAccount: VotingAccount,
  ): Promise<void> {
    await this.set(
      publicKey,
      JSON.stringify(VotingAccount.toJSON(votingAccount)),
    );
  }

  async close(): Promise<void> {
    await super.close();
  }
}
