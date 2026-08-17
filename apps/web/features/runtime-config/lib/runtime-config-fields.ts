/**
 * Single source of truth for every browser-facing setting.
 *
 * `envNames` is checked in order and the first non-blank value wins, so the
 * `NEXT_PUBLIC_*` name keeps working while the shorter name already set for the
 * api/indexer/processor services acts as a fallback. A field with a `fallback`
 * is always a string at runtime; one without it may legitimately be missing.
 *
 * Adding a field here is enough to make it configurable at container start -
 * only `read-build-time-env.ts` needs the matching static reference.
 */
export const RUNTIME_CONFIG_FIELDS = {
  buildSha: {
    envNames: ["NEXT_PUBLIC_BUILD_SHA", "BUILD_SHA"],
    fallback: "unknown",
  },
  networkId: {
    envNames: ["NEXT_PUBLIC_NETWORK_ID"],
    fallback: "MAINNET",
  },
  apiUrl: {
    envNames: ["NEXT_PUBLIC_TREASURY_API_URL", "NEXT_PUBLIC_API_URL"],
    fallback: "http://127.0.0.1:3100/api",
  },
  indexerApiUrl: {
    envNames: ["NEXT_PUBLIC_INDEXER_API_URL"],
    fallback: "http://127.0.0.1:3100/indexer",
  },
  processorApiUrl: {
    envNames: ["NEXT_PUBLIC_PROCESSOR_API_URL"],
    fallback: "http://127.0.0.1:3100/processor",
  },
  minaNodeUrl: {
    envNames: ["NEXT_PUBLIC_MINA_NODE_URL"],
    fallback: "http://127.0.0.1:3100/mina/graphql",
  },
  treasuryOwnerContractAddress: {
    envNames: [
      "NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS",
      "TREASURY_OWNER_CONTRACT_ADDRESS",
    ],
  },
  lifecyclePeriodDuration: {
    envNames: [
      "NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION",
      "LIFECYCLE_PERIOD_DURATION",
    ],
  },
  slotDurationMs: {
    envNames: ["NEXT_PUBLIC_SLOT_DURATION_MS"],
  },
  proofsEnabled: {
    envNames: ["NEXT_PUBLIC_PROOFS_ENABLED"],
  },
  voteReducerVerificationKeyJson: {
    envNames: ["NEXT_PUBLIC_VOTE_REDUCER_VERIFICATION_KEY_JSON"],
  },
  stakingLedgerToVotingLedgerVerificationKeyJson: {
    envNames: [
      "NEXT_PUBLIC_STAKING_LEDGER_TO_VOTING_LEDGER_VERIFICATION_KEY_JSON",
    ],
  },
  treasuryProposalVerificationKeyJson: {
    envNames: ["NEXT_PUBLIC_TREASURY_PROPOSAL_VERIFICATION_KEY_JSON"],
  },
  emptyVotingLedgerRoot: {
    envNames: ["NEXT_PUBLIC_EMPTY_VOTING_LEDGER_ROOT"],
  },
  emptyNullifierRoot: {
    envNames: ["NEXT_PUBLIC_EMPTY_NULLIFIER_ROOT"],
  },
} as const;

export type RuntimeConfigFieldName = keyof typeof RUNTIME_CONFIG_FIELDS;

export const RUNTIME_CONFIG_FIELD_NAMES = Object.keys(
  RUNTIME_CONFIG_FIELDS,
) as RuntimeConfigFieldName[];
