import type { RuntimeConfigEnv } from "./runtime-config.types";

/**
 * The one place static `process.env.NEXT_PUBLIC_*` reads survive, so Next can
 * still inline them for `next dev`, `vitest`, and any host that serves the app
 * without the runtime config script.
 *
 * Published images never depend on these values: the browser reads what
 * `RuntimeConfigScript` injected, and the server reads `process.env`
 * dynamically. Only `NEXT_PUBLIC_*` names belong here - the shorter aliases in
 * `RUNTIME_CONFIG_FIELDS` are resolved from the real environment at runtime and
 * are never available to the client bundle.
 *
 * Reads happen per call rather than once at module load so tests can stub
 * `process.env` after importing.
 */
export function readBuildTimeEnv(): RuntimeConfigEnv {
  return {
    NEXT_PUBLIC_BUILD_SHA: process.env.NEXT_PUBLIC_BUILD_SHA,
    NEXT_PUBLIC_NETWORK_ID: process.env.NEXT_PUBLIC_NETWORK_ID,
    NEXT_PUBLIC_TREASURY_API_URL: process.env.NEXT_PUBLIC_TREASURY_API_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_INDEXER_API_URL: process.env.NEXT_PUBLIC_INDEXER_API_URL,
    NEXT_PUBLIC_PROCESSOR_API_URL: process.env.NEXT_PUBLIC_PROCESSOR_API_URL,
    NEXT_PUBLIC_MINA_NODE_URL: process.env.NEXT_PUBLIC_MINA_NODE_URL,
    NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS:
      process.env.NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS,
    NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION:
      process.env.NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION,
    NEXT_PUBLIC_SLOT_DURATION_MS: process.env.NEXT_PUBLIC_SLOT_DURATION_MS,
    NEXT_PUBLIC_PROOFS_ENABLED: process.env.NEXT_PUBLIC_PROOFS_ENABLED,
    NEXT_PUBLIC_VOTE_REDUCER_VERIFICATION_KEY_JSON:
      process.env.NEXT_PUBLIC_VOTE_REDUCER_VERIFICATION_KEY_JSON,
    NEXT_PUBLIC_STAKING_LEDGER_TO_VOTING_LEDGER_VERIFICATION_KEY_JSON:
      process.env
        .NEXT_PUBLIC_STAKING_LEDGER_TO_VOTING_LEDGER_VERIFICATION_KEY_JSON,
    NEXT_PUBLIC_TREASURY_PROPOSAL_VERIFICATION_KEY_JSON:
      process.env.NEXT_PUBLIC_TREASURY_PROPOSAL_VERIFICATION_KEY_JSON,
    NEXT_PUBLIC_EMPTY_VOTING_LEDGER_ROOT:
      process.env.NEXT_PUBLIC_EMPTY_VOTING_LEDGER_ROOT,
    NEXT_PUBLIC_EMPTY_NULLIFIER_ROOT:
      process.env.NEXT_PUBLIC_EMPTY_NULLIFIER_ROOT,
  };
}
