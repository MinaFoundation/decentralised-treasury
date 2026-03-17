import { KeyvVoteReducerRunBatchTraceStorage } from "../../keyv/keyv-vote-reducer-run-batch-trace-storage.js";
import { SqliteCounter } from "../sqlite-counter.js";
import { getSqliteDbPath } from "../sqlite-db-path.js";
import { createSqliteKeyv } from "../sqlite-keyv.js";

export function createSqliteVoteReducerRunBatchTraceStorage(
  lifecycleId: string,
): KeyvVoteReducerRunBatchTraceStorage {
  const dbPath = getSqliteDbPath(lifecycleId);
  return new KeyvVoteReducerRunBatchTraceStorage(
    createSqliteKeyv(dbPath),
    lifecycleId,
    new SqliteCounter(dbPath),
  );
}
