import assert from "node:assert";
import { it } from "node:test";
import { KeyvVoteNullifierStorage } from "../../../src/storage/keyv/keyv-vote-nullifier-storage.js";
import { SqliteCounter } from "../../../src/storage/sqlite/sqlite-counter.js";
import { createSqliteKeyv } from "../../../src/storage/sqlite/sqlite-keyv.js";
import { getSqliteDbPath } from "../../../src/storage/sqlite/sqlite-db-path.js";

const createKeyvClient = (lifecycleId: string) => {
  return createSqliteKeyv(getSqliteDbPath(lifecycleId));
};

it("should create a keyv vote nullifier storage", async () => {
  const lifecycleId = `test-nullifier-namespace-${Date.now()}`;
  const keyv = createKeyvClient(lifecycleId);
  const counter = new SqliteCounter(getSqliteDbPath(lifecycleId));
  const storage = new KeyvVoteNullifierStorage(
    keyv,
    "test-nullifier-namespace",
    counter,
  );

  await storage.setNullifier("B62qnullifier-1", true);
  const storedNullifier = await storage.getNullifier("B62qnullifier-1");
  assert(storedNullifier === true, "nullifier does not match");

  await storage.close();
});

it("should write multiple vote nullifiers", async () => {
  const lifecycleId = `test-nullifier-namespace-${Date.now()}`;
  const keyv = createKeyvClient(lifecycleId);
  const counter = new SqliteCounter(getSqliteDbPath(lifecycleId));
  const storage = new KeyvVoteNullifierStorage(
    keyv,
    "test-nullifier-namespace",
    counter,
  );

  await storage.setNullifier("B62qnullifier-a", true);
  await storage.setNullifier("B62qnullifier-b", false);
  await storage.setNullifier("B62qnullifier-c", true);

  const [a, b, c] = await Promise.all([
    storage.getNullifier("B62qnullifier-a"),
    storage.getNullifier("B62qnullifier-b"),
    storage.getNullifier("B62qnullifier-c"),
  ]);

  assert(a === true, "nullifier a does not match");
  assert(b === false, "nullifier b does not match");
  assert(c === true, "nullifier c does not match");

  await storage.close();
});
