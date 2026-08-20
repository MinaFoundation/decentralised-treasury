import { it } from "node:test";
import { KeyvMerkleTreeStorage } from "../../../src/storage/keyv/keyv-merkle-tree-storage.js";
import { KeyvSqliteCounter } from "../../../src/storage/sqlite/keyv-sqlite-counter.js";
import { Field, Provable } from "o1js";
import assert from "node:assert";
import { PrefixedMerkleTree } from "../../../src/provable/merkle-tree/prefixed-merkle-tree.js";
import { Keyv } from "keyv";
import { KeyvSqlite } from "@keyv/sqlite";

const expectedRoot =
  "16454815573389775030357115923683611722287847789162266602163105950268208151468";

it("should create a prefixed merkle tree", async () => {
  const store = new KeyvSqlite({ uri: "sqlite://:memory:" });
  const keyv = new Keyv({ store });
  keyv.disconnect = async () => {};
  const merkleTreeStorage = new KeyvMerkleTreeStorage(
    keyv,
    "test",
    "test",
    new KeyvSqliteCounter(store),
  );

  const height = 2;
  const emptyLeafHash = Field(0);
  const hashPrefixes = ["test-prefix-0"];
  const values = [Field(1), Field(2)];

  const tree = new PrefixedMerkleTree(
    height,
    emptyLeafHash,
    hashPrefixes,
    merkleTreeStorage,
  );

  for (let i = 0; i < values.length; i++) {
    await tree.setLeaf(BigInt(i), values[i]);
  }
  const root = await tree.getRoot();
  assert(root?.toString() === expectedRoot, "root does not match");
  await merkleTreeStorage.close();
  await store.disconnect();
});

it("bulk fill produces the same prefixed merkle root", async () => {
  const store = new KeyvSqlite({ uri: "sqlite://:memory:" });
  const keyv = new Keyv({ store });
  keyv.disconnect = async () => {};
  const merkleTreeStorage = new KeyvMerkleTreeStorage(
    keyv,
    "test",
    "test",
    new KeyvSqliteCounter(store),
  );
  const tree = new PrefixedMerkleTree(
    2,
    Field(0),
    ["test-prefix-0"],
    merkleTreeStorage,
  );

  await tree.fill([Field(1), Field(2)]);

  assert.equal((await tree.getRoot()).toString(), expectedRoot);
  await merkleTreeStorage.close();
  await store.disconnect();
});
