import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, Option } from "commander";
import { PrivateKey } from "o1js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_MINA_NODE_URL = "http://127.0.0.1:3001/graphql";
const DEFAULT_ARCHIVE_NODE_URL = "http://127.0.0.1:8282";
const DEFAULT_COMPOSE_ARCHIVE_NODE_URL = "http://host.docker.internal:8282";
const DEFAULT_BROWSER_TREASURY_API_URL = "http://127.0.0.1:3100/api";
const DEFAULT_BROWSER_INDEXER_API_URL = "http://127.0.0.1:3100/indexer";
const DEFAULT_BROWSER_PROCESSOR_API_URL = "http://127.0.0.1:3100/processor";
const DEFAULT_BROWSER_MINA_NODE_URL = "http://127.0.0.1:3100/mina/graphql";
const DEFAULT_NETWORK_ID = "DEVNET";
const BROWSER_PROVER_ENV_KEYS = [
  "NEXT_PUBLIC_VOTE_REDUCER_VERIFICATION_KEY_JSON",
  "NEXT_PUBLIC_STAKING_LEDGER_TO_VOTING_LEDGER_VERIFICATION_KEY_JSON",
  "NEXT_PUBLIC_TREASURY_PROPOSAL_VERIFICATION_KEY_JSON",
  "NEXT_PUBLIC_EMPTY_VOTING_LEDGER_ROOT",
  "NEXT_PUBLIC_EMPTY_NULLIFIER_ROOT",
];

function parseBooleanString(value, key) {
  if (value !== "true" && value !== "false") {
    throw new Error(`--${key} must be either true or false`);
  }
  return value;
}

function parseIntegerString(value, key) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`--${key} must be a non-negative integer`);
  }
  return value;
}

function assertConcreteEndpoint(name, value) {
  assertEnvValue(name, value);
  if (/[<>]/.test(value) || /example/i.test(value)) {
    throw new Error(
      `${toKebabCase(name)} still looks like a placeholder: ${value}`,
    );
  }
}

function toKebabCase(value) {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function createProgram() {
  return new Command()
    .name("testnet:env")
    .description("Create matching testnet runtime and CLI env files.")
    .showHelpAfterError()
    .option(
      "--mina-node-url <url>",
      "Mina GraphQL URL used by CLI deployment",
      DEFAULT_MINA_NODE_URL,
    )
    .option(
      "--archive-node-url <url>",
      "Host-facing Archive GraphQL URL used by CLI/operator commands",
      DEFAULT_ARCHIVE_NODE_URL,
    )
    .option(
      "--compose-archive-node-url <url>",
      "Container-facing Archive GraphQL URL used by API/indexer/processor services",
      DEFAULT_COMPOSE_ARCHIVE_NODE_URL,
    )
    .option(
      "--compose-mina-node-upstream <url>",
      "Container-facing Mina GraphQL upstream root used by the Caddy proxy",
    )
    .option(
      "--next-public-mina-node-url <url>",
      "Browser-facing Mina GraphQL URL. Defaults to the same-origin Caddy proxy path.",
      DEFAULT_BROWSER_MINA_NODE_URL,
    )
    .option(
      "--next-public-treasury-api-url <url>",
      "Browser-facing Treasury API URL.",
      DEFAULT_BROWSER_TREASURY_API_URL,
    )
    .option(
      "--next-public-indexer-api-url <url>",
      "Browser-facing indexer API URL.",
      DEFAULT_BROWSER_INDEXER_API_URL,
    )
    .option(
      "--next-public-processor-api-url <url>",
      "Browser-facing processor API URL.",
      DEFAULT_BROWSER_PROCESSOR_API_URL,
    )
    .option(
      "--sender-private-key <key>",
      "Use an existing funded sender key instead of generating one",
    )
    .option("--network-id <id>", "Browser network label", DEFAULT_NETWORK_ID)
    .option(
      "--output <path>",
      "Runtime Compose env file path",
      "devops/.env.testnet",
    )
    .option(
      "--cli-output <path>",
      "CLI operator env file path",
      "apps/cli/.env.testnet",
    )
    .option(
      "--api-output <path>",
      "API/indexer/processor env file path",
      "apps/api/.env.testnet",
    )
    .option("--web-output <path>", "Web env file path", "apps/web/.env.testnet")
    .option(
      "--local-blockchain-output <path>",
      "Local blockchain env file path",
      "packages/local-blockchain/.env.testnet",
    )
    .option("--force", "Overwrite the output file if it already exists", false)
    .addOption(
      new Option("--proofs-enabled <true|false>", "Set PROOFS_ENABLED values")
        .argParser((value) => parseBooleanString(value, "proofs-enabled"))
        .default("true"),
    )
    .addOption(
      new Option(
        "--lifecycle-period-duration <n>",
        "Lifecycle period duration in slots",
      )
        .argParser((value) =>
          parseIntegerString(value, "lifecycle-period-duration"),
        )
        .default("7140"),
    )
    .addOption(
      new Option(
        "--treasury-deployed-at-slot <n>",
        "Treasury lifecycle start slot",
      )
        .argParser((value) =>
          parseIntegerString(value, "treasury-deployed-at-slot"),
        )
        .default("0"),
    )
    .addOption(
      new Option("--slot-duration-ms <n>", "Browser slot duration")
        .argParser((value) => parseIntegerString(value, "slot-duration-ms"))
        .default("180000"),
    )
    .option(
      "--postgres-password <value>",
      "Postgres password. Defaults to a generated hex secret.",
    )
    .addOption(
      new Option("--tx-fee <nanomina>", "Deployment fee")
        .argParser((value) => parseIntegerString(value, "tx-fee"))
        .default("1000000000"),
    )
    .option("--tx-memo <memo>", "Deployment memo", "testnet-deploy");
}

function parseProgramOptions(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const program = createProgram();
  program.parse(args, { from: "user" });
  return program.opts();
}

function generateKeypair() {
  const privateKey = PrivateKey.random();
  return {
    privateKey: privateKey.toBase58(),
    publicKey: privateKey.toPublicKey().toBase58(),
  };
}

function keypairFromPrivateKey(privateKeyBase58) {
  const privateKey = PrivateKey.fromBase58(privateKeyBase58);
  return {
    privateKey: privateKey.toBase58(),
    publicKey: privateKey.toPublicKey().toBase58(),
  };
}

function assertEnvValue(name, value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} cannot be empty`);
  }
  if (/[\r\n]/.test(value)) {
    throw new Error(`${name} cannot contain newlines`);
  }
}

function formatEnvLine(name, value) {
  assertEnvValue(name, value);
  return `${name}=${value}`;
}

function section(title) {
  return [``, `# ${title}`];
}

function buildMinaNodeProxyUpstream(minaNodeUrl) {
  const url = new URL(minaNodeUrl);
  const host =
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname === "0.0.0.0"
      ? "host.docker.internal"
      : url.hostname;
  const port = url.port ? `:${url.port}` : "";

  return `${url.protocol}//${host}${port}`;
}

function buildDevopsEnvFile(options, serviceSecrets) {
  const postgresUser = "postgres";
  const postgresPassword = serviceSecrets.postgresPassword;
  const postgresDb = "treasury_api";

  const lines = [
    "# Local testnet Compose infrastructure env.",
    "# Generated by pnpm testnet:env.",
    "# Runtime-only copy: keep infrastructure credentials here, but do not store Mina private keys.",
    ...section("Compose database settings"),
    formatEnvLine("POSTGRES_USER", postgresUser),
    formatEnvLine("POSTGRES_PASSWORD", postgresPassword),
    formatEnvLine("POSTGRES_DB", postgresDb),
    ...section("Local Caddy proxy ports"),
    formatEnvLine("BIND_ADDRESS", "127.0.0.1"),
    formatEnvLine("WEB_PORT", "3100"),
    formatEnvLine("PROXY_WEB_PORT", "3100"),
    formatEnvLine("PROXY_API_PORT", "4100"),
    formatEnvLine("PROXY_INDEXER_PORT", "4101"),
    formatEnvLine("PROXY_PROCESSOR_PORT", "4102"),
    formatEnvLine(
      "MINA_NODE_PROXY_UPSTREAM",
      options.composeMinaNodeUpstream ??
        buildMinaNodeProxyUpstream(options.minaNodeUrl),
    ),
    ...section("Public HTTPS proxy profile"),
    formatEnvLine("PROXY_PUBLIC_BIND_ADDRESS", "0.0.0.0"),
    formatEnvLine("PROXY_HTTP_PORT", "80"),
    formatEnvLine("PROXY_HTTPS_PORT", "443"),
    "# For public HTTPS, set LETSENCRYPT_EMAIL and PUBLIC_*_DOMAIN values before running pnpm testnet:up:public.",
    "# Optional staging CA: LETSENCRYPT_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory",
    ...section("Mounted SQLite data"),
    formatEnvLine("SQLITE_DATA_HOST_PATH", "./.data/testnet-sqlite"),
  ];

  return `${lines.join("\n")}\n`;
}

function buildApiEnvFile(options, roles, serviceSecrets) {
  const postgresUser = "postgres";
  const postgresDb = "treasury_api";
  const databasePassword = encodeURIComponent(serviceSecrets.postgresPassword);
  const databaseUrl = `postgres://${postgresUser}:${databasePassword}@postgres:5432/${postgresDb}`;

  const lines = [
    "# Local testnet API/indexer/processor env.",
    "# Generated by pnpm testnet:env.",
    "# Runtime-only copy: no Mina private keys.",
    ...section("Testnet infrastructure"),
    formatEnvLine("ARCHIVE_NODE_URL", options.composeArchiveNodeUrl),
    ...section("Database settings"),
    formatEnvLine("DATABASE_URL", databaseUrl),
    formatEnvLine("DATABASE_SCHEMA", "public"),
    ...section("Service-to-service URLs"),
    formatEnvLine("API_URL", "http://api:4000"),
    formatEnvLine("INDEXER_API_URL", "http://indexer-api:4001"),
    formatEnvLine("PROCESSOR_API_URL", "http://processor-api:4002"),
    formatEnvLine(
      "CORS_ALLOWED_ORIGINS",
      "http://127.0.0.1:3100,http://localhost:3100",
    ),
    ...section("Treasury lifecycle and proving settings"),
    formatEnvLine("LIFECYCLE_PERIOD_DURATION", options.lifecyclePeriodDuration),
    formatEnvLine("PROOFS_ENABLED", options.proofsEnabled),
    formatEnvLine("TREASURY_DEPLOYED_AT_SLOT", options.treasuryDeployedAtSlot),
    ...section("Polling and mounted SQLite data"),
    formatEnvLine("POLL_PENDING_INTERVAL_MS", "5000"),
    formatEnvLine("POLL_CANONICAL_INTERVAL_MS", "15000"),
    formatEnvLine("PROCESSOR_POLL_INTERVAL_MS", "2000"),
    formatEnvLine("SQLITE_DATA_DIRECTORY", "/data/sqlite"),
    ...section("Treasury contract"),
    formatEnvLine(
      "TREASURY_OWNER_CONTRACT_ADDRESS",
      roles.treasuryOwner.publicKey,
    ),
  ];

  return `${lines.join("\n")}\n`;
}

function buildWebEnvFile(options, roles, browserProverEnv = {}) {
  const nextPublicMinaNodeUrl =
    options.nextPublicMinaNodeUrl ?? DEFAULT_BROWSER_MINA_NODE_URL;

  const lines = [
    "# Local testnet web env.",
    "# Generated by pnpm testnet:env.",
    "# Browser-facing runtime values. Do not add real private keys.",
    ...section("Browser endpoints"),
    formatEnvLine(
      "NEXT_PUBLIC_TREASURY_API_URL",
      options.nextPublicTreasuryApiUrl,
    ),
    formatEnvLine(
      "NEXT_PUBLIC_INDEXER_API_URL",
      options.nextPublicIndexerApiUrl,
    ),
    formatEnvLine(
      "NEXT_PUBLIC_PROCESSOR_API_URL",
      options.nextPublicProcessorApiUrl,
    ),
    formatEnvLine("NEXT_PUBLIC_MINA_NODE_URL", nextPublicMinaNodeUrl),
    ...section("Treasury browser config"),
    formatEnvLine(
      "NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS",
      roles.treasuryOwner.publicKey,
    ),
    formatEnvLine(
      "NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION",
      options.lifecyclePeriodDuration,
    ),
    formatEnvLine("NEXT_PUBLIC_SLOT_DURATION_MS", options.slotDurationMs),
    formatEnvLine("NEXT_PUBLIC_PROOFS_ENABLED", options.proofsEnabled),
    formatEnvLine("NEXT_PUBLIC_NETWORK_ID", options.networkId),
    ...formatBrowserProverEnvLines(browserProverEnv),
  ];

  return `${lines.join("\n")}\n`;
}

function buildLocalBlockchainEnvFile(options) {
  const lines = [
    "# Local testnet local-blockchain env.",
    "# Generated by pnpm testnet:env.",
    formatEnvLine("MINA_NODE_PORT", "8080"),
    formatEnvLine("MINA_ARCHIVE_PORT", "8282"),
    formatEnvLine("MINA_NODE_HOST", "127.0.0.1"),
    formatEnvLine("PROOFS_ENABLED", options.proofsEnabled),
    formatEnvLine("MINA_NETWORK_ID", options.networkId),
  ];

  return `${lines.join("\n")}\n`;
}

function parseEnvFile(content) {
  const values = {};
  content.split(/\r?\n/).forEach((line) => {
    if (!line || line.trimStart().startsWith("#") || !line.includes("=")) {
      return;
    }

    const separatorIndex = line.indexOf("=");
    values[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1);
  });
  return values;
}

function pickBrowserProverEnv(values) {
  return Object.fromEntries(
    BROWSER_PROVER_ENV_KEYS.flatMap((key) =>
      typeof values[key] === "string" && values[key].trim().length > 0
        ? [[key, values[key]]]
        : [],
    ),
  );
}

async function readBrowserProverEnv(path) {
  try {
    return pickBrowserProverEnv(parseEnvFile(await readFile(path, "utf8")));
  } catch {
    return {};
  }
}

function formatBrowserProverEnvLines(browserProverEnv) {
  const lines = BROWSER_PROVER_ENV_KEYS.flatMap((key) =>
    typeof browserProverEnv[key] === "string"
      ? [formatEnvLine(key, browserProverEnv[key])]
      : [],
  );

  return lines.length === 0
    ? []
    : [
        ...section("Browser prover config preserved from previous runtime env"),
        ...lines,
      ];
}

function buildCliEnvFile(options, roles) {
  const multisigPublicKeys = roles.multisigParticipants
    .map((keypair) => keypair.publicKey)
    .join(",");

  const lines = [
    "# Local testnet CLI env.",
    "# Generated by pnpm testnet:env.",
    "# This file contains Mina private keys and is ignored by Git.",
    ...section("Testnet infrastructure"),
    formatEnvLine("MINA_NODE_URL", options.minaNodeUrl),
    formatEnvLine("ARCHIVE_NODE_URL", options.archiveNodeUrl),
    formatEnvLine("TREASURY_API_URL", "http://127.0.0.1:4100"),
    ...section("Treasury lifecycle and proving settings"),
    formatEnvLine("LIFECYCLE_PERIOD_DURATION", options.lifecyclePeriodDuration),
    formatEnvLine("PROOFS_ENABLED", options.proofsEnabled),
    ...section("Shared SQLite data"),
    formatEnvLine("SQLITE_DATA_DIRECTORY", "./.data/testnet-sqlite"),
    ...section("Transaction defaults"),
    formatEnvLine("TX_FEE", options.txFee),
    formatEnvLine("TX_WAIT", "true"),
    formatEnvLine("TX_MEMO", options.txMemo),
    formatEnvLine("ALLOW_DEPLOY_TO_EXISTING_ACCOUNT", "false"),
    ...section("Sender account"),
    formatEnvLine("SENDER_PRIVATE_KEY", roles.sender.privateKey),
    ...section("Treasury owner zkApp account"),
    formatEnvLine("TREASURY_OWNER_PRIVATE_KEY", roles.treasuryOwner.privateKey),
    formatEnvLine("TREASURY_OWNER_PUBLIC_KEY", roles.treasuryOwner.publicKey),
    formatEnvLine("TREASURY_WITHDRAWAL_PERMISSION", "proof"),
    formatEnvLine(
      "TREASURY_OWNER_CONTRACT_ADDRESS",
      roles.treasuryOwner.publicKey,
    ),
    formatEnvLine(
      "NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS",
      roles.treasuryOwner.publicKey,
    ),
    ...section("Pause controller zkApp account"),
    formatEnvLine(
      "PAUSE_CONTROLLER_PRIVATE_KEY",
      roles.pauseController.privateKey,
    ),
    formatEnvLine(
      "PAUSE_CONTROLLER_PUBLIC_KEY",
      roles.pauseController.publicKey,
    ),
    ...section("Multisig participants"),
  ];

  roles.multisigParticipants.forEach((keypair, index) => {
    const number = String(index + 1);
    lines.push(
      formatEnvLine(
        `MULTISIG_PARTICIPANT_${number}_PRIVATE_KEY`,
        keypair.privateKey,
      ),
      formatEnvLine(
        `MULTISIG_PARTICIPANT_${number}_PUBLIC_KEY`,
        keypair.publicKey,
      ),
    );
  });
  lines.push(
    formatEnvLine("MULTISIG_PARTICIPANTS_PUBLIC_KEYS", multisigPublicKeys),
  );

  return `${lines.join("\n")}\n`;
}

function createServiceSecrets(options) {
  return {
    postgresPassword:
      options.postgresPassword ?? randomBytes(24).toString("hex"),
  };
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const options = parseProgramOptions(process.argv.slice(2));
  options.nextPublicMinaNodeUrl =
    options.nextPublicMinaNodeUrl ?? DEFAULT_BROWSER_MINA_NODE_URL;
  assertConcreteEndpoint("minaNodeUrl", options.minaNodeUrl);
  assertConcreteEndpoint("archiveNodeUrl", options.archiveNodeUrl);
  assertConcreteEndpoint(
    "composeArchiveNodeUrl",
    options.composeArchiveNodeUrl,
  );
  if (options.composeMinaNodeUpstream) {
    assertConcreteEndpoint(
      "composeMinaNodeUpstream",
      options.composeMinaNodeUpstream,
    );
  }
  assertConcreteEndpoint(
    "nextPublicMinaNodeUrl",
    options.nextPublicMinaNodeUrl,
  );
  assertConcreteEndpoint(
    "nextPublicTreasuryApiUrl",
    options.nextPublicTreasuryApiUrl,
  );
  assertConcreteEndpoint(
    "nextPublicIndexerApiUrl",
    options.nextPublicIndexerApiUrl,
  );
  assertConcreteEndpoint(
    "nextPublicProcessorApiUrl",
    options.nextPublicProcessorApiUrl,
  );

  const outputPath = resolve(REPO_ROOT, options.output);
  const cliOutputPath = resolve(REPO_ROOT, options.cliOutput);
  const apiOutputPath = resolve(REPO_ROOT, options.apiOutput);
  const webOutputPath = resolve(REPO_ROOT, options.webOutput);
  const localBlockchainOutputPath = resolve(
    REPO_ROOT,
    options.localBlockchainOutput,
  );
  const outputPaths = [
    outputPath,
    cliOutputPath,
    apiOutputPath,
    webOutputPath,
    localBlockchainOutputPath,
  ];
  if (new Set(outputPaths).size !== outputPaths.length) {
    throw new Error(
      "Generated env output paths must point to different files.",
    );
  }

  for (const path of outputPaths) {
    if ((await fileExists(path)) && !options.force) {
      throw new Error(
        `${relative(REPO_ROOT, path)} already exists. Pass --force to overwrite generated env files.`,
      );
    }
  }

  const roles = {
    sender: options.senderPrivateKey
      ? keypairFromPrivateKey(options.senderPrivateKey)
      : generateKeypair(),
    treasuryOwner: generateKeypair(),
    pauseController: generateKeypair(),
    multisigParticipants: Array.from({ length: 5 }, () => generateKeypair()),
  };
  const serviceSecrets = createServiceSecrets(options);
  const browserProverEnv = {
    ...(await readBrowserProverEnv(outputPath)),
    ...(await readBrowserProverEnv(webOutputPath)),
  };

  const devopsContent = buildDevopsEnvFile(options, serviceSecrets);
  const apiContent = buildApiEnvFile(options, roles, serviceSecrets);
  const webContent = buildWebEnvFile(options, roles, browserProverEnv);
  const cliContent = buildCliEnvFile(options, roles);
  const localBlockchainContent = buildLocalBlockchainEnvFile(options);
  await Promise.all(
    outputPaths.map((path) => mkdir(dirname(path), { recursive: true })),
  );
  await writeFile(outputPath, devopsContent, { mode: 0o600 });
  await writeFile(apiOutputPath, apiContent, { mode: 0o600 });
  await writeFile(webOutputPath, webContent, { mode: 0o600 });
  await writeFile(cliOutputPath, cliContent, { mode: 0o600 });
  await writeFile(localBlockchainOutputPath, localBlockchainContent, {
    mode: 0o600,
  });

  console.log(`Wrote ${relative(REPO_ROOT, outputPath)}`);
  console.log(`Wrote ${relative(REPO_ROOT, apiOutputPath)}`);
  console.log(`Wrote ${relative(REPO_ROOT, webOutputPath)}`);
  console.log(`Wrote ${relative(REPO_ROOT, cliOutputPath)}`);
  console.log(`Wrote ${relative(REPO_ROOT, localBlockchainOutputPath)}`);
  if (Object.keys(browserProverEnv).length > 0) {
    console.log(
      `Preserved ${Object.keys(browserProverEnv).length} browser prover env values`,
    );
  }
  console.log(`Sender public key: ${roles.sender.publicKey}`);
  if (!options.senderPrivateKey) {
    console.log("Fund the printed sender public key before deployment.");
  } else {
    console.log("Using provided sender private key.");
  }
  console.log(`Treasury owner address: ${roles.treasuryOwner.publicKey}`);
  console.log(`Pause controller address: ${roles.pauseController.publicKey}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
