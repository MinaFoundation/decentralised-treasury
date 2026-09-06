import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { Command } from "commander";
import { MinaApp } from "@zondax/ledger-mina-js";
import { LedgerHashBase58, PrivateKey, PublicKey } from "o1js";
import { RedisMemoryServer } from "redis-memory-server";
import { createProgram } from "../../src/cli.js";
import {
  logTestStep,
  runCli,
  sleep,
  spawnCliWorker,
  waitForExit,
} from "../utils/cli-test-utils.js";

const TEST_NAME = "ledger-cli-device.e2e";
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const LOCAL_BLOCKCHAIN_DIRECTORY = join(
  REPOSITORY_ROOT,
  "packages/local-blockchain",
);
const LEDGER_TEMPLATE_PATH = fileURLToPath(
  new URL(
    "../../../../packages/sdk/test/test-ledger-mini.json",
    import.meta.url,
  ),
);
const LIFECYCLE_ID = "0";
const LIFECYCLE_PERIOD_DURATION = 20;
const TX_FEE = "100000000";
const FUND_LEDGER_AMOUNT = "500000000000";
const TREASURY_FUNDING_AMOUNT = "100000000000";
const PROPOSAL_AMOUNT = "1000000000";
const PROPOSAL_PAYOUT_AMOUNT = "1100000000";
const EMERGENCY_WITHDRAWAL_AMOUNT = "1000000000";
const STAKING_TOTAL_CURRENCY = 1_000_000_000_000n;
const STAKING_VOTER_BALANCE = 900_000_000_000n;
const COMMAND_TIMEOUT_MS = Number.parseInt(
  process.env.LEDGER_CLI_DEVICE_TIMEOUT_MS ?? "1800000",
  10,
);
if (!Number.isSafeInteger(COMMAND_TIMEOUT_MS) || COMMAND_TIMEOUT_MS <= 0) {
  throw new Error("LEDGER_CLI_DEVICE_TIMEOUT_MS must be a positive integer");
}

interface AdminState {
  currentSlot: number;
  testAccounts: Array<{
    publicKey: string;
    privateKey: string;
    balance: string;
  }>;
}

interface LedgerRole {
  accountIndex: number;
  publicKey: string;
}

interface LedgerRoles {
  sender: LedgerRole;
  voter: LedgerRole;
  treasuryOwner: LedgerRole;
  pauseController: LedgerRole;
}

type LedgerRoleName = keyof LedgerRoles;

interface LedgerRequestAccount {
  accountIndex: number;
  accountPath: string;
  publicKey: string | undefined;
  sourceOption: string;
}

interface MultisigResult {
  signerParticipantIndex: number;
  signature: string;
}

function ledgerResponseError(
  operation: string,
  response: {
    returnCode: string;
    message?: string;
    statusText?: string;
  },
): Error {
  const numericCode = Number(response.returnCode);
  const hexadecimalCode =
    Number.isInteger(numericCode) && numericCode >= 0
      ? `, hex=0x${numericCode.toString(16).padStart(4, "0")}`
      : "";
  const detail =
    response.message ??
    response.statusText ??
    "No device error text was returned";
  return new Error(
    `${operation} failed: ${detail} (returnCode=${response.returnCode}${hexadecimalCode})`,
  );
}

function accountIndex(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${name} must be an integer from 0 through 4294967295`);
  }
  return value;
}

const LEDGER_INDICES = {
  sender: accountIndex("LEDGER_SENDER_ACCOUNT_INDEX", 0),
  voter: accountIndex("LEDGER_VOTER_ACCOUNT_INDEX", 1),
  treasuryOwner: accountIndex("LEDGER_TREASURY_OWNER_ACCOUNT_INDEX", 2),
  pauseController: accountIndex("LEDGER_PAUSE_CONTROLLER_ACCOUNT_INDEX", 3),
} as const;

const LEDGER_ROLE_LABELS: Record<LedgerRoleName, string> = {
  sender: "transaction sender",
  voter: "voter",
  treasuryOwner: "Treasury Owner",
  pauseController: "Treasury Owner Pause Controller",
};

const EXCLUDED_DEVICE_SIGNING_COMMANDS = new Set(["pause-controller deploy"]);

function assertUniqueLedgerIndices(): void {
  const entries = Object.entries(LEDGER_INDICES);
  const unique = new Set(entries.map(([, index]) => index));
  if (unique.size !== entries.length) {
    throw new Error(
      `Ledger role indices must be different: ${entries
        .map(([role, index]) => `${role}=${index}`)
        .join(", ")}`,
    );
  }
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() =>
          reject(new Error("Could not allocate a local port")),
        );
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForHealth(baseUrl: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Local blockchain did not become ready at ${baseUrl}`);
}

function startLocalBlockchain(
  nodePort: number,
  archivePort: number,
): ChildProcess {
  const child = spawn("pnpm", ["run", "start"], {
    cwd: LOCAL_BLOCKCHAIN_DIRECTORY,
    env: {
      ...process.env,
      MINA_NODE_PORT: String(nodePort),
      MINA_ARCHIVE_PORT: String(archivePort),
      PROOFS_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  assert.equal(response.status, 200, `GET ${url} failed`);
  return (await response.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, `POST ${url} failed`);
  return (await response.json()) as T;
}

async function readLedgerRoles(): Promise<LedgerRoles> {
  assertUniqueLedgerIndices();
  console.log(
    "Connect and unlock the Ledger, open Mina app 1.6.7 or newer, and enable blind signing.",
  );
  console.log("Confirm the four address requests on the Ledger device.");
  const require = createRequire(import.meta.url);
  const TransportNodeHid = (
    require("@ledgerhq/hw-transport-node-hid") as {
      default: typeof import("@ledgerhq/hw-transport-node-hid").default;
    }
  ).default;
  const transport = await TransportNodeHid.open(null);
  const ledger = new MinaApp(transport);
  try {
    const app = await ledger.getAppName();
    if (app.returnCode !== "9000") {
      throw ledgerResponseError(
        "Could not read the Ledger Mina app version",
        app,
      );
    }
    console.log(
      `Connected Ledger Mina app version: ${app.version ?? "unknown"}`,
    );

    const roleEntries = Object.entries(LEDGER_INDICES) as Array<
      [LedgerRoleName, number]
    >;
    const readRole = async (
      roleName: LedgerRoleName,
      accountIndexValue: number,
      requestNumber: number,
    ): Promise<LedgerRole> => {
      const accountPath = `44'/12586'/${accountIndexValue}'/0/0`;
      const startedAt = Date.now();
      logTestStep(
        TEST_NAME,
        `Ledger address request ${requestNumber}/${roleEntries.length}: confirm ${LEDGER_ROLE_LABELS[roleName]}`,
        { role: roleName, accountIndex: accountIndexValue, accountPath },
      );
      const address = await ledger.getAddress(accountIndexValue, true);
      if (address.returnCode !== "9000" || !address.publicKey) {
        logTestStep(
          TEST_NAME,
          `Ledger address request ${requestNumber}/${roleEntries.length} failed`,
          {
            role: roleName,
            accountIndex: accountIndexValue,
            accountPath,
            durationMs: Date.now() - startedAt,
            response: address,
          },
        );
        throw ledgerResponseError(
          `Could not read Ledger account ${accountIndexValue}`,
          address,
        );
      }
      PublicKey.fromBase58(address.publicKey);
      logTestStep(
        TEST_NAME,
        `Ledger address request ${requestNumber}/${roleEntries.length} confirmed`,
        {
          role: roleName,
          accountIndex: accountIndexValue,
          accountPath,
          publicKey: address.publicKey,
          durationMs: Date.now() - startedAt,
        },
      );
      return { accountIndex: accountIndexValue, publicKey: address.publicKey };
    };
    const resolved = {} as LedgerRoles;
    for (const [
      requestIndex,
      [roleName, roleAccountIndex],
    ] of roleEntries.entries()) {
      resolved[roleName] = await readRole(
        roleName,
        roleAccountIndex,
        requestIndex + 1,
      );
    }
    return resolved;
  } finally {
    await transport.close();
  }
}

function optionValue(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  return index >= 0 ? args[index + 1] : undefined;
}

function ledgerRequestAccounts(args: string[]): LedgerRequestAccount[] {
  const requests = new Map<string, LedgerRequestAccount>();
  for (const [index, option] of args.entries()) {
    if (!option.startsWith("--") || !option.endsWith("ledger-account-index")) {
      continue;
    }
    const accountIndexValue = Number(args[index + 1]);
    if (!Number.isSafeInteger(accountIndexValue)) continue;
    const publicKeyOption =
      option === "--ledger-account-index"
        ? "--ledger-signer-public-key"
        : option.replace(/-ledger-account-index$/u, "-public-key");
    const publicKey = optionValue(args, publicKeyOption);
    const request: LedgerRequestAccount = {
      accountIndex: accountIndexValue,
      accountPath: `44'/12586'/${accountIndexValue}'/0/0`,
      publicKey,
      sourceOption: option,
    };
    requests.set(`${accountIndexValue}:${publicKey ?? ""}`, request);
  }
  return [...requests.values()];
}

function parseJsonResult<T>(output: string, requiredKey: string): T {
  for (const line of output.split(/\r?\n/u).reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
    try {
      const value = JSON.parse(trimmed) as Record<string, unknown>;
      if (requiredKey in value) return value as T;
    } catch {}
  }
  throw new Error(
    `CLI output did not contain JSON key ${requiredKey}:\n${output}`,
  );
}

function signingCommandPaths(): string[] {
  const program = createProgram();
  const visit = (command: Command, prefix: string[]): string[] => {
    if (command.commands.length > 0) {
      return command.commands.flatMap((child) =>
        visit(child, [...prefix, child.name()]),
      );
    }
    return command.options.some((option) =>
      /PrivateKey$/u.test(option.attributeName()),
    )
      ? [prefix.join(" ")]
      : [];
  };
  return program.commands.flatMap((command) =>
    visit(command, [command.name()]),
  );
}

async function startContentApi(): Promise<{
  url: string;
  close(): Promise<void>;
}> {
  const port = await getAvailablePort();
  const server = createHttpServer(async (request, response) => {
    for await (const _chunk of request) {
      // Drain the request body before sending the response.
    }
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => await closeServer(server),
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function accountNonce(
  minaNodeUrl: string,
  publicKey: string,
): Promise<number> {
  const response = await fetch(minaNodeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query { account(publicKey: "${publicKey}") { nonce } }`,
    }),
  });
  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    data?: { account?: { nonce?: string } | null };
  };
  const nonce = Number(payload.data?.account?.nonce);
  if (!Number.isSafeInteger(nonce) || nonce < 0) {
    throw new Error(`Could not read nonce for ${publicKey}`);
  }
  return nonce;
}

function ledgerTransactionArgs(
  minaNodeUrl: string,
  sender: LedgerRole,
): string[] {
  return [
    "--mina-node-url",
    minaNodeUrl,
    "--network-id",
    "testnet",
    "--signer",
    "ledger",
    "--sender-public-key",
    sender.publicKey,
    "--sender-ledger-account-index",
    String(sender.accountIndex),
    "--fee",
    TX_FEE,
    "--wait",
    "true",
  ];
}

async function runWorkerFlow(
  prefix: string,
  commonEnv: Record<string, string>,
  run: (redis: {
    host: string;
    port: number;
    queueName: string;
  }) => Promise<void>,
): Promise<void> {
  const redis = new RedisMemoryServer();
  const host = await redis.getHost();
  const port = await redis.getPort();
  const queueName = `${prefix}-${Date.now()}`;
  const worker = spawnCliWorker(queueName, {
    redisHost: host,
    redisPort: port,
    stdio: "inherit",
    envOverrides: commonEnv,
  });
  await sleep(500);
  try {
    await run({ host, port, queueName });
  } finally {
    worker.kill("SIGTERM");
    await waitForExit(worker, 5_000).catch(() => undefined);
    await redis.stop();
  }
}

test("selected signature-producing CLI commands work with a physical Ledger on the local blockchain", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "treasury-ledger-cli-e2e-"));
  const sqliteDirectory = join(tempRoot, "sqlite");
  const nodePort = await getAvailablePort();
  const archivePort = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${nodePort}`;
  const minaNodeUrl = `${baseUrl}/graphql`;
  const archiveNodeUrl = `http://127.0.0.1:${archivePort}/graphql`;
  const commonEnv = {
    MINA_NODE_URL: minaNodeUrl,
    MINA_NETWORK_ID: "testnet",
    PROOFS_ENABLED: "false",
    SQLITE_DATA_DIRECTORY: sqliteDirectory,
  };
  const coveredSigningCommands = new Set<string>();
  let localBlockchain: ChildProcess | undefined;
  let contentApi: Awaited<ReturnType<typeof startContentApi>> | undefined;

  const cli = async (args: string[], label: string): Promise<string> => {
    const startedAt = Date.now();
    logTestStep(TEST_NAME, `running ${label}`);
    try {
      const output = await runCli(args, {
        envOverrides: commonEnv,
        timeoutMs: COMMAND_TIMEOUT_MS,
        streamOutput: true,
        streamLabel: label,
      });
      logTestStep(TEST_NAME, `completed ${label}`, {
        durationMs: Date.now() - startedAt,
      });
      return output;
    } catch (error) {
      logTestStep(TEST_NAME, `failed ${label}`, {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
  const signingCli = async (
    path: string,
    args: string[],
    label = path,
  ): Promise<string> => {
    const signerIndex = args.indexOf("--signer");
    assert.equal(args[signerIndex + 1], "ledger", `${path} must use Ledger`);
    coveredSigningCommands.add(path);
    const accounts = ledgerRequestAccounts(args);
    logTestStep(
      TEST_NAME,
      `Ledger request plan for ${label}: confirm each address, then approve each field signature`,
      {
        commandPath: path,
        accounts,
        note: "A signer can require more than one field signature when the transaction uses different commitments.",
      },
    );
    return await cli(args, label);
  };

  try {
    localBlockchain = startLocalBlockchain(nodePort, archivePort);
    await waitForHealth(baseUrl);
    const roles = await readLedgerRoles();
    const rolePublicKeys = Object.values(roles).map((role) => role.publicKey);
    assert.equal(new Set(rolePublicKeys).size, rolePublicKeys.length);
    logTestStep(TEST_NAME, "resolved Ledger roles", roles);

    const initialState = await readJson<AdminState>(`${baseUrl}/admin/state`);
    const localWhale = initialState.testAccounts[0];
    assert(
      localWhale,
      "The local blockchain must supply a funded test account",
    );

    await cli(
      [
        "transfer",
        "--signer",
        "in-memory",
        "--network-id",
        "testnet",
        "--mina-node-url",
        minaNodeUrl,
        "--sender-private-key",
        localWhale.privateKey,
        "--recipient-public-key",
        roles.sender.publicKey,
        "--amount",
        FUND_LEDGER_AMOUNT,
        "--fee",
        TX_FEE,
        "--wait",
        "true",
      ],
      "setup fund Ledger sender",
    );

    await cli(
      [
        "transfer",
        "--signer",
        "in-memory",
        "--network-id",
        "testnet",
        "--mina-node-url",
        minaNodeUrl,
        "--sender-private-key",
        localWhale.privateKey,
        "--recipient-public-key",
        roles.voter.publicKey,
        "--amount",
        FUND_LEDGER_AMOUNT,
        "--fee",
        TX_FEE,
        "--wait",
        "true",
      ],
      "setup fund Ledger voter",
    );

    const transferRecipient = PrivateKey.random().toPublicKey().toBase58();
    const transferOutput = await signingCli("transfer", [
      "transfer",
      ...ledgerTransactionArgs(minaNodeUrl, roles.sender),
      "--recipient-public-key",
      transferRecipient,
      "--amount",
      "1000000000",
    ]);
    assert(
      parseJsonResult<{ transferTxHash: string }>(
        transferOutput,
        "transferTxHash",
      ).transferTxHash,
    );

    const template = JSON.parse(
      await readFile(LEDGER_TEMPLATE_PATH, "utf8"),
    ) as Array<Record<string, unknown>>;
    assert(template[0] && template[1]);
    const stakingLedger = [
      {
        ...template[0],
        pk: roles.voter.publicKey,
        delegate: roles.voter.publicKey,
        balance: STAKING_VOTER_BALANCE.toString(),
      },
      {
        ...template[1],
        pk: roles.sender.publicKey,
        delegate: roles.sender.publicKey,
        balance: (STAKING_TOTAL_CURRENCY - STAKING_VOTER_BALANCE).toString(),
      },
    ];
    const stakingLedgerPath = join(tempRoot, "staking-ledger.json");
    const stakingProofPath = join(tempRoot, "staking-ledger-exhausted.json");
    await writeFile(stakingLedgerPath, JSON.stringify(stakingLedger, null, 2));
    await cli(
      [
        "staking-ledger",
        "from-file",
        "--lifecycle-id",
        LIFECYCLE_ID,
        "--staking-ledger-path",
        stakingLedgerPath,
        "--start-index",
        "0",
        "--end-index",
        "1",
      ],
      "prepare staking ledger",
    );
    const rootOutput = await cli(
      ["staking-ledger", "get-root-hash", "--lifecycle-id", LIFECYCLE_ID],
      "read staking ledger root",
    );
    let stakingRoot: string | undefined;
    for (const token of rootOutput.split(/\s+/u)) {
      try {
        stakingRoot = LedgerHashBase58.fromBase58(token).toString();
        break;
      } catch {}
    }
    assert(stakingRoot, "Could not parse the staking ledger root");
    await postJson(`${baseUrl}/admin/network-state`, {
      stakingEpochDataLedgerHash: stakingRoot,
      stakingEpochDataLedgerTotalCurrency: STAKING_TOTAL_CURRENCY.toString(),
    });

    await runWorkerFlow("ledger-staking", commonEnv, async (redis) => {
      const redisArgs = [
        "--redis-host",
        redis.host,
        "--redis-port",
        String(redis.port),
        "--queue-name",
        redis.queueName,
      ];
      await cli(
        ["staking-ledger-to-voting-ledger", "compile"],
        "compile staking-to-voting program",
      );
      await cli(
        [
          "staking-ledger-to-voting-ledger",
          "trace-digest",
          "--lifecycle-id",
          LIFECYCLE_ID,
          "--start-index",
          "0",
          "--end-index",
          "0",
        ],
        "trace staking-to-voting digest",
      );
      await cli(
        [
          "staking-ledger-to-voting-ledger",
          "prove-digest",
          "--lifecycle-id",
          LIFECYCLE_ID,
          ...redisArgs,
          "--start-index",
          "0",
          "--end-index",
          "0",
        ],
        "prove staking-to-voting digest",
      );
      await cli(
        [
          "staking-ledger-to-voting-ledger",
          "prove-merge",
          "--lifecycle-id",
          LIFECYCLE_ID,
          ...redisArgs,
        ],
        "merge staking-to-voting proof",
      );
    });
    await cli(
      [
        "staking-ledger-to-voting-ledger",
        "prove-exhaust",
        "--lifecycle-id",
        LIFECYCLE_ID,
        "--proof-output-path",
        stakingProofPath,
      ],
      "exhaust staking-to-voting proof",
    );

    const multisigLedgerRoles = [
      roles.sender,
      roles.treasuryOwner,
      roles.pauseController,
    ];
    const multisigParticipants = [
      ...multisigLedgerRoles.map((role) => role.publicKey),
      ...Array.from({ length: 2 }, () =>
        PrivateKey.random().toPublicKey().toBase58(),
      ),
    ];
    const multisigParticipantsArg = multisigParticipants.join(",");

    const deploymentState = await readJson<AdminState>(
      `${baseUrl}/admin/state`,
    );
    const treasuryDeployedAtSlot = deploymentState.currentSlot;
    const treasuryDeployOutput = await signingCli("treasury-owner deploy", [
      "treasury-owner",
      "deploy",
      ...ledgerTransactionArgs(minaNodeUrl, roles.sender),
      "--treasury-owner-public-key",
      roles.treasuryOwner.publicKey,
      "--treasury-owner-ledger-account-index",
      String(roles.treasuryOwner.accountIndex),
      "--pause-controller-public-key",
      roles.pauseController.publicKey,
      "--pause-controller-ledger-account-index",
      String(roles.pauseController.accountIndex),
      "--treasury-deployed-at-slot",
      String(treasuryDeployedAtSlot),
      "--withdrawal-permission",
      "proofOrSignature",
      "--multisig-participants-public-keys",
      multisigParticipantsArg,
      "--lifecycle-period-duration",
      String(LIFECYCLE_PERIOD_DURATION),
    ]);
    const treasuryDeploy = parseJsonResult<{
      treasuryOwnerTxHash: string;
      pauseControllerTxHash: string;
    }>(treasuryDeployOutput, "treasuryOwnerTxHash");
    assert(treasuryDeploy.treasuryOwnerTxHash);
    assert(treasuryDeploy.pauseControllerTxHash);

    const fundOutput = await signingCli("treasury-owner fund-treasury", [
      "treasury-owner",
      "fund-treasury",
      ...ledgerTransactionArgs(minaNodeUrl, roles.sender),
      "--funding-public-key",
      roles.sender.publicKey,
      "--funding-ledger-account-index",
      String(roles.sender.accountIndex),
      "--treasury-owner-public-key",
      roles.treasuryOwner.publicKey,
      "--amount",
      TREASURY_FUNDING_AMOUNT,
      "--lifecycle-period-duration",
      String(LIFECYCLE_PERIOD_DURATION),
    ]);
    assert(
      parseJsonResult<{ transferTxHash: string }>(fundOutput, "transferTxHash")
        .transferTxHash,
    );

    contentApi = await startContentApi();
    const proposalContentPath = join(tempRoot, "proposal.md");
    await writeFile(
      proposalContentPath,
      "# Physical Ledger CLI end-to-end proposal\n\nThis proposal is test data.\n",
    );
    const proposalRecipient = PrivateKey.random().toPublicKey().toBase58();
    const createOutput = await signingCli("proposal create", [
      "proposal",
      "create",
      ...ledgerTransactionArgs(minaNodeUrl, roles.sender),
      "--api-url",
      contentApi.url,
      "--treasury-owner-public-key",
      roles.treasuryOwner.publicKey,
      "--proposal-lifecycle-id",
      LIFECYCLE_ID,
      "--recipient-public-key",
      proposalRecipient,
      "--amount",
      PROPOSAL_AMOUNT,
      "--content-file",
      proposalContentPath,
      "--lifecycle-period-duration",
      String(LIFECYCLE_PERIOD_DURATION),
    ]);
    const createResult = parseJsonResult<{
      proposalAddress: string;
      proposalTxHash: string;
    }>(createOutput, "proposalTxHash");
    assert(createResult.proposalTxHash);
    const proposalPublicKey = createResult.proposalAddress;
    PublicKey.fromBase58(proposalPublicKey);

    const buildMultisigSignatures = async (
      action:
        | "pause-treasury"
        | "unpause-treasury"
        | "toggle-pause-proposal"
        | "rotate-multisig-keys",
      nonce: number,
      extraArgs: string[] = [],
    ): Promise<string> => {
      const partials: MultisigResult[] = [];
      for (const [index, role] of multisigLedgerRoles.entries()) {
        const ledgerOutput = await signingCli(`multisig-sign ${action}`, [
          "multisig-sign",
          action,
          "--signer",
          "ledger",
          "--ledger-signer-public-key",
          role.publicKey,
          "--ledger-account-index",
          String(role.accountIndex),
          "--multisig-participants-public-keys",
          multisigParticipantsArg,
          "--nonce",
          String(nonce),
          ...extraArgs,
        ]);
        partials.push(
          parseJsonResult<MultisigResult>(ledgerOutput, "signature"),
        );
        logTestStep(
          TEST_NAME,
          `accepted Ledger multisig signature ${index + 1} for ${action}`,
        );
      }
      const slots = Array.from({ length: 5 }, () => "");
      for (const partial of partials) {
        slots[partial.signerParticipantIndex] = partial.signature;
      }
      assert.equal(slots.filter(Boolean).length, 3);
      return slots.join(",");
    };

    const pauseNonce = await accountNonce(
      minaNodeUrl,
      roles.pauseController.publicKey,
    );
    const pauseSignatures = await buildMultisigSignatures(
      "pause-treasury",
      pauseNonce,
    );
    const pauseOutput = await signingCli("pause-controller pause-treasury", [
      "pause-controller",
      "pause-treasury",
      ...ledgerTransactionArgs(minaNodeUrl, roles.sender),
      "--pause-controller-public-key",
      roles.pauseController.publicKey,
      "--multisig-participants-public-keys",
      multisigParticipantsArg,
      "--multisig-signatures",
      pauseSignatures,
    ]);
    assert(
      parseJsonResult<{ pauseTxHash: string }>(pauseOutput, "pauseTxHash")
        .pauseTxHash,
    );

    const unpauseNonce = await accountNonce(
      minaNodeUrl,
      roles.pauseController.publicKey,
    );
    const unpauseSignatures = await buildMultisigSignatures(
      "unpause-treasury",
      unpauseNonce,
    );
    const unpauseOutput = await signingCli(
      "pause-controller unpause-treasury",
      [
        "pause-controller",
        "unpause-treasury",
        ...ledgerTransactionArgs(minaNodeUrl, roles.sender),
        "--pause-controller-public-key",
        roles.pauseController.publicKey,
        "--multisig-participants-public-keys",
        multisigParticipantsArg,
        "--multisig-signatures",
        unpauseSignatures,
      ],
    );
    assert(
      parseJsonResult<{ unpauseTxHash: string }>(unpauseOutput, "unpauseTxHash")
        .unpauseTxHash,
    );

    const toggleExtraArgs = ["--proposal-public-key", proposalPublicKey];
    const toggleNonce = await accountNonce(
      minaNodeUrl,
      roles.pauseController.publicKey,
    );
    const toggleSignatures = await buildMultisigSignatures(
      "toggle-pause-proposal",
      toggleNonce,
      toggleExtraArgs,
    );
    const toggleArgs = (signatures: string): string[] => [
      "pause-controller",
      "toggle-pause-proposal",
      ...ledgerTransactionArgs(minaNodeUrl, roles.sender),
      "--pause-controller-public-key",
      roles.pauseController.publicKey,
      "--treasury-owner-public-key",
      roles.treasuryOwner.publicKey,
      "--proposal-public-key",
      proposalPublicKey,
      "--multisig-participants-public-keys",
      multisigParticipantsArg,
      "--multisig-signatures",
      signatures,
      "--lifecycle-period-duration",
      String(LIFECYCLE_PERIOD_DURATION),
    ];
    const toggleOutput = await signingCli(
      "pause-controller toggle-pause-proposal",
      toggleArgs(toggleSignatures),
    );
    assert(
      parseJsonResult<{ togglePauseProposalTxHash: string }>(
        toggleOutput,
        "togglePauseProposalTxHash",
      ).togglePauseProposalTxHash,
    );

    const untoggleNonce = await accountNonce(
      minaNodeUrl,
      roles.pauseController.publicKey,
    );
    const untoggleSignatures = await buildMultisigSignatures(
      "toggle-pause-proposal",
      untoggleNonce,
      toggleExtraArgs,
    );
    const untoggleOutput = await signingCli(
      "pause-controller toggle-pause-proposal",
      toggleArgs(untoggleSignatures),
      "pause-controller toggle-pause-proposal restore",
    );
    assert(
      parseJsonResult<{ togglePauseProposalTxHash: string }>(
        untoggleOutput,
        "togglePauseProposalTxHash",
      ).togglePauseProposalTxHash,
    );

    const emergencyRecipient = PrivateKey.random().toPublicKey().toBase58();
    const emergencyOutput = await signingCli(
      "treasury-owner emergency-withdraw",
      [
        "treasury-owner",
        "emergency-withdraw",
        ...ledgerTransactionArgs(minaNodeUrl, roles.sender),
        "--treasury-owner-public-key",
        roles.treasuryOwner.publicKey,
        "--treasury-owner-ledger-account-index",
        String(roles.treasuryOwner.accountIndex),
        "--recipient-public-key",
        emergencyRecipient,
        "--amount",
        EMERGENCY_WITHDRAWAL_AMOUNT,
      ],
    );
    assert(
      parseJsonResult<{ emergencyWithdrawalTxHash: string }>(
        emergencyOutput,
        "emergencyWithdrawalTxHash",
      ).emergencyWithdrawalTxHash,
    );

    const votingSlot = treasuryDeployedAtSlot + LIFECYCLE_PERIOD_DURATION * 2;
    const currentBeforeVote = await readJson<AdminState>(
      `${baseUrl}/admin/state`,
    );
    if (currentBeforeVote.currentSlot < votingSlot) {
      await postJson(`${baseUrl}/admin/slot/set`, { slot: votingSlot });
    }
    const voteOutput = await signingCli("proposal vote", [
      "proposal",
      "vote",
      ...ledgerTransactionArgs(minaNodeUrl, roles.sender),
      "--treasury-owner-public-key",
      roles.treasuryOwner.publicKey,
      "--proposal-public-key",
      proposalPublicKey,
      "--voter-public-key",
      roles.voter.publicKey,
      "--voter-ledger-account-index",
      String(roles.voter.accountIndex),
      "--vote",
      "yay",
      "--lifecycle-period-duration",
      String(LIFECYCLE_PERIOD_DURATION),
    ]);
    assert(
      parseJsonResult<{ voteTxHash: string }>(voteOutput, "voteTxHash")
        .voteTxHash,
    );

    const actionsPath = join(tempRoot, "vote-actions.json");
    const voteProofPath = join(tempRoot, "vote-reducer-merged.json");
    const actionsOutput = await cli(
      [
        "proposal",
        "fetch-actions",
        "--archive-node-url",
        archiveNodeUrl,
        "--treasury-owner-public-key",
        roles.treasuryOwner.publicKey,
        "--proposal-public-key",
        proposalPublicKey,
        "--output-path",
        actionsPath,
      ],
      "fetch proposal actions",
    );
    const actionsResult = parseJsonResult<{ count: number }>(
      actionsOutput,
      "count",
    );
    assert.equal(actionsResult.count, 1);
    await cli(
      [
        "vote-reducer",
        "trace-run-batch",
        "--lifecycle-id",
        LIFECYCLE_ID,
        "--vote-actions-path",
        actionsPath,
      ],
      "trace vote reducer",
    );
    await runWorkerFlow("ledger-vote", commonEnv, async (redis) => {
      const redisArgs = [
        "--redis-host",
        redis.host,
        "--redis-port",
        String(redis.port),
        "--queue-name",
        redis.queueName,
      ];
      await cli(
        [
          "vote-reducer",
          "prove-run-batch",
          "--lifecycle-id",
          LIFECYCLE_ID,
          ...redisArgs,
        ],
        "prove vote reducer",
      );
      await cli(
        [
          "vote-reducer",
          "prove-merge",
          "--lifecycle-id",
          LIFECYCLE_ID,
          ...redisArgs,
          "--proof-output-path",
          voteProofPath,
        ],
        "merge vote reducer proof",
      );
    });

    const tallyOutput = await signingCli("proposal tally-votes", [
      "proposal",
      "tally-votes",
      ...ledgerTransactionArgs(minaNodeUrl, roles.sender),
      "--treasury-owner-public-key",
      roles.treasuryOwner.publicKey,
      "--proposal-public-key",
      proposalPublicKey,
      "--vote-reducer-proof-path",
      voteProofPath,
      "--staking-ledger-to-voting-ledger-proof-path",
      stakingProofPath,
      "--lifecycle-id",
      LIFECYCLE_ID,
      "--lifecycle-period-duration",
      String(LIFECYCLE_PERIOD_DURATION),
    ]);
    assert(
      parseJsonResult<{ tallyTxHash: string }>(tallyOutput, "tallyTxHash")
        .tallyTxHash,
    );

    const executionSlot =
      treasuryDeployedAtSlot + LIFECYCLE_PERIOD_DURATION * 4;
    const currentBeforeExecute = await readJson<AdminState>(
      `${baseUrl}/admin/state`,
    );
    if (currentBeforeExecute.currentSlot < executionSlot) {
      await postJson(`${baseUrl}/admin/slot/set`, { slot: executionSlot });
    }
    const executeOutput = await signingCli("proposal execute", [
      "proposal",
      "execute",
      ...ledgerTransactionArgs(minaNodeUrl, roles.sender),
      "--treasury-owner-public-key",
      roles.treasuryOwner.publicKey,
      "--proposal-public-key",
      proposalPublicKey,
      "--recipient-public-key",
      proposalRecipient,
      "--amount-to-pay-out",
      PROPOSAL_PAYOUT_AMOUNT,
      "--lifecycle-period-duration",
      String(LIFECYCLE_PERIOD_DURATION),
    ]);
    assert(
      parseJsonResult<{ executeTxHash: string }>(executeOutput, "executeTxHash")
        .executeTxHash,
    );

    const newMultisigParticipants = Array.from({ length: 5 }, () =>
      PrivateKey.random().toPublicKey().toBase58(),
    );
    const rotateExtraArgs = [
      "--new-multisig-participants-public-keys",
      newMultisigParticipants.join(","),
    ];
    const rotateNonce = await accountNonce(
      minaNodeUrl,
      roles.pauseController.publicKey,
    );
    const rotateSignatures = await buildMultisigSignatures(
      "rotate-multisig-keys",
      rotateNonce,
      rotateExtraArgs,
    );
    const rotateOutput = await signingCli(
      "pause-controller rotate-multisig-keys",
      [
        "pause-controller",
        "rotate-multisig-keys",
        ...ledgerTransactionArgs(minaNodeUrl, roles.sender),
        "--pause-controller-public-key",
        roles.pauseController.publicKey,
        "--current-multisig-participants-public-keys",
        multisigParticipantsArg,
        "--new-multisig-participants-public-keys",
        newMultisigParticipants.join(","),
        "--multisig-signatures",
        rotateSignatures,
      ],
    );
    assert(
      parseJsonResult<{ rotateMultisigKeysTxHash: string }>(
        rotateOutput,
        "rotateMultisigKeysTxHash",
      ).rotateMultisigKeysTxHash,
    );

    const signingCommands = signingCommandPaths();
    for (const excludedCommand of EXCLUDED_DEVICE_SIGNING_COMMANDS) {
      assert(
        signingCommands.includes(excludedCommand),
        `Excluded Ledger command does not exist: ${excludedCommand}`,
      );
    }
    const expectedSigningCommands = signingCommands.filter(
      (command) => !EXCLUDED_DEVICE_SIGNING_COMMANDS.has(command),
    );
    assert.deepEqual(
      [...coveredSigningCommands].sort(),
      expectedSigningCommands.sort(),
      "The physical-device flow must cover each non-excluded signature-producing CLI command",
    );
    logTestStep(TEST_NAME, "selected Ledger CLI signing commands completed", {
      commands: [...coveredSigningCommands].sort(),
      excludedCommands: [...EXCLUDED_DEVICE_SIGNING_COMMANDS].sort(),
    });
  } finally {
    await contentApi?.close().catch(() => undefined);
    if (localBlockchain && !localBlockchain.killed) {
      localBlockchain.kill("SIGTERM");
      await waitForExit(localBlockchain, 5_000).catch(() => undefined);
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});
