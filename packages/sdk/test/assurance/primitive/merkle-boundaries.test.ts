import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Bool, Field, Poseidon } from "o1js";
import { accountLedgerHashPrefixes } from "../../../src/ledgers/staking-ledger/staking-ledger.js";
import {
  votingAccountHashPrefix,
  votingAccountLedgerHashPrefixes,
} from "../../../src/ledgers/voting-ledger/voting-ledger.js";
import {
  nullifierHashPrefix,
  nullifierLedgerHashPrefixes,
} from "../../../src/ledgers/nullifier-ledger/nullifier-ledger.js";
import { PrefixedMerkleTree } from "../../../src/provable/merkle-tree/prefixed-merkle-tree.js";
import type { MerkleTreeStorage } from "../../../src/storage/merkle-tree-storage.js";
import { deterministicWitness255 } from "../fixtures/ledgers/strict-ledgers.js";

const EMPTY_ACCOUNT_HASH = Field(
  "28328037583256331742860088544984623105766605252477591487013162091232255973154",
);

class FaultingStorage implements MerkleTreeStorage {
  public readonly namespace: string;
  readonly #nodes = new Map<string, Field>();
  #writeCount = 0;

  public constructor(
    namespace: string,
    readonly failureAt?: number,
  ) {
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
    this.#writeCount += 1;
    if (this.#writeCount === this.failureAt) {
      throw new Error(
        `Injected Merkle storage failure at write ${this.#writeCount}.`,
      );
    }
    this.#nodes.set(`${level}:${index}`, Field(value.toBigInt()));
  }

  public async clear(): Promise<void> {
    this.#nodes.clear();
  }

  public async close(): Promise<void> {
    this.#nodes.clear();
  }

  public snapshot(): ReadonlyMap<string, bigint> {
    return new Map(
      [...this.#nodes].map(([key, value]) => [key, value.toBigInt()]),
    );
  }
}

function emptyRoot(
  emptyLeaf: Field,
  prefixes: readonly string[],
  height: number,
): Field {
  let root = emptyLeaf;
  for (let level = 0; level < height - 1; level += 1) {
    root = Poseidon.hashWithPrefix(prefixes[level]!, [root, root]);
  }
  return root;
}

function hasMessage(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof Error && error.message === expected;
}

describe("proof-off Merkle boundaries and storage faults", () => {
  it("PRIM-MERKLE-001 checks exact leaf-index domains", () => {
    const cases = [
      { height: 1, expectedLeaves: 1n },
      { height: 2, expectedLeaves: 2n },
      { height: 4, expectedLeaves: 8n },
      { height: 36, expectedLeaves: 2n ** 35n },
    ] as const;

    for (const testCase of cases) {
      const prefixes = Array.from(
        { length: testCase.height - 1 },
        (_, level) => `AssuranceDomain-${testCase.height}-${level}`,
      );
      const tree = new PrefixedMerkleTree(
        testCase.height,
        Field(0),
        prefixes,
        new FaultingStorage(`height-${testCase.height}`),
      );
      assert.equal(tree.leafCount, testCase.expectedLeaves);
      assert.equal(tree.leafCount - 1n, 2n ** BigInt(testCase.height - 1) - 1n);
    }
  });

  it("PRIM-MERKLE-006 characterizes constructor prefix validation", async () => {
    assert.throws(
      () =>
        new PrefixedMerkleTree(
          4,
          Field(0),
          ["only-one-prefix"],
          new FaultingStorage("missing-prefixes"),
        ),
      (error) => error instanceof Error,
    );

    const exactPrefixes = ["Prefix-0", "Prefix-1", "Prefix-2"];
    const extraPrefixes = [...exactPrefixes, "ignored-extra-prefix"];
    const exact = new PrefixedMerkleTree(
      4,
      Field(0),
      exactPrefixes,
      new FaultingStorage("exact-prefixes"),
    );
    const extra = new PrefixedMerkleTree(
      4,
      Field(0),
      extraPrefixes,
      new FaultingStorage("extra-prefixes"),
    );

    assert.equal(
      (await exact.getRoot()).toString(),
      (await extra.getRoot()).toString(),
    );
  });

  it("PRIM-MERKLE-003 characterizes partial writes after storage failure", async () => {
    const height = 4;
    const prefixes = ["Fault-0", "Fault-1", "Fault-2"];
    const preRoot = emptyRoot(Field(0), prefixes, height);
    const cases = [
      { failureAt: 1, expectedWrites: 0, partial: false },
      { failureAt: 2, expectedWrites: 1, partial: true },
      { failureAt: 4, expectedWrites: 3, partial: true },
    ] as const;

    for (const testCase of cases) {
      const storage = new FaultingStorage(
        `failure-${testCase.failureAt}`,
        testCase.failureAt,
      );
      const tree = new PrefixedMerkleTree(height, Field(0), prefixes, storage);
      await assert.rejects(
        () => tree.setLeaf(2n, Field(99)),
        hasMessage(
          `Injected Merkle storage failure at write ${testCase.failureAt}.`,
        ),
      );

      const snapshot = storage.snapshot();
      assert.equal(
        snapshot.size,
        testCase.expectedWrites,
        `failure ${testCase.failureAt}`,
      );
      assert.equal(
        snapshot.has("0:2"),
        testCase.partial,
        `failure ${testCase.failureAt}`,
      );
      assert.equal((await tree.getRoot()).toString(), preRoot.toString());
    }
  });

  it("PRIM-MERKLE-014 characterizes the accepted negative index defect", async () => {
    const storage = new FaultingStorage("negative-index");
    const prefixes = ["Negative-0", "Negative-1", "Negative-2"];
    const tree = new PrefixedMerkleTree(4, Field(0), prefixes, storage);
    const preRoot = await tree.getRoot();

    await tree.setLeaf(-1n, Field(99));
    const witness = await tree.getWitness(-1n);

    assert.equal(storage.snapshot().get("0:-1"), 99n);
    assert.equal((await tree.getRoot()).toString(), preRoot.toString());
    assert.equal(witness.length, 3);
  });

  it("PRIM-MERKLE-016 checks field-safe height-255 symbolic indices", () => {
    const cases = [0n, 1n, 2n ** 250n - 1n] as const;

    for (const index of cases) {
      const witness = deterministicWitness255(index, 1_000n);
      assert.equal(witness.path.length, 254);
      assert.equal(witness.calculateIndex().toBigInt(), index);
    }
  });

  it("PRIM-MERKLE-017 checks pinned empty ledger roots", () => {
    const votingLeaf = Poseidon.hashWithPrefix(votingAccountHashPrefix, [
      Field(0),
    ]);
    const nullifierLeaf = Poseidon.hashWithPrefix(
      nullifierHashPrefix,
      Bool(false).toFields(),
    );
    const cases = [
      {
        name: "staking",
        height: 36,
        leaf: EMPTY_ACCOUNT_HASH,
        prefixes: accountLedgerHashPrefixes,
        expectedRoot:
          "3215502255718014038703036884821970707349628787866322650053921406206997378646",
      },
      {
        name: "voting",
        height: 255,
        leaf: votingLeaf,
        prefixes: votingAccountLedgerHashPrefixes,
        expectedRoot:
          "6794346380224403205521938693534129458305269524315953328655585596513412167689",
      },
      {
        name: "nullifier",
        height: 255,
        leaf: nullifierLeaf,
        prefixes: nullifierLedgerHashPrefixes,
        expectedRoot:
          "10243661541247090639218033807525757564303221982895710530643172762256348300000",
      },
    ] as const;

    for (const testCase of cases) {
      assert.ok(testCase.prefixes.length >= testCase.height - 1, testCase.name);
      assert.equal(
        emptyRoot(testCase.leaf, testCase.prefixes, testCase.height).toString(),
        testCase.expectedRoot,
        testCase.name,
      );
    }

    assert.equal(accountLedgerHashPrefixes.length, 35);
    assert.equal(votingAccountLedgerHashPrefixes.length, 255);
    assert.equal(nullifierLedgerHashPrefixes.length, 255);
  });
});
