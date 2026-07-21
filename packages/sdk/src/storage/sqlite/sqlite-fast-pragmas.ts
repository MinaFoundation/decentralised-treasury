import type { KeyvSqlite } from "@keyv/sqlite";

// node-sqlite3 (the driver behind @keyv/sqlite) defaults to journal_mode=DELETE
// and synchronous=FULL, so every single INSERT/UPDATE issues its own fsync.
// The staking-ledger-to-voting-ledger digest trace writes many small rows per
// batch (merkle witness nodes, voting accounts, trace entries), so a lifecycle
// with tens of thousands of staking accounts turns into tens of thousands of
// fsync'd writes and a job that should take minutes takes closer to an hour.
// WAL + synchronous=NORMAL is SQLite's documented combination for this: still
// durable against a crashed process, but fsyncs are batched at WAL checkpoints
// instead of issued on every write. A lost tail of writes after an OS-level
// crash is acceptable here because every retry wipes and restarts the
// lifecycle's storage from scratch anyway (see resetLifecycleStorage()).
export async function applyFastSqlitePragmas(store: KeyvSqlite): Promise<void> {
  await store.query("PRAGMA journal_mode = WAL");
  await store.query("PRAGMA synchronous = NORMAL");
}
