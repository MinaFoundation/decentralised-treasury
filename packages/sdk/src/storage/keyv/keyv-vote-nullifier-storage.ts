import { VoteNullifierStorage } from "../vote-nullifier-storage.js";
import { KeyvCounter, KeyvKeyValueStorage } from "./keyv-key-value-storage.js";
import { Keyv } from "keyv";

export class KeyvVoteNullifierStorage
  extends KeyvKeyValueStorage
  implements VoteNullifierStorage
{
  constructor(keyv: Keyv, namespace: string, keyvCounter: KeyvCounter) {
    super(keyv, keyvCounter, namespace);
  }

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
