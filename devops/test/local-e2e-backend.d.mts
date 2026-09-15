import type { spawn } from "node:child_process";
import type { createServiceControls } from "./local-e2e-services.mjs";

export interface LocalE2EBackendOptions {
  runDirectory: string;
  minaNodeUrl: string;
  archiveNodeUrl: string;
  treasuryOwnerPublicKey: string;
  proofsEnabled: boolean;
  resourceId?: string;
  env?: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
  commandTimeoutMs?: number;
}
export interface LocalE2EBackend {
  appApiUrl: string;
  indexerApiUrl: string;
  processorApiUrl: string;
  artifactDirectory: string;
  sqliteDirectory: string;
  resourceId: string;
  services: ReturnType<typeof createServiceControls>;
  dispose(): Promise<void>;
}
export function startLocalE2EBackend(
  options: LocalE2EBackendOptions,
): Promise<LocalE2EBackend>;
export function createLocalE2EBackendLauncher(dependencies?: {
  spawn?: typeof spawn;
  fetch?: typeof fetch;
  availablePort?: () => Promise<number>;
}): typeof startLocalE2EBackend;
