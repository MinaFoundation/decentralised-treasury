import { KeyvSqlite } from "@keyv/sqlite";

type SqliteCountRow = {
  count?: number | string;
};

export class KeyvSqliteCounter {
  constructor(private readonly store: KeyvSqlite) {}

  async count(namespace: string): Promise<number> {
    const table = this.store.opts.table ?? "keyv";
    const escapedNamespace = namespace.replace(/[%_\\]/g, "\\$&");
    const pattern = `${escapedNamespace}:%`;
    const rows = (await this.store.query(
      `SELECT COUNT(*) as count FROM ${table} WHERE key LIKE ? ESCAPE '\\'`,
      pattern,
    )) as SqliteCountRow[];
    const rawCount = rows[0]?.count ?? 0;
    return typeof rawCount === "number" ? rawCount : Number(rawCount);
  }
}
