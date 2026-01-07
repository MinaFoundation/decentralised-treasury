import { VotingAccount } from "../../provable/voting-account.js";
import { VotingAccountStorage } from "../voting-account-storage.js";
import { RedisKeyValueStorage } from "./redis-key-value-storage.js";

export class RedisVotingAccountStorage
  extends RedisKeyValueStorage
  implements VotingAccountStorage
{
  constructor(redisUrl: string, namespace: string) {
    super(redisUrl, namespace);
  }

  async getVotingAccount(
    publicKey: string
  ): Promise<VotingAccount | undefined> {
    const votingAccount = await this.get(publicKey);
    return votingAccount
      ? VotingAccount.fromJSON(JSON.parse(votingAccount))
      : undefined;
  }

  async setVotingAccount(
    publicKey: string,
    votingAccount: VotingAccount
  ): Promise<void> {
    await this.set(
      publicKey,
      JSON.stringify(VotingAccount.toJSON(votingAccount))
    );
  }

  async close(): Promise<void> {
    await super.close();
  }
}
