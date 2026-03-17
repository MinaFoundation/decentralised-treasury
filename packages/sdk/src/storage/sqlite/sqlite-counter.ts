import { KeyvCounter } from "../keyv/keyv-key-value-storage.js";
import { KeyvSqlite } from "@keyv/sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class SqliteCounter implements KeyvCounter {
  constructor(private readonly dbPath: string) {}

  async count(namespace: string): Promise<number> {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    const store = new KeyvSqlite({
      uri: this.dbPath,
    });
    let count = 0;

    for await (const _entry of store.iterator(namespace)) {
      count++;
    }

    return count;
  }
}
