import type { ChildProcess } from "node:child_process";

export const serviceNames: readonly [
  "indexer",
  "indexer-api",
  "processor",
  "processor-api",
  "app-api",
];
export type ServiceName = (typeof serviceNames)[number];
export function createServiceControls(
  launch: (name: ServiceName) => ChildProcess,
  options?: { graceMs?: number; killMs?: number },
): {
  start(name: ServiceName): ChildProcess;
  stop(name: ServiceName): Promise<void>;
};
