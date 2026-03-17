import { KeyvVoteReducerRunBatchTraceStorage } from "../../keyv/keyv-vote-reducer-run-batch-trace-storage.js";
import { Keyv } from "keyv";
import type { KeyvSqlite } from "@keyv/sqlite";
import { KeyvSqliteCounter } from "../keyv-sqlite-counter.js";

export function createSqliteVoteReducerRunBatchTraceStorage(
  lifecycleId: string,
  sqliteStore: KeyvSqlite,
): KeyvVoteReducerRunBatchTraceStorage {
  const keyv = new Keyv({ store: sqliteStore, namespace: lifecycleId });
  keyv.disconnect = async () => {};
  const counter = new KeyvSqliteCounter(sqliteStore);
  return new KeyvVoteReducerRunBatchTraceStorage(
    keyv,
    lifecycleId,
    counter,
  );
}
