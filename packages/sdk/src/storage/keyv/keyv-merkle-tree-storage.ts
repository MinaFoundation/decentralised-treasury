import { Field } from "o1js";
import { MerkleTreeStorage } from "../merkle-tree-storage.js";
import {
  KeyvKeyValueStorage,
  type KeyvNamespaceCounter,
} from "./keyv-key-value-storage.js";
import { Keyv } from "keyv";

export class KeyvMerkleTreeStorage
  extends KeyvKeyValueStorage
  implements MerkleTreeStorage
{
  constructor(keyv: Keyv, namespace: string, counter: KeyvNamespaceCounter) {
    super(keyv, `${namespace}-merkle-tree`, counter);
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
