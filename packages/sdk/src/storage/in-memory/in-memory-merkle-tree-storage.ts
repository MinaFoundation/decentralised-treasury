import { Field } from "o1js";
import { MerkleTreeStorage } from "../merkle-tree-storage.js";
import { KeyValueEntry } from "../key-value-storage.js";
import { BatchStorage } from "../batch-storage.js";

export class InMemoryMerkleTreeStorage
  implements MerkleTreeStorage, BatchStorage
{
  private readonly nodes = new Map<string, Field>();

  public constructor(private readonly parentStorage: MerkleTreeStorage) {}

  public get namespace(): string {
    return this.parentStorage.namespace;
  }

  public async getNode(
    level: number,
    index: bigint,
  ): Promise<Field | undefined> {
    const key = `${level}-${index}`;
    const node = this.nodes.get(key);
    if (node) {
      return node;
    }

    const parentNode = await this.parentStorage.getNode(level, index);
    if (parentNode) {
      this.nodes.set(key, parentNode);
    }

    return parentNode;
  }

  public async setNode(
    level: number,
    index: bigint,
    value: Field,
  ): Promise<void> {
    this.nodes.set(`${level}-${index}`, value);
  }

  public collectEntries(): Array<KeyValueEntry> {
    return Array.from(this.nodes, ([nodeKey, value]) => ({
      key: `${this.parentStorage.namespace}:${nodeKey}`,
      value: value.toString(),
    }));
  }

  public clearEntries(): void {
    this.nodes.clear();
  }

  public async close(): Promise<void> {
    this.nodes.clear();
    await this.parentStorage.close();
  }
}
