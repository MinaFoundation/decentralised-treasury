import { KeyvSqlite } from "@keyv/sqlite";

type SqliteCountRow = {
  count?: number | string;
};

// Exclusive upper bound for a prefix range scan: the prefix with its final code
// unit incremented, so `key >= prefix AND key < upperBound` selects exactly the
// keys beginning with `prefix`.
function prefixUpperBound(prefix: string): string {
  const lastIndex = prefix.length - 1;
  return (
    prefix.slice(0, lastIndex) +
    String.fromCharCode(prefix.charCodeAt(lastIndex) + 1)
  );
}

export class KeyvSqliteCounter {
  constructor(private readonly store: KeyvSqlite) {}

  // Counts one namespace with an index range scan rather than `LIKE 'ns:%'`.
  // The keyv table is `key VARCHAR(255) PRIMARY KEY`, whose implicit index is
  // BINARY-collated, and SQLite declines to rewrite a LIKE into an index range
  // when the comparison is case-insensitive (the default) or an ESCAPE clause
  // is present - both were true here, so the count degraded to a full table
  // scan. On a lifecycle whose keyv table holds ~16M rows that measured
  // 1.6-2.2s per call against ~1ms for the range form, and the merge
  // orchestrator counts once per merged pair, which put the entire merge phase
  // behind this query rather than behind proving.
  //
  // The range form compares with BINARY collation, so it is case-sensitive
  // where LIKE was not. Namespaces are built in code from fixed strings and a
  // lifecycle id, so an exact-case match is what callers already meant.
  async count(namespace: string): Promise<number> {
    const table = this.store.opts.table ?? "keyv";
    const prefix = `${namespace}:`;
    const rows = (await this.store.query(
      `SELECT COUNT(*) as count FROM ${table} WHERE key >= ? AND key < ?`,
      prefix,
      prefixUpperBound(prefix),
    )) as SqliteCountRow[];
    const rawCount = rows[0]?.count ?? 0;
    return typeof rawCount === "number" ? rawCount : Number(rawCount);
  }
}
