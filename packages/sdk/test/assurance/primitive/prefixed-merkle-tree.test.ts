import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Field, Poseidon, Provable } from "o1js";
import {
  PrefixedMerkleTree,
  PrefixedMerkleWitness,
  PrefixedMerkleWitness36,
} from "../../../src/provable/merkle-tree/prefixed-merkle-tree.js";
import type { MerkleTreeStorage } from "../../../src/storage/merkle-tree-storage.js";
import { DeterministicByteGenerator } from "../fixtures/deterministic.js";

class MemoryMerkleTreeStorage implements MerkleTreeStorage {
  public readonly namespace: string;
  readonly #nodes = new Map<string, Field>();

  public constructor(namespace: string) {
    this.namespace = namespace;
  }

  public async getNode(
    level: number,
    index: bigint,
  ): Promise<Field | undefined> {
    const value = this.#nodes.get(`${level}:${index}`);
    return value === undefined ? undefined : Field(value.toBigInt());
  }

  public async setNode(
    level: number,
    index: bigint,
    value: Field,
  ): Promise<void> {
    this.#nodes.set(`${level}:${index}`, Field(value.toBigInt()));
  }

  public async clear(): Promise<void> {
    this.#nodes.clear();
  }

  public async close(): Promise<void> {
    this.#nodes.clear();
  }
}

function hasMessage(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof Error && error.message === expected;
}

function deterministicFields(label: string, count: number): Field[] {
  const generator = new DeterministicByteGenerator("primitive-merkle", label);
  return Array.from({ length: count }, () => {
    const bytes = generator.nextBytes(8);
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    return Field(value);
  });
}

function emptyHashes(
  height: number,
  emptyLeaf: Field,
  prefixes: readonly string[],
): Field[] {
  const hashes = [emptyLeaf];
  for (let level = 1; level < height; level += 1) {
    hashes.push(
      Poseidon.hashWithPrefix(prefixes[level - 1]!, [
        hashes[level - 1]!,
        hashes[level - 1]!,
      ]),
    );
  }
  return hashes;
}

function expectedDenseRoot(
  height: number,
  emptyLeaf: Field,
  prefixes: readonly string[],
  populatedLeaves: readonly Field[],
): Field {
  const leafCount = 2 ** (height - 1);
  assert.ok(
    Number.isSafeInteger(leafCount),
    "dense oracle needs a safe leaf count",
  );
  assert.ok(
    populatedLeaves.length <= leafCount,
    "fixture exceeds the dense oracle capacity",
  );

  let level = Array.from(
    { length: leafCount },
    (_, index) => populatedLeaves[index] ?? emptyLeaf,
  );
  for (let levelIndex = 0; level.length > 1; levelIndex += 1) {
    const parents: Field[] = [];
    for (let index = 0; index < level.length; index += 2) {
      parents.push(
        Poseidon.hashWithPrefix(prefixes[levelIndex]!, [
          level[index]!,
          level[index + 1]!,
        ]),
      );
    }
    level = parents;
  }
  return level[0]!;
}

function expectedSingleLeafRoot(
  height: number,
  emptyLeaf: Field,
  prefixes: readonly string[],
  leafIndex: bigint,
  leaf: Field,
): Field {
  const zeroes = emptyHashes(height, emptyLeaf, prefixes);
  let index = leafIndex;
  let hash = leaf;
  for (let level = 0; level < height - 1; level += 1) {
    const sibling = zeroes[level]!;
    hash =
      index % 2n === 0n
        ? Poseidon.hashWithPrefix(prefixes[level]!, [hash, sibling])
        : Poseidon.hashWithPrefix(prefixes[level]!, [sibling, hash]);
    index /= 2n;
  }
  return hash;
}

function createTree(
  height: number,
  emptyLeaf: Field,
  prefixes: string[],
  label: string,
) {
  return new PrefixedMerkleTree(
    height,
    emptyLeaf,
    prefixes,
    new MemoryMerkleTreeStorage(label),
  );
}

const height = 4;
const prefixes = [
  "AssuranceMerkle000",
  "AssuranceMerkle001",
  "AssuranceMerkle002",
];
const emptyLeaf = Field(0);

describe("proof-off prefixed Merkle-tree primitives", () => {
  it("PRIM-MERKLE-002 derives the empty root with an independent tree model", async () => {
    const tree = createTree(height, emptyLeaf, prefixes, "empty-root");
    const expected = expectedDenseRoot(height, emptyLeaf, prefixes, []);

    assert.equal((await tree.getRoot()).toString(), expected.toString());
  });

  it("PRIM-MERKLE-003 checks every incremental root", async () => {
    const leaves = deterministicFields("incremental", 5);
    const tree = createTree(height, emptyLeaf, prefixes, "incremental");

    for (let index = 0; index < leaves.length; index += 1) {
      await tree.setLeaf(BigInt(index), leaves[index]!);
      const expected = expectedDenseRoot(
        height,
        emptyLeaf,
        prefixes,
        leaves.slice(0, index + 1),
      );
      assert.equal(
        (await tree.getRoot()).toString(),
        expected.toString(),
        `leaf ${index}`,
      );
    }
  });

  it("PRIM-MERKLE-004 and PRIM-MERKLE-005 check bulk and partial fill roots", async () => {
    const cases = [
      { name: "partial", leaves: deterministicFields("partial-fill", 5) },
      { name: "complete", leaves: deterministicFields("complete-fill", 8) },
    ] as const;

    for (const testCase of cases) {
      const bulkTree = createTree(
        height,
        emptyLeaf,
        prefixes,
        `${testCase.name}-bulk`,
      );
      const incrementalTree = createTree(
        height,
        emptyLeaf,
        prefixes,
        `${testCase.name}-incremental`,
      );
      await bulkTree.fill([...testCase.leaves]);
      for (let index = 0; index < testCase.leaves.length; index += 1) {
        await incrementalTree.setLeaf(BigInt(index), testCase.leaves[index]!);
      }

      const expected = expectedDenseRoot(
        height,
        emptyLeaf,
        prefixes,
        testCase.leaves,
      );
      assert.equal(
        (await bulkTree.getRoot()).toString(),
        expected.toString(),
        testCase.name,
      );
      assert.equal(
        (await incrementalTree.getRoot()).toString(),
        expected.toString(),
        testCase.name,
      );
    }
  });

  it("PRIM-MERKLE-006 separates prefix values and levels", async () => {
    const leaves = deterministicFields("prefixes", 4);
    const changedValue = [...prefixes];
    changedValue[1] = "AssuranceMerkleChanged";
    const changedOrder = [prefixes[1]!, prefixes[0]!, prefixes[2]!];
    const cases = [
      { name: "baseline", prefixes },
      { name: "changed value", prefixes: changedValue },
      { name: "changed order", prefixes: changedOrder },
    ] as const;
    const roots: string[] = [];

    for (const testCase of cases) {
      const tree = createTree(
        height,
        emptyLeaf,
        [...testCase.prefixes],
        testCase.name,
      );
      await tree.fill(leaves);
      const expected = expectedDenseRoot(
        height,
        emptyLeaf,
        testCase.prefixes,
        leaves,
      );
      const root = (await tree.getRoot()).toString();
      assert.equal(root, expected.toString(), testCase.name);
      roots.push(root);
    }

    assert.equal(new Set(roots).size, cases.length);
  });

  it("PRIM-MERKLE-007 commits left and right child order", async () => {
    const [left, right] = deterministicFields("child-order", 2);
    const tree = createTree(2, emptyLeaf, [prefixes[0]!], "child-order");
    await tree.fill([left!, right!]);

    const expected = Poseidon.hashWithPrefix(prefixes[0]!, [left!, right!]);
    const reversed = Poseidon.hashWithPrefix(prefixes[0]!, [right!, left!]);
    assert.equal((await tree.getRoot()).toString(), expected.toString());
    assert.notEqual(expected.toString(), reversed.toString());
  });

  it("PRIM-MERKLE-008 reconstructs roots for boundary and interior witnesses", async () => {
    const leaves = deterministicFields("witness-roots", 8);
    const tree = createTree(height, emptyLeaf, prefixes, "witness-roots");
    await tree.fill(leaves);
    const root = await tree.getRoot();

    for (const index of [0n, 2n, 5n, 7n]) {
      const witness = new (PrefixedMerkleWitness(height))(
        await tree.getWitness(index),
      );
      assert.equal(
        witness.calculateRoot(leaves[Number(index)]!, prefixes).toString(),
        root.toString(),
      );
      await Provable.runAndCheck(() => {
        witness
          .calculateRoot(leaves[Number(index)]!, prefixes)
          .assertEquals(root);
      });
    }
  });

  it("PRIM-MERKLE-009 reconstructs witness indices", async () => {
    const leaves = deterministicFields("witness-indices", 8);
    const tree = createTree(height, emptyLeaf, prefixes, "witness-indices");
    await tree.fill(leaves);
    const Witness = PrefixedMerkleWitness(height);

    for (const index of [0n, 1n, 2n, 5n, 7n]) {
      const witness = new Witness(await tree.getWitness(index));
      assert.equal(witness.calculateIndex().toBigInt(), index);
      await Provable.runAndCheck(() =>
        witness.calculateIndex().assertEquals(Field(index)),
      );
    }
  });

  it("PRIM-MERKLE-010 kills leaf, sibling, and direction mutations", async () => {
    const leaves = deterministicFields("witness-mutations", 8);
    const tree = createTree(height, emptyLeaf, prefixes, "witness-mutations");
    await tree.fill(leaves);
    const root = await tree.getRoot();
    const index = 2n;
    const rawWitness = await tree.getWitness(index);
    const Witness = PrefixedMerkleWitness(height);
    const valid = new Witness(rawWitness);
    const siblingMutation = new Witness(
      rawWitness.map((item, itemIndex) =>
        itemIndex === 0 ? { ...item, sibling: item.sibling.add(1) } : item,
      ),
    );
    const directionMutation = new Witness(
      rawWitness.map((item, itemIndex) =>
        itemIndex === 0 ? { ...item, isLeft: !item.isLeft } : item,
      ),
    );

    assert.equal(
      valid.calculateRoot(leaves[Number(index)]!, prefixes).toString(),
      root.toString(),
    );
    assert.notEqual(
      valid.calculateRoot(leaves[Number(index)]!.add(1), prefixes).toString(),
      root.toString(),
    );
    assert.notEqual(
      siblingMutation
        .calculateRoot(leaves[Number(index)]!, prefixes)
        .toString(),
      root.toString(),
    );
    assert.notEqual(
      directionMutation
        .calculateRoot(leaves[Number(index)]!, prefixes)
        .toString(),
      root.toString(),
    );
  });

  it("PRIM-MERKLE-011 rejects short and long witnesses", () => {
    const Witness = PrefixedMerkleWitness(height);
    const validLength = height - 1;
    const cases = [
      { name: "short", length: validLength - 1 },
      { name: "long", length: validLength + 1 },
    ] as const;

    for (const testCase of cases) {
      const witness = Array.from({ length: testCase.length }, () => ({
        isLeft: true,
        sibling: Field(0),
      }));
      assert.throws(
        () => new Witness(witness),
        hasMessage(
          `Length of witness ${testCase.length + 1}-1 doesn't match static tree height ${height}.`,
        ),
        testCase.name,
      );
    }
  });

  it("PRIM-MERKLE-012 accepts max-1 and maximum height-36 indices", async () => {
    const maxIndex = 2n ** 35n - 1n;
    const height36Prefixes = Array.from(
      { length: 35 },
      (_, level) => `AssuranceHeight36-${level.toString().padStart(2, "0")}`,
    );
    const cases = [
      { name: "maximum minus one", index: maxIndex - 1n },
      { name: "maximum", index: maxIndex },
    ] as const;

    for (const testCase of cases) {
      const leaf = deterministicFields(testCase.name, 1)[0]!;
      const tree = createTree(36, emptyLeaf, height36Prefixes, testCase.name);
      await tree.setLeaf(testCase.index, leaf);
      const root = await tree.getRoot();
      const expected = expectedSingleLeafRoot(
        36,
        emptyLeaf,
        height36Prefixes,
        testCase.index,
        leaf,
      );
      const witness = new PrefixedMerkleWitness36(
        await tree.getWitness(testCase.index),
      );

      assert.equal(tree.leafCount, 2n ** 35n);
      assert.equal(root.toString(), expected.toString(), testCase.name);
      assert.equal(
        witness.calculateIndex().toBigInt(),
        testCase.index,
        testCase.name,
      );
      assert.equal(
        witness.calculateRoot(leaf, height36Prefixes).toString(),
        root.toString(),
        testCase.name,
      );
    }
  });

  it("PRIM-MERKLE-003 keeps repeated identical updates deterministic", async () => {
    const replayTree = createTree(
      height,
      emptyLeaf,
      prefixes,
      "repeated-update",
    );
    const index = 3n;
    const leaf = deterministicFields("repeated-update", 1)[0]!;

    await replayTree.setLeaf(index, leaf);
    const firstRoot = await replayTree.getRoot();
    const firstWitness = await replayTree.getWitness(index);
    await replayTree.setLeaf(index, leaf);

    assert.equal((await replayTree.getRoot()).toString(), firstRoot.toString());
    assert.deepEqual(
      (await replayTree.getWitness(index)).map(({ isLeft, sibling }) => ({
        isLeft,
        sibling: sibling.toString(),
      })),
      firstWitness.map(({ isLeft, sibling }) => ({
        isLeft,
        sibling: sibling.toString(),
      })),
    );
  });

  it("PRIM-MERKLE-013 rejects the height-36 upper bound", async () => {
    const upperBound = 2n ** 35n;
    const height36Prefixes = Array.from(
      { length: 35 },
      (_, level) => `AssuranceHeight36-${level.toString().padStart(2, "0")}`,
    );
    const tree = createTree(36, emptyLeaf, height36Prefixes, "upper-bound");
    const message = hasMessage(
      "index 34359738368 is out of range for 34359738368 leaves.",
    );

    await assert.rejects(() => tree.setLeaf(upperBound, Field(1)), message);
    await assert.rejects(() => tree.getWitness(upperBound), message);
  });

  it("PRIM-MERKLE-015 rejects a bulk fill above capacity", async () => {
    const smallHeight = 3;
    const smallPrefixes = prefixes.slice(0, smallHeight - 1);
    const tree = createTree(
      smallHeight,
      emptyLeaf,
      smallPrefixes,
      "fill-capacity",
    );
    const leaves = deterministicFields("fill-capacity", 5);

    await assert.rejects(
      () => tree.fill(leaves),
      hasMessage("5 leaves exceed the tree capacity of 4."),
    );
  });
});
