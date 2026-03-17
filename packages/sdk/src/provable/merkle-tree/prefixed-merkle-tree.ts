/**
 * This file contains all code related to the [Merkle Tree](https://en.wikipedia.org/wiki/Merkle_tree) implementation available in o1js.
 */

import { CircuitValue, arrayProp, Poseidon, Field, Bool, Provable } from "o1js";
import { MerkleTreeStorage } from "../../storage/merkle-tree-storage.js";

// external API
export {
  Witness,
  PrefixedMerkleTree,
  PrefixedMerkleWitness,
  BasePrefixedMerkleWitness,
};

// internal API
export { conditionalSwap };

type Witness = { isLeft: boolean; sibling: Field }[];

/**
 * A [Merkle Tree](https://en.wikipedia.org/wiki/Merkle_tree) is a binary tree in which every leaf is the cryptography hash of a piece of data,
 * and every node is the hash of the concatenation of its two child nodes.
 *
 * A Merkle Tree allows developers to easily and securely verify the integrity of large amounts of data.
 *
 * Take a look at our [documentation](https://docs.minaprotocol.com/en/zkapps) on how to use Merkle Trees in combination with zkApps and zero knowledge programming!
 *
 * Levels are indexed from leaves (level 0) to root (level N - 1).
 */
class PrefixedMerkleTree {
  //   nodes: Record<number, Record<string, Field>> = {};
  zeroes: Field[];

  /**
   * Creates a new, empty [Merkle Tree](https://en.wikipedia.org/wiki/Merkle_tree).
   * @param height The height of Merkle Tree.
   * @returns A new MerkleTree
   */
  constructor(
    public readonly height: number,
    public readonly emptyLeafHash: Field,
    public readonly hashPrefixes: string[],
    public storage: MerkleTreeStorage,
  ) {
    this.zeroes = new Array(height);
    this.zeroes[0] = emptyLeafHash;
    for (let i = 1; i < height; i += 1) {
      this.zeroes[i] = Poseidon.hashWithPrefix(this.hashPrefixes[i - 1], [
        this.zeroes[i - 1],
        this.zeroes[i - 1],
      ]);
    }
  }

  //   /**
  //    * Return a new MerkleTree with the same contents as this one.
  //    */
  //   clone() {
  //     let newTree = new PrefixedMerkleTree(
  //       this.height,
  //       this.emptyLeafHash,
  //       this.hashPrefixes
  //     );
  //     for (let [level, nodes] of Object.entries(this.nodes)) {
  //       newTree.nodes[level as any as number] = { ...nodes };
  //     }
  //     return newTree;
  //   }

  /**
   * Returns a node which lives at a given index and level.
   * @param level Level of the node.
   * @param index Index of the node.
   * @returns The data of the node.
   */
  async getNode(level: number, index: bigint): Promise<Field> {
    return (await this.storage.getNode(level, index)) ?? this.zeroes[level];
    // return this.nodes[level]?.[index.toString()] ?? this.zeroes[level];
  }

  /**
   * Returns a leaf at a given index.
   * @param index Index of the leaf.
   * @returns The data of the leaf.
   */
  async getLeaf(index: bigint): Promise<Field> {
    return await this.getNode(0, index);
  }

  /**
   * Returns the root of the [Merkle Tree](https://en.wikipedia.org/wiki/Merkle_tree).
   * @returns The root of the Merkle Tree.
   */
  async getRoot(): Promise<Field> {
    return await this.getNode(this.height - 1, 0n);
  }

  // TODO: this allows to set a node at an index larger than the size. OK?
  private async setNode(level: number, index: bigint, value: Field) {
    await this.storage.setNode(level, index, value);
  }

  // TODO: if this is passed an index bigger than the max, it will set a couple of out-of-bounds nodes but not affect the real Merkle root. OK?
  /**
   * Sets the value of a leaf node at a given index to a given value.
   * @param index Position of the leaf node.
   * @param leaf New value.
   */
  async setLeaf(index: bigint, leaf: Field) {
    if (index >= this.leafCount) {
      throw new Error(
        `index ${index} is out of range for ${this.leafCount} leaves.`,
      );
    }
    await this.setNode(0, index, leaf);
    let currIndex = index;
    for (let level = 1; level < this.height; level++) {
      currIndex /= 2n;

      const left = await this.getNode(level - 1, currIndex * 2n);
      const right = await this.getNode(level - 1, currIndex * 2n + 1n);

      await this.setNode(
        level,
        currIndex,
        Poseidon.hashWithPrefix(this.hashPrefixes[level - 1], [left, right]),
      );
    }
  }

  /**
   * Returns the witness (also known as [Merkle Proof or Merkle Witness](https://computersciencewiki.org/index.php/Merkle_proof)) for the leaf at the given index.
   * @param index Position of the leaf node.
   * @returns The witness that belongs to the leaf.
   */
  async getWitness(index: bigint): Promise<Witness> {
    if (index >= this.leafCount) {
      throw new Error(
        `index ${index} is out of range for ${this.leafCount} leaves.`,
      );
    }
    const witness: Witness = [];
    for (let level = 0; level < this.height - 1; level++) {
      const isLeft = index % 2n === 0n;
      const sibling = await this.getNode(
        level,
        isLeft ? index + 1n : index - 1n,
      );
      witness.push({ isLeft, sibling });
      index /= 2n;
    }
    return witness;
  }

  // TODO: should this take an optional offset? should it fail if the array is too long?
  /**
   * Fills all leaves of the tree.
   * @param leaves Values to fill the leaves with.
   */
  async fill(leaves: Field[]): Promise<void> {
    for (let index = 0; index < leaves.length; index++) {
      await this.setLeaf(BigInt(index), leaves[index]);
    }
  }

  /**
   * Returns the amount of leaf nodes.
   * @returns Amount of leaf nodes.
   */
  get leafCount(): bigint {
    return 2n ** BigInt(this.height - 1);
  }
}

/**
 * The {@link BasePrefixedMerkleWitness} class defines a circuit-compatible base class for [Merkle Witness](https://computersciencewiki.org/index.php/Merkle_proof).
 */
class BasePrefixedMerkleWitness extends CircuitValue {
  static height: number;
  path: Field[];
  isLeft: Bool[];
  height(): number {
    return (this.constructor as any).height;
  }

  /**
   * Takes a {@link Witness} and turns it into a circuit-compatible Witness.
   * @param witness Witness.
   * @returns A circuit-compatible Witness.
   */
  constructor(witness: Witness) {
    super();
    let height = witness.length + 1;
    if (height !== this.height()) {
      throw Error(
        `Length of witness ${height}-1 doesn't match static tree height ${this.height()}.`,
      );
    }
    this.path = witness.map((item) => item.sibling);
    this.isLeft = witness.map((item) => Bool(item.isLeft));
  }

  /**
   * Calculates a root depending on the leaf value.
   * @param leaf Value of the leaf node that belongs to this Witness.
   * @returns The calculated root.
   */
  calculateRoot(leaf: Field, hashPrefixes: string[]): Field {
    let hash = leaf;
    let n = this.height();

    for (let i = 1; i < n; ++i) {
      let isLeft = this.isLeft[i - 1];
      const [left, right] = conditionalSwap(isLeft, hash, this.path[i - 1]);
      hash = Poseidon.hashWithPrefix(hashPrefixes[i - 1], [left, right]);
    }

    return hash;
  }

  /**
   * Calculates the index of the leaf node that belongs to this Witness.
   * @returns Index of the leaf.
   */
  calculateIndex(): Field {
    let powerOfTwo = Field(1);
    let index = Field(0);
    let n = this.height();

    for (let i = 1; i < n; ++i) {
      index = Provable.if(this.isLeft[i - 1], index, index.add(powerOfTwo));
      powerOfTwo = powerOfTwo.mul(2);
    }

    return index;
  }
}

/**
 * Returns a circuit-compatible Witness for a specific Tree height.
 * @param height Height of the Merkle Tree that this Witness belongs to.
 * @returns A circuit-compatible Merkle Witness.
 */
function PrefixedMerkleWitness(
  height: number,
): typeof BasePrefixedMerkleWitness {
  class PrefixedMerkleWitness_ extends BasePrefixedMerkleWitness {
    static height = height;
  }
  arrayProp(Field, height - 1)(PrefixedMerkleWitness_.prototype, "path");
  arrayProp(Bool, height - 1)(PrefixedMerkleWitness_.prototype, "isLeft");
  return PrefixedMerkleWitness_;
}

// swap two values if the boolean is false, otherwise keep them as they are
// more efficient than 2x `Provable.if()` by reusing an intermediate variable
function conditionalSwap(b: Bool, x: Field, y: Field): [Field, Field] {
  let m = b.toField().mul(x.sub(y)); // b*(x - y)
  const x_ = y.add(m); // y + b*(x - y)
  const y_ = x.sub(m); // x - b*(x - y) = x + b*(y - x)
  return [x_, y_];
}

export class PrefixedMerkleWitness36 extends PrefixedMerkleWitness(36) {}
export class PrefixedMerkleWitness255 extends PrefixedMerkleWitness(255) {}
