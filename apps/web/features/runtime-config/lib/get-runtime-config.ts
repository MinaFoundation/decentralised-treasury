import { readBuildTimeEnv } from "./read-build-time-env";
import { readRuntimeConfig } from "./read-runtime-config";
import type { TreasuryRuntimeConfig } from "./runtime-config.types";

export const RUNTIME_CONFIG_WINDOW_KEY = "__TREASURY_RUNTIME_CONFIG__";

type RuntimeConfigWindow = Window & {
  [RUNTIME_CONFIG_WINDOW_KEY]?: TreasuryRuntimeConfig;
};

/**
 * The browser-facing configuration for this deployment.
 *
 * On the server it comes from the container's own environment, which is what
 * makes one published image usable by any operator. In the browser it comes
 * from the snapshot `RuntimeConfigScript` wrote before the app chunks ran,
 * falling back to build-time values for `next dev` and unit tests.
 *
 * Cheap enough to call per render; nothing is memoised so tests can restub the
 * environment between cases.
 */
export function getRuntimeConfig(): TreasuryRuntimeConfig {
  if (typeof window === "undefined") {
    return readRuntimeConfig(process.env);
  }

  const injected = (window as RuntimeConfigWindow)[RUNTIME_CONFIG_WINDOW_KEY];

  return injected ?? readRuntimeConfig(readBuildTimeEnv());
}
