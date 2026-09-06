import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrivateKey } from "o1js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const BROWSER_PROVER_ENV_KEYS = [
  "NEXT_PUBLIC_VOTE_REDUCER_VERIFICATION_KEY_JSON",
  "NEXT_PUBLIC_STAKING_LEDGER_TO_VOTING_LEDGER_VERIFICATION_KEY_JSON",
  "NEXT_PUBLIC_TREASURY_PROPOSAL_VERIFICATION_KEY_JSON",
  "NEXT_PUBLIC_EMPTY_VOTING_LEDGER_ROOT",
  "NEXT_PUBLIC_EMPTY_NULLIFIER_ROOT",
];

const COMMON_OUTPUTS = [
  ["devops", "devops"],
  ["api", "apps/api"],
  ["backoffice", "apps/backoffice"],
  ["web", "apps/web"],
  ["cli", "apps/cli"],
];

const FAMILY_CONFIG = {
  testnet: {
    label: "Local Mina testnet",
    postgresDb: "treasury_api",
    endpoints: {
      minaNodeUrl: "http://127.0.0.1:3001/graphql",
      archiveNodeUrl: "http://127.0.0.1:8282",
      composeMinaNodeUpstream: "http://host.docker.internal:3001",
      composeArchiveNodeUrl: "http://host.docker.internal:8282",
      nextPublicTreasuryApiUrl: "http://127.0.0.1:3100/api",
      nextPublicIndexerApiUrl: "http://127.0.0.1:3100/indexer",
      nextPublicProcessorApiUrl: "http://127.0.0.1:3100/processor",
      nextPublicMinaNodeUrl: "http://127.0.0.1:3100/mina/graphql",
    },
    outputs: COMMON_OUTPUTS,
  },
  "local-blockchain": {
    label: "Local blockchain simulator",
    postgresDb: "treasury_local_blockchain",
    endpoints: {
      minaNodeUrl: "http://127.0.0.1:8080/graphql",
      archiveNodeUrl: "http://127.0.0.1:8282/graphql",
      composeMinaNodeUpstream: "http://host.docker.internal:8080",
      composeArchiveNodeUrl: "http://host.docker.internal:8282/graphql",
      nextPublicTreasuryApiUrl: "http://127.0.0.1:3100/api",
      nextPublicIndexerApiUrl: "http://127.0.0.1:3100/indexer",
      nextPublicProcessorApiUrl: "http://127.0.0.1:3100/processor",
      nextPublicMinaNodeUrl: "http://127.0.0.1:3100/mina/graphql",
    },
    outputs: [
      ...COMMON_OUTPUTS,
      ["local-blockchain", "packages/local-blockchain"],
    ],
  },
};

function parseArgs(argv) {
  const args = argv.filter((arg) => arg !== "--");
  const options = {
    family: args[0],
    senderPrivateKey: undefined,
    minaNodeUrl: undefined,
    archiveNodeUrl: undefined,
    composeMinaNodeUpstream: undefined,
    composeArchiveNodeUrl: undefined,
    nextPublicTreasuryApiUrl: undefined,
    nextPublicIndexerApiUrl: undefined,
    nextPublicProcessorApiUrl: undefined,
    nextPublicMinaNodeUrl: undefined,
    freshKeys: false,
    overwriteSecrets: false,
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    const readValue = () => {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return value;
    };
    if (arg === "--sender-private-key") {
      options.senderPrivateKey = readValue();
      continue;
    }
    if (arg === "--mina-node-url") {
      options.minaNodeUrl = readValue();
      continue;
    }
    if (arg === "--archive-node-url") {
      options.archiveNodeUrl = readValue();
      continue;
    }
    if (arg === "--compose-mina-node-upstream") {
      options.composeMinaNodeUpstream = readValue();
      continue;
    }
    if (arg === "--compose-archive-node-url") {
      options.composeArchiveNodeUrl = readValue();
      continue;
    }
    if (arg === "--next-public-treasury-api-url") {
      options.nextPublicTreasuryApiUrl = readValue();
      continue;
    }
    if (arg === "--next-public-indexer-api-url") {
      options.nextPublicIndexerApiUrl = readValue();
      continue;
    }
    if (arg === "--next-public-processor-api-url") {
      options.nextPublicProcessorApiUrl = readValue();
      continue;
    }
    if (arg === "--next-public-mina-node-url") {
      options.nextPublicMinaNodeUrl = readValue();
      continue;
    }
    if (arg === "--fresh-keys") {
      options.freshKeys = true;
      continue;
    }
    if (arg === "--overwrite-secrets") {
      options.overwriteSecrets = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.family || !FAMILY_CONFIG[options.family]) {
    const families = Object.keys(FAMILY_CONFIG).join(" | ");
    throw new Error(
      `Usage: pnpm env:bootstrap <${families}> [-- --sender-private-key <key>] [--mina-node-url <url>] [--archive-node-url <url>] [--compose-mina-node-upstream <url>] [--compose-archive-node-url <url>] [--next-public-treasury-api-url <url>] [--next-public-indexer-api-url <url>] [--next-public-processor-api-url <url>] [--next-public-mina-node-url <url>] [--fresh-keys] [--overwrite-secrets]`,
    );
  }

  if (options.senderPrivateKey === "") {
    throw new Error("--sender-private-key cannot be empty");
  }

  return options;
}

function keypairFromPrivateKey(privateKeyBase58) {
  const privateKey = PrivateKey.fromBase58(privateKeyBase58);
  return {
    privateKey: privateKey.toBase58(),
    publicKey: privateKey.toPublicKey().toBase58(),
  };
}

function generateKeypair() {
  return keypairFromPrivateKey(PrivateKey.random().toBase58());
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

async function readEnvValues(path) {
  try {
    return parseEnvFile(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

async function readText(path) {
  return readFile(path, "utf8");
}

function chooseExistingOrGenerated(
  existingValues,
  privateKeyName,
  publicKeyName,
  freshKeys,
) {
  if (!freshKeys && existingValues[privateKeyName]) {
    return keypairFromPrivateKey(existingValues[privateKeyName]);
  }
  return generateKeypair();
}

function buildDatabaseUrl({ postgresUser, postgresPassword, postgresDb }) {
  return `postgres://${postgresUser}:${encodeURIComponent(postgresPassword)}@postgres:5432/${postgresDb}`;
}

function firstNonEmpty(...values) {
  return values.find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

function resolveEndpointValues({ config, options }) {
  const defaults = config.endpoints;

  return {
    minaNodeUrl: firstNonEmpty(
      options.minaNodeUrl,
      process.env.MINA_NODE_URL,
      defaults.minaNodeUrl,
    ),
    archiveNodeUrl: firstNonEmpty(
      options.archiveNodeUrl,
      process.env.ARCHIVE_NODE_URL,
      defaults.archiveNodeUrl,
    ),
    composeMinaNodeUpstream: firstNonEmpty(
      options.composeMinaNodeUpstream,
      process.env.MINA_NODE_PROXY_UPSTREAM,
      defaults.composeMinaNodeUpstream,
    ),
    composeArchiveNodeUrl: firstNonEmpty(
      options.composeArchiveNodeUrl,
      process.env.COMPOSE_ARCHIVE_NODE_URL,
      defaults.composeArchiveNodeUrl,
    ),
    nextPublicTreasuryApiUrl: firstNonEmpty(
      options.nextPublicTreasuryApiUrl,
      process.env.NEXT_PUBLIC_TREASURY_API_URL,
      process.env.NEXT_PUBLIC_API_URL,
      defaults.nextPublicTreasuryApiUrl,
    ),
    nextPublicIndexerApiUrl: firstNonEmpty(
      options.nextPublicIndexerApiUrl,
      process.env.NEXT_PUBLIC_INDEXER_API_URL,
      defaults.nextPublicIndexerApiUrl,
    ),
    nextPublicProcessorApiUrl: firstNonEmpty(
      options.nextPublicProcessorApiUrl,
      process.env.NEXT_PUBLIC_PROCESSOR_API_URL,
      defaults.nextPublicProcessorApiUrl,
    ),
    nextPublicMinaNodeUrl: firstNonEmpty(
      options.nextPublicMinaNodeUrl,
      process.env.NEXT_PUBLIC_MINA_NODE_URL,
      defaults.nextPublicMinaNodeUrl,
    ),
  };
}

function createPlaceholderValues({ config, existing, options }) {
  const existingCli = existing.cli;
  const existingDevops = existing.devops;
  const existingWeb = existing.web;
  const existingBackoffice = existing.backoffice ?? {};
  const endpoints = resolveEndpointValues({ config, options });

  const postgresUser = "postgres";
  const postgresPassword =
    !options.overwriteSecrets && existingDevops.POSTGRES_PASSWORD
      ? existingDevops.POSTGRES_PASSWORD
      : randomBytes(24).toString("hex");
  const postgresDb = config.postgresDb;

  const sender = options.senderPrivateKey
    ? keypairFromPrivateKey(options.senderPrivateKey)
    : chooseExistingOrGenerated(
        existingCli,
        "SENDER_PRIVATE_KEY",
        "SENDER_PUBLIC_KEY",
        options.freshKeys,
      );
  const treasuryOwner = chooseExistingOrGenerated(
    existingCli,
    "TREASURY_OWNER_PRIVATE_KEY",
    "TREASURY_OWNER_PUBLIC_KEY",
    options.freshKeys,
  );
  const pauseController = chooseExistingOrGenerated(
    existingCli,
    "PAUSE_CONTROLLER_PRIVATE_KEY",
    "PAUSE_CONTROLLER_PUBLIC_KEY",
    options.freshKeys,
  );
  const multisigParticipants = Array.from({ length: 5 }, (_, index) =>
    chooseExistingOrGenerated(
      existingCli,
      `MULTISIG_PARTICIPANT_${index + 1}_PRIVATE_KEY`,
      `MULTISIG_PARTICIPANT_${index + 1}_PUBLIC_KEY`,
      options.freshKeys,
    ),
  );
  const voters = Array.from({ length: 5 }, (_, index) =>
    chooseExistingOrGenerated(
      existingCli,
      `VOTER${index + 1}_PRIVATE_KEY`,
      `VOTER${index + 1}_PUBLIC_KEY`,
      options.freshKeys,
    ),
  );

  const values = {
    POSTGRES_PASSWORD: postgresPassword,
    DATABASE_URL: buildDatabaseUrl({
      postgresUser,
      postgresPassword,
      postgresDb,
    }),
    MINA_NODE_URL: endpoints.minaNodeUrl,
    ARCHIVE_NODE_URL: endpoints.archiveNodeUrl,
    MINA_NODE_PROXY_UPSTREAM: endpoints.composeMinaNodeUpstream,
    COMPOSE_ARCHIVE_NODE_URL: endpoints.composeArchiveNodeUrl,
    NEXT_PUBLIC_TREASURY_API_URL: endpoints.nextPublicTreasuryApiUrl,
    NEXT_PUBLIC_INDEXER_API_URL: endpoints.nextPublicIndexerApiUrl,
    NEXT_PUBLIC_PROCESSOR_API_URL: endpoints.nextPublicProcessorApiUrl,
    NEXT_PUBLIC_MINA_NODE_URL: endpoints.nextPublicMinaNodeUrl,
    SENDER_PRIVATE_KEY: sender.privateKey,
    SENDER_PUBLIC_KEY: sender.publicKey,
    TREASURY_OWNER_PRIVATE_KEY: treasuryOwner.privateKey,
    TREASURY_OWNER_PUBLIC_KEY: treasuryOwner.publicKey,
    PAUSE_CONTROLLER_PRIVATE_KEY: pauseController.privateKey,
    PAUSE_CONTROLLER_PUBLIC_KEY: pauseController.publicKey,
    MULTISIG_PARTICIPANTS_PUBLIC_KEYS: multisigParticipants
      .map((keypair) => keypair.publicKey)
      .join(","),
  };

  multisigParticipants.forEach((keypair, index) => {
    const number = index + 1;
    values[`MULTISIG_PARTICIPANT_${number}_PRIVATE_KEY`] = keypair.privateKey;
    values[`MULTISIG_PARTICIPANT_${number}_PUBLIC_KEY`] = keypair.publicKey;
  });

  voters.forEach((keypair, index) => {
    const number = index + 1;
    values[`VOTER${number}_PRIVATE_KEY`] = keypair.privateKey;
    values[`VOTER${number}_PUBLIC_KEY`] = keypair.publicKey;
  });

  BROWSER_PROVER_ENV_KEYS.forEach((key) => {
    values[`PRESERVE_${key}`] = existingWeb[key] ?? "";
    values[`PRESERVE_BACKOFFICE_${key}`] =
      firstNonEmpty(existingBackoffice[key], existingWeb[key]) ?? "";
  });

  return values;
}

function replacePlaceholders(template, values) {
  return template.replace(/__([A-Z0-9_]+)__/g, (match, key) => {
    if (!(key in values)) {
      throw new Error(`Missing placeholder value for ${match}`);
    }
    return values[key];
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = FAMILY_CONFIG[options.family];
  const suffix = options.family;
  const paths = Object.fromEntries(
    config.outputs.map(([name, directory]) => [
      name,
      {
        example: resolve(REPO_ROOT, directory, `.env.${suffix}.example`),
        output: resolve(REPO_ROOT, directory, `.env.${suffix}`),
      },
    ]),
  );

  const existing = {};
  await Promise.all(
    Object.entries(paths).map(async ([name, pathInfo]) => {
      existing[name] = await readEnvValues(pathInfo.output);
    }),
  );

  const values = createPlaceholderValues({ config, existing, options });

  for (const [name, pathInfo] of Object.entries(paths)) {
    const template = await readText(pathInfo.example);
    const content = replacePlaceholders(template, values);
    await mkdir(dirname(pathInfo.output), { recursive: true });
    await writeFile(pathInfo.output, content, { mode: 0o600 });
    console.log(`Wrote ${relative(REPO_ROOT, pathInfo.output)}`);
  }

  console.log(`Bootstrapped ${config.label} env family.`);
  console.log(`Sender public key: ${values.SENDER_PUBLIC_KEY}`);
  console.log(`Treasury owner address: ${values.TREASURY_OWNER_PUBLIC_KEY}`);
  console.log(
    `Pause controller address: ${values.PAUSE_CONTROLLER_PUBLIC_KEY}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
