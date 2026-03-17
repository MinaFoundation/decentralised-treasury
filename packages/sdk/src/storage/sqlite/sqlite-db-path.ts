import { join } from "node:path";

export function getSqliteDbPath(lifecycleId: string): string {
  return join(process.cwd(), ".data", "sqlite", `${lifecycleId}.sqlite`);
}
