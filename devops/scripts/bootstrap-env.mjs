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
  "NEXT_PUBLIC_INLINE_SIGNER_PRIVATE_KEYS_JSON",
];

const COMMON_OUTPUTS = [
  ["devops", "devops"],
  ["api", "apps/api"],
  ["web", "apps/web"],
  ["cli", "apps/cli"],
];

const FAMILY_CONFIG = {
  testnet: {
    label: "Local Mina testnet",
    postgresDb: "treasury_api",
    outputs: COMMON_OUTPUTS,
  },
  "local-blockchain": {
    label: "Local blockchain simulator",
    postgresDb: "treasury_local_blockchain",
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
    freshKeys: false,
    overwriteSecrets: false,
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--sender-private-key") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--sender-private-key requires a value");
      }
      options.senderPrivateKey = value;
      index += 1;
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
      `Usage: pnpm env:bootstrap <${families}> [-- --sender-private-key <key>] [--fresh-keys] [--overwrite-secrets]`,
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

function createPlaceholderValues({ config, existing, options }) {
  const existingCli = existing.cli;
  const existingDevops = existing.devops;
  const existingWeb = existing.web;

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
  });

  values.INLINE_SIGNER_PRIVATE_KEYS_JSON =
    existingWeb.NEXT_PUBLIC_INLINE_SIGNER_PRIVATE_KEYS_JSON ??
    JSON.stringify(voters.map((keypair) => keypair.privateKey));

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
