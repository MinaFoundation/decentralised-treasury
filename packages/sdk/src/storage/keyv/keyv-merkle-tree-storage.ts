import { Field } from "o1js";
import { MerkleTreeStorage } from "../merkle-tree-storage.js";
import { KeyvCounter, KeyvKeyValueStorage } from "./keyv-key-value-storage.js";
import { Keyv } from "keyv";

export class KeyvMerkleTreeStorage
  extends KeyvKeyValueStorage
  implements MerkleTreeStorage
{
  constructor(keyv: Keyv, namespace: string, keyvCounter: KeyvCounter) {
    super(keyv, keyvCounter, `${namespace}-merkle-tree`);
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
