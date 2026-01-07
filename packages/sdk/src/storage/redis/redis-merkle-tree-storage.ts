import { Field } from "o1js";
import { MerkleTreeStorage } from "../merkle-tree-storage.js";
import { RedisKeyValueStorage } from "./redis-key-value-storage.js";

export class RedisMerkleTreeStorage
  extends RedisKeyValueStorage
  implements MerkleTreeStorage
{
  constructor(redisUrl: string, namespace: string) {
    super(redisUrl, namespace + "-merkle-tree");
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
