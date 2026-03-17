import { VoteNullifierStorage } from "../vote-nullifier-storage.js";
import { KeyValueEntry } from "../key-value-storage.js";
import { BatchStorage } from "../batch-storage.js";

export class InMemoryVoteNullifierStorage
  implements VoteNullifierStorage, BatchStorage
{
  private readonly nullifiers = new Map<string, boolean>();

  public constructor(private readonly parentStorage: VoteNullifierStorage) {}

  public get namespace(): string {
    return this.parentStorage.namespace;
  }

  public async getNullifier(publicKey: string): Promise<boolean | undefined> {
    const nullifier = this.nullifiers.get(publicKey);
    if (nullifier !== undefined) {
      return nullifier;
    }

    const parentNullifier = await this.parentStorage.getNullifier(publicKey);
    if (parentNullifier !== undefined) {
      this.nullifiers.set(publicKey, parentNullifier);
    }

    return parentNullifier;
  }

  public async setNullifier(
    publicKey: string,
    nullifier: boolean,
  ): Promise<void> {
    this.nullifiers.set(publicKey, nullifier);
  }

  public collectEntries(): KeyValueEntry[] {
    return Array.from(this.nullifiers, ([publicKey, nullifier]) => ({
      key: `${this.parentStorage.namespace}:${publicKey}`,
      value: JSON.stringify(nullifier),
    }));
  }

  public clearEntries(): void {
    this.nullifiers.clear();
  }

  public async close(): Promise<void> {
    this.nullifiers.clear();
    await this.parentStorage.close();
  }
}
