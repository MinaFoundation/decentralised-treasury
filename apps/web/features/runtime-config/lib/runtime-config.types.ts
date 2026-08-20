import {
  RUNTIME_CONFIG_FIELDS,
  type RuntimeConfigFieldName,
} from "./runtime-config-fields";

export type RuntimeConfigEnv = Readonly<Record<string, string | undefined>>;

/**
 * Derived from `RUNTIME_CONFIG_FIELDS` so the shape can never drift from the
 * field table: a field declaring a `fallback` is always present, the rest keep
 * the `string | undefined` semantics of the environment variable they replace.
 */
export type TreasuryRuntimeConfig = {
  [Name in RuntimeConfigFieldName]: (typeof RUNTIME_CONFIG_FIELDS)[Name] extends {
    readonly fallback: string;
  }
    ? string
    : string | undefined;
};
