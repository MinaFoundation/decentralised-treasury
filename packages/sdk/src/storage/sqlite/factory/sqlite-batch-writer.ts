import { KeyvKeyValueBatchStorage } from "../../keyv/keyv-key-value-batch-storage.js";
import { Keyv } from "keyv";
import type { KeyvSqlite } from "@keyv/sqlite";

export function createSqliteBatchWriter(
  sqliteStore: KeyvSqlite,
): KeyvKeyValueBatchStorage {
  const keyv = new Keyv({
    store: sqliteStore,
  });
  keyv.disconnect = async () => {};
  return new KeyvKeyValueBatchStorage(keyv);
}
