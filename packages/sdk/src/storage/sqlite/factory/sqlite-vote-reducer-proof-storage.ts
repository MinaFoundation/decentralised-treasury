import { KeyvVoteReducerProofStorage } from "../../keyv/keyv-vote-reducer-proof-storage.js";
import { Keyv } from "keyv";
import type { KeyvSqlite } from "@keyv/sqlite";
import { KeyvSqliteCounter } from "../keyv-sqlite-counter.js";

export function createSqliteVoteReducerProofStorage(
  lifecycleId: string,
  sqliteStore: KeyvSqlite,
): KeyvVoteReducerProofStorage {
  const createKeyv = (namespace = "") => {
    const keyv = new Keyv({ store: sqliteStore, namespace });
    keyv.disconnect = async () => {};
    return keyv;
  };
  const counter = new KeyvSqliteCounter(sqliteStore);
  return new KeyvVoteReducerProofStorage(createKeyv, lifecycleId, counter);
}
