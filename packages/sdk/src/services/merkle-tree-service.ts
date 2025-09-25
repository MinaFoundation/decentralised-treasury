import { BaseMerkleWitness } from "node_modules/o1js/dist/node/lib/provable/merkle-tree.js";
import { Field, MerkleTree, MerkleWitness } from "o1js";

export class MerkleWitness32 extends MerkleWitness(32) {}
export class MerkleWitness256 extends MerkleWitness(256) {}

export interface MerkleTree32Service {
  getWitness: (index: bigint) => Promise<MerkleWitness32>;
  setLeaf: (index: bigint, leaf: Field) => Promise<void>;
}

export interface MerkleTree256Service {
  getWitness: (index: bigint) => Promise<MerkleWitness256>;
  setLeaf: (index: bigint, leaf: Field) => Promise<void>;
}

export class PrefilledMerkleTree32InMemoryService
  implements MerkleTree32Service
{
  public witnesses: Record<string, MerkleWitness32> = {};

  public getWitness(index: bigint): Promise<MerkleWitness32> {
    return this.witnesses[index.toString()] ?? MerkleWitness32.empty();
  }

  public async setWitness(
    index: bigint,
    witness: MerkleWitness32
  ): Promise<void> {
    this.witnesses[index.toString()] = witness;
  }

  public async setLeaf(index: bigint, leaf: Field): Promise<void> {
    throw new Error("Unable to set leaf on prefilled merkle tree provider");
  }
}

export class MerkleTree32InMemoryService implements MerkleTree32Service {
  public tree: MerkleTree = new MerkleTree(32);

  public async getWitness(index: bigint): Promise<MerkleWitness32> {
    return new MerkleWitness32(this.tree.getWitness(index));
  }

  public async setLeaf(index: bigint, leaf: Field): Promise<void> {
    this.tree.setLeaf(index, leaf);
  }
}

export class PrefilledMerkleTree256InMemoryService
  implements MerkleTree256Service
{
  public witnesses: Record<string, MerkleWitness256> = {};

  public getWitness(index: bigint): Promise<MerkleWitness256> {
    return this.witnesses[index.toString()] ?? MerkleWitness256.empty();
  }

  public async setWitness(
    index: bigint,
    witness: MerkleWitness256
  ): Promise<void> {
    this.witnesses[index.toString()] = witness;
  }

  public async setLeaf(index: bigint, leaf: Field): Promise<void> {
    throw new Error("Unable to set leaf on prefilled merkle tree provider");
  }
}

export class MerkleTree256InMemoryService implements MerkleTree256Service {
  public tree: MerkleTree = new MerkleTree(256);

  public async getWitness(
    index: bigint
  ): Promise<MerkleWitness256 | undefined> {
    return (
      new MerkleWitness256(this.tree.getWitness(index)) ??
      MerkleWitness256.empty()
    );
  }

  public async setLeaf(index: bigint, leaf: Field): Promise<void> {
    this.tree.setLeaf(index, leaf);
  }
}
