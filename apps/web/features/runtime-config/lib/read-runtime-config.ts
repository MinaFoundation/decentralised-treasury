import {
  RUNTIME_CONFIG_FIELD_NAMES,
  RUNTIME_CONFIG_FIELDS,
  type RuntimeConfigFieldName,
} from "./runtime-config-fields";
import type {
  RuntimeConfigEnv,
  TreasuryRuntimeConfig,
} from "./runtime-config.types";

function readField(
  env: RuntimeConfigEnv,
  name: RuntimeConfigFieldName,
): string | undefined {
  const field = RUNTIME_CONFIG_FIELDS[name];

  for (const envName of field.envNames) {
    const value = env[envName];
    // A blank value counts as unset. Container images routinely declare every
    // variable, so without this an unconfigured deployment would silently get
    // "" instead of the fallback.
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return "fallback" in field ? field.fallback : undefined;
}

/**
 * Resolves the browser-facing config from an environment-shaped object.
 *
 * Indexing `env` dynamically is deliberate: Next inlines *static*
 * `process.env.NEXT_PUBLIC_*` reads into both the client and the server bundle
 * at build time, which is exactly the baking this module exists to avoid.
 */
export function readRuntimeConfig(env: RuntimeConfigEnv): TreasuryRuntimeConfig {
  const config: Record<string, string | undefined> = {};

  for (const name of RUNTIME_CONFIG_FIELD_NAMES) {
    config[name] = readField(env, name);
  }

  return config as TreasuryRuntimeConfig;
}
