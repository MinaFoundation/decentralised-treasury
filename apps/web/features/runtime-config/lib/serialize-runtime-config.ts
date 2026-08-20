import type { TreasuryRuntimeConfig } from "./runtime-config.types";

/**
 * Renders the config as a JavaScript literal for the inline bootstrap script.
 *
 * Values are operator-supplied, so the sequences that could terminate the
 * `<script>` element or break the statement across lines are escaped. `<` alone
 * covers `</script>`; the line separators are valid in JSON but not inside a
 * JavaScript string literal.
 */
export function serializeRuntimeConfig(config: TreasuryRuntimeConfig): string {
  return JSON.stringify(config)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
