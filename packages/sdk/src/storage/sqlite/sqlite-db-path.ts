import { join } from "node:path";

export function getSqliteDbPath(lifecycleId: string): string {
  const sqliteDataDirectory =
    process.env.SQLITE_DATA_DIRECTORY ?? join(process.cwd(), ".data", "sqlite");
  return join(sqliteDataDirectory, `${lifecycleId}.sqlite`);
}

export function getSqliteInMemoryDbPath(lifecycleId: string): string {
  void lifecycleId;
  return "sqlite://:memory:";
}

export function isSqliteMemoryPath(dbPath: string): boolean {
  return dbPath === ":memory:" || dbPath === "sqlite://:memory:";
}
