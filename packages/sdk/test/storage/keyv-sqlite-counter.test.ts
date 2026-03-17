import assert from "node:assert";
import test from "node:test";
import { Keyv } from "keyv";
import { KeyvSqlite } from "@keyv/sqlite";
import { KeyvKeyValueStorage } from "../../src/storage/keyv/keyv-key-value-storage.js";
import { KeyvSqliteCounter } from "../../src/storage/sqlite/keyv-sqlite-counter.js";

test("KeyvKeyValueStorage counts namespace entries with sqlite", async () => {
  const sqliteStore = new KeyvSqlite({ uri: "sqlite://:memory:" });

  const alphaKeyv = new Keyv({ store: sqliteStore });
  const betaKeyv = new Keyv({ store: sqliteStore });
  const counter = new KeyvSqliteCounter(sqliteStore);

  const alphaStorage = new KeyvKeyValueStorage(alphaKeyv, "alpha", counter);
  const betaStorage = new KeyvKeyValueStorage(betaKeyv, "beta", counter);

  await alphaStorage.set("a1", "v1");
  await betaStorage.set("b1", "v3");
  await betaStorage.set("b2", "v4");

  const alphaCount = await alphaStorage.count();
  const betaCount = await betaStorage.count();

  assert.equal(alphaCount, 1, "alpha count does not match");
  assert.equal(betaCount, 2, "beta count does not match");
  await sqliteStore.disconnect();
});
