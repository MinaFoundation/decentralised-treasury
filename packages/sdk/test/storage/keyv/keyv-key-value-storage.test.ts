import { it } from "node:test";
import { KeyvKeyValueStorage } from "../../../src/storage/keyv/keyv-key-value-storage.js";
import { KeyvSqliteCounter } from "../../../src/storage/sqlite/keyv-sqlite-counter.js";
import assert from "node:assert";
import { Keyv } from "keyv";
import { KeyvSqlite } from "@keyv/sqlite";

const key = "foo";
const value = "bar";
const namespace = "test-namespace";

it("should create a keyv key value storage", async () => {
  const store = new KeyvSqlite({ uri: "sqlite://:memory:" });
  const keyv = new Keyv({ store });
  keyv.disconnect = async () => {};
  const storage = new KeyvKeyValueStorage(
    keyv,
    namespace,
    new KeyvSqliteCounter(store),
  );

  await storage.set(key, value);
  const storedValue = await storage.get(key);
  const count = await storage.count();

  assert(storedValue === value, "value does not match");
  assert(count === 1, "count does not match");

  await storage.close();
  await store.disconnect();
});

it("should batch write keys in one transaction", async () => {
  const store = new KeyvSqlite({ uri: "sqlite://:memory:" });
  const keyv = new Keyv({ store });
  keyv.disconnect = async () => {};
  const storage = new KeyvKeyValueStorage(
    keyv,
    namespace,
    new KeyvSqliteCounter(store),
  );

  await storage.setMany([
    { key: "batch-1", value: "value-1" },
    { key: "batch-2", value: "value-2" },
    { key: "batch-3", value: "value-3" },
  ]);

  const [value1, value2, value3] = await Promise.all([
    storage.get("batch-1"),
    storage.get("batch-2"),
    storage.get("batch-3"),
  ]);
  const count = await storage.count();

  assert(value1 === "value-1", "batch key batch-1 was not written");
  assert(value2 === "value-2", "batch key batch-2 was not written");
  assert(value3 === "value-3", "batch key batch-3 was not written");
  assert(count === 3, "count does not match batch entries");

  await storage.close();
  await store.disconnect();
});

it("should count stored keys", async () => {
  const store = new KeyvSqlite({ uri: "sqlite://:memory:" });
  const keyv = new Keyv({ store });
  keyv.disconnect = async () => {};
  const storage = new KeyvKeyValueStorage(
    keyv,
    namespace,
    new KeyvSqliteCounter(store),
  );

  await storage.set("count-1", "value-1");
  await storage.set("count-2", "value-2");
  await storage.set("count-3", "value-3");

  const count = await storage.count();

  assert(count === 3, "count does not match stored keys");

  await storage.close();
  await store.disconnect();
});


