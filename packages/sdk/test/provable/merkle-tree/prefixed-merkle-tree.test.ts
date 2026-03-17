import { it } from "node:test";
import { KeyvMerkleTreeStorage } from "../../../src/storage/keyv/keyv-merkle-tree-storage.js";
import { Field, Provable } from "o1js";
import assert from "node:assert";
import { PrefixedMerkleTree } from "../../../src/provable/merkle-tree/prefixed-merkle-tree.js";
import { SqliteCounter } from "../../../src/storage/sqlite/sqlite-counter.js";
import { createSqliteKeyv } from "../../../src/storage/sqlite/sqlite-keyv.js";
import { getSqliteDbPath } from "../../../src/storage/sqlite/sqlite-db-path.js";

const expectedRoot =
  "16454815573389775030357115923683611722287847789162266602163105950268208151468";

it("should create a prefixed merkle tree", async () => {
  const lifecycleId = `test-namespace-${Date.now()}`;
  const dbPath = getSqliteDbPath(lifecycleId);
  const keyv = createSqliteKeyv(dbPath);
  const counter = new SqliteCounter(dbPath);
  const merkleTreeStorage = new KeyvMerkleTreeStorage(
    keyv,
    "test-namespace",
    counter,
  );

  const height = 2;
  const emptyLeafHash = Field(0);
  const hashPrefixes = ["test-prefix-0"];
  const values = [Field(1), Field(2)];

  const tree = new PrefixedMerkleTree(
    height,
    emptyLeafHash,
    hashPrefixes,
    merkleTreeStorage
  );

  for (let i = 0; i < values.length; i++) {
    await tree.setLeaf(BigInt(i), values[i]);
  }
  const root = await tree.getRoot();
  assert(root?.toString() === expectedRoot, "root does not match");
  await merkleTreeStorage.close();
});
