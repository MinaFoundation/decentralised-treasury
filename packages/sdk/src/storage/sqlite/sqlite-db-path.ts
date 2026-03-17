import { join } from "node:path";

export function getSqliteDbPath(lifecycleId: string): string {
  return join(process.cwd(), ".data", "sqlite", `${lifecycleId}.sqlite`);
}

export function getSqliteInMemoryDbPath(lifecycleId: string): string {
  void lifecycleId;
  return "sqlite://:memory:";
}

export function isSqliteMemoryPath(dbPath: string): boolean {
  return dbPath === ":memory:" || dbPath === "sqlite://:memory:";
}
