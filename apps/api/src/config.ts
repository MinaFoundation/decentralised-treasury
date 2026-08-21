import { PublicKey } from "o1js";

const DEFAULT_DATABASE_SCHEMA = "public";
const DEFAULT_API_PORT = 4_000;
const DEFAULT_INDEXER_API_PORT = 4_001;
const DEFAULT_POLL_PENDING_INTERVAL_MS = 5_000;
const DEFAULT_POLL_CANONICAL_INTERVAL_MS = 15_000;
const DEFAULT_EVENTS_BLOCK_BATCH_SIZE = 10;
const DEFAULT_EVENTS_START_HEIGHT = 0;
const DEFAULT_PENDING_OVERLAP_BLOCKS = 20;
const DEFAULT_CANONICAL_OVERLAP_BLOCKS = 100;
const DEFAULT_ORPHAN_DEPTH_BLOCKS = 30;
const DEFAULT_API_PAGE_LIMIT_DEFAULT = 50;
const DEFAULT_API_PAGE_LIMIT_MAX = 200;
const DEFAULT_PROCESSOR_NAME = "proposal-processor";
const DEFAULT_PROCESSOR_POLL_INTERVAL_MS = 2_000;
const DEFAULT_PROCESSOR_BATCH_SIZE = 200;
const DEFAULT_PROCESSOR_API_PORT = 4_002;
const DEFAULT_ARCHIVE_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_PROPOSAL_CONTENT_MAX_CHARS = 32 * 1024;
const DEFAULT_CORS_ALLOWED_ORIGINS = [
  "http://127.0.0.1:3100",
  "http://localhost:3100",
];

export interface ApiConfig {
  archiveNodeUrl: string;
  treasuryOwnerContractAddress: string;
  knownEventTypes: string[];
  databaseUrl: string;
  databaseSchema: string;
  apiPort: number;
  apiUrl: string;
  indexerApiPort: number;
  indexerApiUrl: string;
  apiPageLimitDefault: number;
  apiPageLimitMax: number;
  pollPendingIntervalMs: number;
  pollCanonicalIntervalMs: number;
  eventsBlockBatchSize: number;
  eventsStartHeight: number;
  pendingOverlapBlocks: number;
  canonicalOverlapBlocks: number;
  orphanDepthBlocks: number;
  processorName: string;
  processorPollIntervalMs: number;
  processorBatchSize: number;
  processorApiPort: number;
  processorApiUrl: string;
  archiveRequestTimeoutMs: number;
  proposalContentMaxChars: number;
  corsAllowedOrigins: string[];
}

interface ContractInstanceWithEventsMap {
  events?: Record<string, unknown>;
}

type ContractClassWithEventsMap = new (
  ...args: unknown[]
) => ContractInstanceWithEventsMap;

interface LoadIndexerConfigOptions {
  treasuryOwnerContractClass: ContractClassWithEventsMap;
}

function readRequiredEnv(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readPositiveIntEnv(
  names: string[],
  env: NodeJS.ProcessEnv,
  fallback: number,
): number {
  for (const name of names) {
    const raw = env[name];
    if (!raw) {
      continue;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
    return parsed;
  }
  return fallback;
}

function readNonNegativeIntEnv(
  names: string[],
  env: NodeJS.ProcessEnv,
  fallback: number,
): number {
  for (const name of names) {
    const raw = env[name];
    if (!raw) {
      continue;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`${name} must be a non-negative integer`);
    }
    return parsed;
  }
  return fallback;
}

function readOptionalEnv(
  name: string,
  env: NodeJS.ProcessEnv,
  fallback: string,
): string {
  return env[name] || fallback;
}

function readEventTypesFromContractClass(
  contractClass: ContractClassWithEventsMap,
  contractAddress: string,
): string[] {
  const contractPublicKey = PublicKey.fromBase58(contractAddress);
  const contract = new contractClass(contractPublicKey);
  const eventEntries = contract.events;
  if (!eventEntries || typeof eventEntries !== "object") {
    throw new Error(
      "Configured treasury owner contract class does not expose an events map",
    );
  }

  const eventTypes = Object.keys(eventEntries)
    .map((eventType) => eventType.trim())
    .filter((eventType) => eventType.length > 0)
    // Archive event discriminators are encoded using a stable lexical ordering.
    .sort((left, right) => left.localeCompare(right));
  if (!eventTypes.length) {
    throw new Error(
      "Configured treasury owner contract class exposes an empty events map",
    );
  }
  return Array.from(new Set(eventTypes));
}

function readStringListEnv(
  name: string,
  env: NodeJS.ProcessEnv,
  fallback: string[],
): string[] {
  const raw = env[name];
  if (!raw) {
    return fallback;
  }
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function loadApiConfig(
  options: LoadIndexerConfigOptions,
  env: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const treasuryOwnerContractAddress = readRequiredEnv(
    "TREASURY_OWNER_CONTRACT_ADDRESS",
    env,
  );

  const knownEventTypes = readEventTypesFromContractClass(
    options.treasuryOwnerContractClass,
    treasuryOwnerContractAddress,
  );
  const apiPort = readPositiveIntEnv(["API_PORT"], env, DEFAULT_API_PORT);
  const indexerApiPort = readPositiveIntEnv(
    ["INDEXER_API_PORT"],
    env,
    DEFAULT_INDEXER_API_PORT,
  );
  const processorApiPort = readPositiveIntEnv(
    ["PROCESSOR_API_PORT"],
    env,
    DEFAULT_PROCESSOR_API_PORT,
  );
  const apiPageLimitDefault = readPositiveIntEnv(
    ["API_PAGE_LIMIT_DEFAULT"],
    env,
    DEFAULT_API_PAGE_LIMIT_DEFAULT,
  );
  const apiPageLimitMax = readPositiveIntEnv(
    ["API_PAGE_LIMIT_MAX"],
    env,
    DEFAULT_API_PAGE_LIMIT_MAX,
  );
  if (apiPageLimitDefault > apiPageLimitMax) {
    throw new Error(
      "API_PAGE_LIMIT_DEFAULT cannot be greater than API_PAGE_LIMIT_MAX",
    );
  }

  return {
    archiveNodeUrl: readRequiredEnv("ARCHIVE_NODE_URL", env),
    treasuryOwnerContractAddress,
    knownEventTypes,
    databaseUrl: readRequiredEnv("DATABASE_URL", env),
    databaseSchema: readOptionalEnv(
      "DATABASE_SCHEMA",
      env,
      DEFAULT_DATABASE_SCHEMA,
    ),
    apiPort,
    apiUrl: readOptionalEnv("API_URL", env, `http://127.0.0.1:${apiPort}`),
    indexerApiPort,
    indexerApiUrl: readOptionalEnv(
      "INDEXER_API_URL",
      env,
      `http://127.0.0.1:${indexerApiPort}`,
    ),
    apiPageLimitDefault,
    apiPageLimitMax,
    pollPendingIntervalMs: readPositiveIntEnv(
      ["POLL_PENDING_INTERVAL_MS", "POLL_EVENTS_INTERVAL_MS"],
      env,
      DEFAULT_POLL_PENDING_INTERVAL_MS,
    ),
    pollCanonicalIntervalMs: readPositiveIntEnv(
      ["POLL_CANONICAL_INTERVAL_MS", "POLL_EVENTS_INTERVAL_MS"],
      env,
      DEFAULT_POLL_CANONICAL_INTERVAL_MS,
    ),
    eventsBlockBatchSize: readPositiveIntEnv(
      ["EVENTS_BLOCK_BATCH_SIZE"],
      env,
      DEFAULT_EVENTS_BLOCK_BATCH_SIZE,
    ),
    // First block the indexer looks at on a cold start. Defaults to 0, which
    // walks the whole chain: on a long-lived network that is hundreds of
    // thousands of archive queries returning nothing, because no treasury event
    // can predate the treasury's own deployment. Set it to the deployment block.
    eventsStartHeight: readNonNegativeIntEnv(
      ["EVENTS_START_HEIGHT"],
      env,
      DEFAULT_EVENTS_START_HEIGHT,
    ),
    pendingOverlapBlocks: readNonNegativeIntEnv(
      ["PENDING_OVERLAP_BLOCKS"],
      env,
      DEFAULT_PENDING_OVERLAP_BLOCKS,
    ),
    canonicalOverlapBlocks: readNonNegativeIntEnv(
      ["CANONICAL_OVERLAP_BLOCKS"],
      env,
      DEFAULT_CANONICAL_OVERLAP_BLOCKS,
    ),
    orphanDepthBlocks: readPositiveIntEnv(
      ["ORPHAN_DEPTH_BLOCKS"],
      env,
      DEFAULT_ORPHAN_DEPTH_BLOCKS,
    ),
    processorName: readOptionalEnv(
      "PROCESSOR_NAME",
      env,
      DEFAULT_PROCESSOR_NAME,
    ),
    processorPollIntervalMs: readPositiveIntEnv(
      ["PROCESSOR_POLL_INTERVAL_MS"],
      env,
      DEFAULT_PROCESSOR_POLL_INTERVAL_MS,
    ),
    processorBatchSize: readPositiveIntEnv(
      ["PROCESSOR_BATCH_SIZE"],
      env,
      DEFAULT_PROCESSOR_BATCH_SIZE,
    ),
    processorApiPort,
    processorApiUrl: readOptionalEnv(
      "PROCESSOR_API_URL",
      env,
      `http://127.0.0.1:${processorApiPort}`,
    ),
    archiveRequestTimeoutMs: readPositiveIntEnv(
      ["ARCHIVE_REQUEST_TIMEOUT_MS"],
      env,
      DEFAULT_ARCHIVE_REQUEST_TIMEOUT_MS,
    ),
    proposalContentMaxChars: readPositiveIntEnv(
      ["PROPOSAL_CONTENT_MAX_CHARS", "PROPOSAL_CONTENT_MAX_BYTES"],
      env,
      DEFAULT_PROPOSAL_CONTENT_MAX_CHARS,
    ),
    corsAllowedOrigins: readStringListEnv(
      "CORS_ALLOWED_ORIGINS",
      env,
      DEFAULT_CORS_ALLOWED_ORIGINS,
    ),
  };
}

export const loadIndexerConfig = loadApiConfig;
