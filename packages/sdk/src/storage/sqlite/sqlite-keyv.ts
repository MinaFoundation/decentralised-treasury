import { Keyv } from "keyv";
import { KeyvSqlite } from "@keyv/sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

function createSqliteStore(path: string): KeyvSqlite {
  const store = new KeyvSqlite({
    uri: path,
  });

  const disconnect = store.disconnect.bind(store);
  store.disconnect = async () => {
    try {
      await disconnect();
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "SQLITE_MISUSE"
      ) {
        return;
      }
      throw error;
    }
  };

  return store;
}

export function createSqliteKeyv(path: string, namespace = ""): Keyv {
  mkdirSync(dirname(path), { recursive: true });
  return new Keyv({
    store: createSqliteStore(path),
    namespace,
  });
}
