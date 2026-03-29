import { Field } from "o1js";
import { MerkleTreeStorage } from "../merkle-tree-storage.js";
import {
  KeyvKeyValueStorage,
  type KeyvNamespaceCounter,
} from "./keyv-key-value-storage.js";
import { Keyv } from "keyv";

export type MerkleTreeNamespaceModifier =
  | "staking-ledger"
  | "voting-ledger"
  | "nullifier-ledger"
  | "test";

export class KeyvMerkleTreeStorage
  extends KeyvKeyValueStorage
  implements MerkleTreeStorage
{
  static namespaceFrom(
    lifecycleId: string,
    modifier: MerkleTreeNamespaceModifier,
  ): string {
    return `${modifier}-${lifecycleId}-merkle-tree`;
  }

  constructor(
    keyv: Keyv,
    lifecycleId: string,
    modifier: MerkleTreeNamespaceModifier,
    counter: KeyvNamespaceCounter,
  ) {
    super(keyv, KeyvMerkleTreeStorage.namespaceFrom(lifecycleId, modifier), counter);
  }

  async getNode(level: number, index: bigint): Promise<Field | undefined> {
    const value = await this.get(`${level}-${index}`);
    return value ? Field(value) : undefined;
  }

  async setNode(level: number, index: bigint, value: Field): Promise<void> {
    await this.set(`${level}-${index}`, value.toString());
  }

  async close(): Promise<void> {
    await super.close();
  }
}
