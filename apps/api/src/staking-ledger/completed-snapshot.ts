import { readFileSync, statSync } from "node:fs";
import { getSqliteDbPath } from "@repo/sdk/src/storage/sqlite/sqlite-db-path.js";
import { TransientEventError } from "@repo/processor";

export class LifecycleStakingLedgerFileNotFoundError extends TransientEventError {
  public constructor(public readonly lifecycleId: string) {
    super("data for lifecycleid is not available");
    this.name = "LifecycleStakingLedgerFileNotFoundError";
  }
}

/** The scheduler removes .done before rebuilding and writes it after closing SQLite. */
export function completedSnapshotIdentity(lifecycleId: string): string {
  const path = getSqliteDbPath(lifecycleId);
  try {
    const marker = readFileSync(`${path}.done`, "utf8");
    const completed = JSON.parse(marker);
    if (
      completed.lifecycleId !== lifecycleId ||
      !completed.ledgerHash ||
      !completed.processedAt
    ) {
      throw new Error("Incomplete snapshot marker");
    }
    const file = statSync(path, { bigint: true });
    const done = statSync(`${path}.done`, { bigint: true });
    return `${file.dev}:${file.ino}:${file.mtimeNs}:${file.size}:${done.ino}:${done.mtimeNs}:${marker}`;
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      (error instanceof Error && error.message === "Incomplete snapshot marker")
    ) {
      throw new LifecycleStakingLedgerFileNotFoundError(lifecycleId);
    }
    throw error;
  }
}
