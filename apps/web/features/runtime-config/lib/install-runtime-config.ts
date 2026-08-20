import { RUNTIME_CONFIG_WINDOW_KEY } from "./get-runtime-config";
import type { TreasuryRuntimeConfig } from "./runtime-config.types";

type RuntimeConfigScope = typeof globalThis & {
  [RUNTIME_CONFIG_WINDOW_KEY]?: TreasuryRuntimeConfig;
};

/**
 * Publishes a config snapshot into the *current* global scope, under the same
 * key `RuntimeConfigScript` uses on the page.
 *
 * This exists for Web Workers. A worker has its own global scope, so the inline
 * bootstrap script the server renders into the document never runs there and
 * `getRuntimeConfig` would fall through to build-time values that a published
 * image does not carry. The main thread therefore hands its already-resolved
 * config to the worker, which installs it here before loading any module that
 * reads configuration.
 *
 * Writes to `globalThis` rather than `window` so it works unchanged in both
 * scopes - in a document they are the same object, and in a worker `window`
 * only exists once the worker has aliased it.
 */
export function installRuntimeConfig(config: TreasuryRuntimeConfig): void {
  (globalThis as RuntimeConfigScope)[RUNTIME_CONFIG_WINDOW_KEY] = config;
}
