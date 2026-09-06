import { createElement } from "react";

export interface BackofficeRuntimeConfig {
  buildSha: string;
  networkId: string;
  apiUrl: string;
  indexerApiUrl: string;
  processorApiUrl: string;
  minaNodeUrl: string;
  treasuryOwnerAddress?: string;
  multisigParticipants?: string;
  lifecyclePeriodDuration?: string;
  voteReducerVerificationKeyJson?: string;
  stakingLedgerToVotingLedgerVerificationKeyJson?: string;
  treasuryProposalVerificationKeyJson?: string;
  emptyVotingLedgerRoot?: string;
  emptyNullifierRoot?: string;
}

export const RUNTIME_CONFIG_WINDOW_KEY = "__TREASURY_BACKOFFICE_CONFIG__";

const fields = {
  buildSha: {
    names: ["NEXT_PUBLIC_BUILD_SHA", "BUILD_SHA"],
    fallback: "unknown",
  },
  networkId: {
    names: ["NEXT_PUBLIC_NETWORK_ID"],
    fallback: "mainnet",
  },
  apiUrl: {
    names: ["NEXT_PUBLIC_TREASURY_API_URL", "NEXT_PUBLIC_API_URL"],
    fallback: "",
  },
  indexerApiUrl: {
    names: ["NEXT_PUBLIC_INDEXER_API_URL"],
    fallback: "",
  },
  processorApiUrl: {
    names: ["NEXT_PUBLIC_PROCESSOR_API_URL"],
    fallback: "",
  },
  minaNodeUrl: {
    names: ["NEXT_PUBLIC_MINA_NODE_URL"],
    fallback: "http://127.0.0.1:3200/mina/graphql",
  },
  treasuryOwnerAddress: {
    names: [
      "NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS",
      "TREASURY_OWNER_CONTRACT_ADDRESS",
    ],
  },
  multisigParticipants: {
    names: ["NEXT_PUBLIC_MULTISIG_PARTICIPANTS_PUBLIC_KEYS"],
  },
  lifecyclePeriodDuration: {
    names: ["NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION"],
  },
  voteReducerVerificationKeyJson: {
    names: ["NEXT_PUBLIC_VOTE_REDUCER_VERIFICATION_KEY_JSON"],
  },
  stakingLedgerToVotingLedgerVerificationKeyJson: {
    names: [
      "NEXT_PUBLIC_STAKING_LEDGER_TO_VOTING_LEDGER_VERIFICATION_KEY_JSON",
    ],
  },
  treasuryProposalVerificationKeyJson: {
    names: ["NEXT_PUBLIC_TREASURY_PROPOSAL_VERIFICATION_KEY_JSON"],
  },
  emptyVotingLedgerRoot: {
    names: ["NEXT_PUBLIC_EMPTY_VOTING_LEDGER_ROOT"],
  },
  emptyNullifierRoot: {
    names: ["NEXT_PUBLIC_EMPTY_NULLIFIER_ROOT"],
  },
} as const;

type RuntimeEnv = Readonly<Record<string, string | undefined>>;

function readConfig(env: RuntimeEnv): BackofficeRuntimeConfig {
  const result: Record<string, string | undefined> = {};
  for (const [key, definition] of Object.entries(fields)) {
    const value = definition.names
      .map((name) => env[name])
      .find((candidate) => candidate?.trim());
    result[key] = value ?? ("fallback" in definition ? definition.fallback : undefined);
  }
  return result as unknown as BackofficeRuntimeConfig;
}

function readBuildTimeEnv(): RuntimeEnv {
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
    NEXT_PUBLIC_MULTISIG_PARTICIPANTS_PUBLIC_KEYS:
      process.env.NEXT_PUBLIC_MULTISIG_PARTICIPANTS_PUBLIC_KEYS,
    NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION:
      process.env.NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION,
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

export function getRuntimeConfig(): BackofficeRuntimeConfig {
  if (typeof window === "undefined") return readConfig(process.env);
  const scope = window as typeof window & {
    [RUNTIME_CONFIG_WINDOW_KEY]?: BackofficeRuntimeConfig;
  };
  return scope[RUNTIME_CONFIG_WINDOW_KEY] ?? readConfig(readBuildTimeEnv());
}

export function getRuntimeConfigError(
  config: BackofficeRuntimeConfig,
): string | null {
  if (!config.treasuryOwnerAddress?.trim()) {
    return "NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS is required.";
  }
  const participants = (config.multisigParticipants ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (participants.length !== 5) {
    return "NEXT_PUBLIC_MULTISIG_PARTICIPANTS_PUBLIC_KEYS must contain five ordered public keys.";
  }
  return null;
}

export function installRuntimeConfig(config: BackofficeRuntimeConfig): void {
  const scope = globalThis as typeof globalThis & {
    [RUNTIME_CONFIG_WINDOW_KEY]?: BackofficeRuntimeConfig;
  };
  scope[RUNTIME_CONFIG_WINDOW_KEY] = config;
}

export function RuntimeConfigScript() {
  const serialized = JSON.stringify(getRuntimeConfig())
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return createElement("script", {
    id: "backoffice-runtime-config",
    dangerouslySetInnerHTML: {
      __html: `window.${RUNTIME_CONFIG_WINDOW_KEY}=${serialized};`,
    },
  });
}
