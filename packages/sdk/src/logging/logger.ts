import log from "loglevel";
import { Provable } from "o1js";

export type LogLevelName = "trace" | "debug" | "info" | "warn" | "error" | "silent";
export type LogMethodLevel = Exclude<LogLevelName, "silent">;

const LOG_LEVEL: LogLevelName =
  (process.env.LOG_LEVEL as LogLevelName | undefined) ?? "info";

log.setDefaultLevel(LOG_LEVEL);
log.setLevel(LOG_LEVEL);

const timers = new Map<string, number>();

function getLevelValue(level: LogMethodLevel): number {
  const levelKey = level.toUpperCase() as keyof typeof log.levels;
  return log.levels[levelKey];
}

export function isLevelEnabled(level: LogMethodLevel): boolean {
  return log.getLevel() <= getLevelValue(level);
}

export function time(label: string, level: LogMethodLevel = "debug"): void {
  if (!isLevelEnabled(level)) {
    return;
  }
  timers.set(`${level}:${label}`, Date.now());
}

export function timeEnd(
  label: string,
  level: LogMethodLevel = "debug",
  ...args: unknown[]
): void {
  if (!isLevelEnabled(level)) {
    return;
  }

  const key = `${level}:${label}`;
  const startedAt = timers.get(key);
  if (startedAt === undefined) {
    return;
  }
  timers.delete(key);

  const elapsedMs = Date.now() - startedAt;
  log[level](`${label}: ${elapsedMs}ms`, ...args);
}

export function provableLog(...args: unknown[]): void {
  if (!isLevelEnabled("debug")) {
    return;
  }
  Provable.log(...args);
}

export const logger = log;
