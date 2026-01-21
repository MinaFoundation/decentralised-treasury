import { VoteNullifierStorage } from "../vote-nullifier-storage.js";
import { RedisKeyValueStorage } from "./redis-key-value-storage.js";

export class RedisVoteNullifierStorage
  extends RedisKeyValueStorage
  implements VoteNullifierStorage
{
  async getNullifier(publicKey: string): Promise<boolean | undefined> {
    const storedNullifier = await this.get(publicKey);
    return storedNullifier ? JSON.parse(storedNullifier) : undefined;
  }

  async setNullifier(publicKey: string, nullifier: boolean): Promise<void> {
    await this.set(publicKey, JSON.stringify(nullifier));
  }

  async close(): Promise<void> {
    await super.close();
  }
}
