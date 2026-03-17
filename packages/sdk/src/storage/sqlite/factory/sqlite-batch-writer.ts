import { KeyvKeyValueBatchStorage } from "../../keyv/keyv-key-value-batch-storage.js";
import { getSqliteDbPath } from "../sqlite-db-path.js";
import { createSqliteKeyv } from "../sqlite-keyv.js";

export function createSqliteBatchWriter(
  lifecycleId = "shared",
): KeyvKeyValueBatchStorage {
  return new KeyvKeyValueBatchStorage(
    createSqliteKeyv(getSqliteDbPath(lifecycleId)),
  );
}
