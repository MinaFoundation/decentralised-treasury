import { it } from "node:test";
import { KeyvMerkleTreeStorage } from "../../../src/storage/keyv/keyv-merkle-tree-storage.js";
import { Field } from "o1js";
import assert from "node:assert";
import { SqliteCounter } from "../../../src/storage/sqlite/sqlite-counter.js";
import { createSqliteKeyv } from "../../../src/storage/sqlite/sqlite-keyv.js";
import { getSqliteDbPath } from "../../../src/storage/sqlite/sqlite-db-path.js";

const createKeyvClient = (lifecycleId: string) => {
  return createSqliteKeyv(getSqliteDbPath(lifecycleId));
};

it("should create a key value merkle tree storage", async () => {
  const lifecycleId = `test-namespace-${Date.now()}`;
  const keyv = createKeyvClient(lifecycleId);
  const counter = new SqliteCounter(getSqliteDbPath(lifecycleId));
  const merkleTreeStorage = new KeyvMerkleTreeStorage(
    keyv,
    "test-namespace",
    counter,
  );

  await merkleTreeStorage.setNode(0, 0n, Field(1));
  const node = await merkleTreeStorage.getNode(0, 0n);
  assert(node?.toString() === "1", "node does not match");

  await merkleTreeStorage.close();
});

it("should write multiple merkle nodes", async () => {
  const lifecycleId = `test-namespace-${Date.now()}`;
  const keyv = createKeyvClient(lifecycleId);
  const counter = new SqliteCounter(getSqliteDbPath(lifecycleId));
  const merkleTreeStorage = new KeyvMerkleTreeStorage(
    keyv,
    "test-namespace",
    counter,
  );

  await merkleTreeStorage.setNode(0, 0n, Field(11));
  await merkleTreeStorage.setNode(1, 1n, Field(22));
  await merkleTreeStorage.setNode(2, 3n, Field(33));

  const [node1, node2, node3] = await Promise.all([
    merkleTreeStorage.getNode(0, 0n),
    merkleTreeStorage.getNode(1, 1n),
    merkleTreeStorage.getNode(2, 3n),
  ]);

  assert(node1?.toString() === "11", "node 0-0 does not match");
  assert(node2?.toString() === "22", "node 1-1 does not match");
  assert(node3?.toString() === "33", "node 2-3 does not match");

  await merkleTreeStorage.close();
});
