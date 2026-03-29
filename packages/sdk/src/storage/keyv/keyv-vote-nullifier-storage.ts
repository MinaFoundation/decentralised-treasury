import { VoteNullifierStorage } from "../vote-nullifier-storage.js";
import {
  KeyvKeyValueStorage,
  type KeyvNamespaceCounter,
} from "./keyv-key-value-storage.js";
import { Keyv } from "keyv";

export class KeyvVoteNullifierStorage
  extends KeyvKeyValueStorage
  implements VoteNullifierStorage
{
  static namespaceFrom(lifecycleId: string): string {
    return `nullifier-ledger-${lifecycleId}-nullifiers`;
  }

  constructor(keyv: Keyv, lifecycleId: string, counter: KeyvNamespaceCounter) {
    super(keyv, KeyvVoteNullifierStorage.namespaceFrom(lifecycleId), counter);
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
