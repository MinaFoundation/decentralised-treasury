import assert from "node:assert";
import { it } from "node:test";
import { KeyvVoteNullifierStorage } from "../../../src/storage/keyv/keyv-vote-nullifier-storage.js";
import { KeyvSqliteCounter } from "../../../src/storage/sqlite/keyv-sqlite-counter.js";
import { Keyv } from "keyv";
import { KeyvSqlite } from "@keyv/sqlite";

it("should create a keyv vote nullifier storage", async () => {
  const store = new KeyvSqlite({ uri: "sqlite://:memory:" });
  const keyv = new Keyv({ store });
  keyv.disconnect = async () => {};
  const storage = new KeyvVoteNullifierStorage(
    keyv,
    "test-nullifier-namespace",
    new KeyvSqliteCounter(store),
  );

  await storage.setNullifier("B62qnullifier-1", true);
  const storedNullifier = await storage.getNullifier("B62qnullifier-1");
  assert(storedNullifier === true, "nullifier does not match");

  await storage.close();
  await store.disconnect();
});

it("should write multiple vote nullifiers", async () => {
  const store = new KeyvSqlite({ uri: "sqlite://:memory:" });
  const keyv = new Keyv({ store });
  keyv.disconnect = async () => {};
  const storage = new KeyvVoteNullifierStorage(
    keyv,
    "test-nullifier-namespace",
    new KeyvSqliteCounter(store),
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
  await store.disconnect();
});
