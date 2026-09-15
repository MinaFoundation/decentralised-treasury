import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { type JsonProof, PrivateKey, PublicKey, UInt32, UInt64 } from "o1js";
import { RedisMemoryServer } from "redis-memory-server";
import { configureMinaNetwork } from "../src/commands/mina-instance.js";
import {
  SideLoadedVoteReducerProof,
  VoteReducer,
  VoteReducerProof,
} from "@repo/sdk/src/provable/contracts/treasury-proposal/vote-reducer.js";
import { SideLoadedStakingLedgerToVotingLedgerProof } from "@repo/sdk/src/provable/staking-ledger-to-voting-ledger.js";
import { SqliteTreasuryOwnerService } from "@repo/sdk/src/services/sqlite/sqlite-treasury-owner-service.js";
import type { TransactionSigner } from "@repo/sdk/src/services/transaction-signing.js";
import {
  startLocalE2EBackend,
  type LocalE2EBackend,
} from "../../../devops/test/local-e2e-backend.mjs";
import {
  runCli,
  sleep,
  spawnCliWorker,
  waitForExit,
} from "./utils/cli-test-utils.js";
import {
  startLocalBlockchainTestServer,
  type LocalBlockchainTestServer,
} from "./utils/local-blockchain-test-server.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CLI_PACKAGE_DIRECTORY = fileURLToPath(new URL("../", import.meta.url));
const CLI_TS_NODE_PROJECT = join(CLI_PACKAGE_DIRECTORY, "tsconfig.json");
const CLI_TS_NODE_LOADER = join(
  CLI_PACKAGE_DIRECTORY,
  "node_modules/ts-node/esm.mjs",
);
const LIFECYCLE_ID = "0";
const LIFECYCLE_PERIOD_DURATION = 20;
const TX_FEE = "100000000";
const VOTER_FUNDING_AMOUNT = "2000000000";
const TREASURY_FUNDING_AMOUNT = "100000000000";
const PROPOSAL_AMOUNT = "1000000000";
const PROPOSAL_PAYOUT_AMOUNT = 1_100_000_000n;
const PARTIAL_PAYOUT_AMOUNT = 400_000_000n;
const EXACT_REMAINING_PAYOUT_AMOUNT = 700_000_000n;
const PROOFS_ENABLED_VALUE = process.env.PROOFS_ENABLED;

if (PROOFS_ENABLED_VALUE !== "false" && PROOFS_ENABLED_VALUE !== "true") {
  throw new Error(
    "PROOFS_ENABLED must be set explicitly to false or true for this E2E test",
  );
}

const PROOFS_ENABLED = PROOFS_ENABLED_VALUE === "true";
const PROOF_MODE = PROOFS_ENABLED ? "proof-on" : "proof-off";
const DEFAULT_COMMAND_TIMEOUT_MS = PROOFS_ENABLED ? 3_600_000 : 900_000;
const COMMAND_TIMEOUT_MS = Number.parseInt(
  process.env.CLI_E2E_COMMAND_TIMEOUT_MS ?? String(DEFAULT_COMMAND_TIMEOUT_MS),
  10,
);
const TEST_TIMEOUT_MS = PROOFS_ENABLED ? 43_200_000 : 5_400_000;

if (!Number.isSafeInteger(COMMAND_TIMEOUT_MS) || COMMAND_TIMEOUT_MS <= 0) {
  throw new Error("CLI_E2E_COMMAND_TIMEOUT_MS must be a positive integer");
}

interface AdminState {
  currentSlot: number;
  proofsEnabled: boolean;
  submittedTransactions: number;
  testAccounts: Array<{
    publicKey: string;
    privateKey: string;
    balance: string;
  }>;
}

interface GeneratedKeypair {
  privateKey: string;
  publicKey: string;
}

interface MultisigResult {
  signerParticipantIndex: number;
  signature: string;
}

interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface ProposalFixture {
  keypair: GeneratedKeypair;
  name: string;
  recipientPublicKey: string;
}

interface ProposalState {
  proposalAddress: string;
  status: string;
  paidOutAmount: string;
}

interface RedisFixture {
  host: string;
  port: number;
  queueName: string;
}

interface SerializedProof {
  maxProofsVerified: unknown;
  proof: string;
  publicInput: unknown[];
  publicOutput: unknown[];
}

interface ProofArtifactEvidence {
  byteLength: number;
  jsonKeys: string[];
  name: string;
  proofByteLength: number | null;
  publicInputFieldCount: number | null;
  publicOutputFieldCount: number | null;
  sha256: string;
}

interface SupportingProofBoundaryEvidence {
  alteredError: string;
  alteredFailureLayer: "before-signing" | "signer-barrier";
  alteredReachedSigner: boolean;
  alteredVerify: boolean;
  donorProofBodyDiffers: boolean;
  donorStatementDiffers: boolean;
  donorVerify: boolean;
  label: "supporting-sdk-proof-boundary-integration";
  originalReachedSigner: boolean;
  originalVerify: boolean;
  programProofsEnabled: boolean;
  protectedStateUnchanged: boolean;
}

interface BackendIndexerStatus {
  ready?: boolean;
  remainingCanonicalBlocks?: number;
  remainingPendingBlocks?: number;
  rejections?: { unresolved?: number };
  runtime?: {
    failedOperations?: unknown[];
    missingOperations?: unknown[];
    staleOperations?: unknown[];
  };
}

interface BackendProcessorStatus {
  ready?: boolean;
  remainingEvents?: number;
  runtime?: {
    lastErrorCode?: string | null;
    lifecycleState?: string;
  };
  failures?: { due?: number };
  projectionReplay?: { state?: string };
}

interface StakingAccountProjection {
  lifecycleId: string;
  publicKey: string;
  index: string;
  balance: string;
  delegatePublicKey: string;
  account: {
    balance?: string;
    delegate?: string;
    pk?: string;
  };
}

type VoteChoice = "yay" | "nay" | "abstain";

function commandPhase(args: string[]): string {
  const [command = "unknown", next] = args;
  return next && !next.startsWith("-") ? `${command} ${next}` : command;
}

function redactPrivateKeys(value: string): string {
  return value.replace(/EK[1-9A-HJ-NP-Za-km-z]{45,60}/gu, "<private-key>");
}

function proofArtifactEvidence(
  name: string,
  serialized: string,
): ProofArtifactEvidence {
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = JSON.parse(serialized) as Record<string, unknown>;
  } catch {}
  return {
    name,
    byteLength: Buffer.byteLength(serialized),
    sha256: createHash("sha256").update(serialized).digest("hex"),
    jsonKeys: parsed ? Object.keys(parsed).sort() : [],
    proofByteLength:
      typeof parsed?.proof === "string"
        ? Buffer.byteLength(parsed.proof)
        : null,
    publicInputFieldCount: Array.isArray(parsed?.publicInput)
      ? parsed.publicInput.length
      : null,
    publicOutputFieldCount: Array.isArray(parsed?.publicOutput)
      ? parsed.publicOutput.length
      : null,
  };
}

function parseSerializedProof(serialized: string): SerializedProof {
  const proof = JSON.parse(serialized) as Partial<SerializedProof>;
  assert.equal(typeof proof.proof, "string");
  assert(Array.isArray(proof.publicInput));
  assert(Array.isArray(proof.publicOutput));
  assert.notEqual(proof.maxProofsVerified, undefined);
  return proof as SerializedProof;
}

function logCommandPhase(
  state: "START" | "PASS" | "FAIL",
  args: string[],
  startedAt?: number,
): void {
  const duration =
    startedAt === undefined ? "" : ` ${Date.now() - startedAt}ms`;
  console.log(
    `[cli-negative-e2e:${PROOF_MODE}] ${state} ${commandPhase(args)}${duration}`,
  );
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

async function waitForAssertion(
  label: string,
  assertion: () => Promise<void>,
): Promise<void> {
  const deadline = Date.now() + 90_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  throw new Error(
    `${label} did not converge: ${redactPrivateKeys(String(lastError))}`,
  );
}

async function assertBackendReadyAndCaughtUp(
  backend: LocalE2EBackend,
): Promise<void> {
  const [indexer, processor] = await Promise.all([
    readJson<BackendIndexerStatus>(`${backend.indexerApiUrl}/status`),
    readJson<BackendProcessorStatus>(`${backend.processorApiUrl}/status`),
  ]);
  assert.equal(indexer.ready, true);
  assert.equal(indexer.remainingCanonicalBlocks, 0);
  assert.equal(indexer.remainingPendingBlocks, 0);
  assert.equal(indexer.rejections?.unresolved, 0);
  assert.deepEqual(indexer.runtime?.failedOperations, []);
  assert.deepEqual(indexer.runtime?.missingOperations, []);
  assert.deepEqual(indexer.runtime?.staleOperations, []);
  assert.equal(processor.ready, true);
  assert.equal(processor.remainingEvents, 0);
  assert.match(processor.runtime?.lifecycleState ?? "", /^(?:idle|running)$/u);
  assert.equal(processor.runtime?.lastErrorCode, null);
  assert.equal(processor.failures?.due, 0);
  assert.equal(processor.projectionReplay?.state, "complete");
}

async function waitForExactSnapshotProjection(
  backend: LocalE2EBackend,
  treasuryOwnerPublicKey: string,
  voterPublicKeys: string[],
): Promise<void> {
  const expectedAccounts = [
    {
      publicKey: treasuryOwnerPublicKey,
      index: "0",
      balance: "1000000000000",
    },
    ...voterPublicKeys.map((publicKey, index) => ({
      publicKey,
      index: String(index + 1),
      balance: "100000000000",
    })),
  ];
  await waitForAssertion("public staking snapshot", async () => {
    const accounts = await Promise.all(
      expectedAccounts.map(async ({ publicKey }) =>
        readJson<StakingAccountProjection>(
          `${backend.appApiUrl}/staking-ledger/lifecycles/${LIFECYCLE_ID}/accounts/${encodeURIComponent(publicKey)}`,
        ),
      ),
    );
    const weightByDelegate = new Map<string, bigint>();
    for (const [index, account] of accounts.entries()) {
      const expected = expectedAccounts[index]!;
      assert.equal(account.lifecycleId, LIFECYCLE_ID);
      assert.equal(account.publicKey, expected.publicKey);
      assert.equal(account.index, expected.index);
      assert.equal(account.balance, expected.balance);
      assert.equal(account.delegatePublicKey, expected.publicKey);
      assert.equal(account.account.pk, expected.publicKey);
      assert.equal(account.account.balance, expected.balance);
      assert.equal(account.account.delegate, expected.publicKey);
      weightByDelegate.set(
        account.delegatePublicKey,
        (weightByDelegate.get(account.delegatePublicKey) ?? 0n) +
          BigInt(account.balance),
      );
    }
    assert.equal(
      weightByDelegate.get(treasuryOwnerPublicKey),
      1_000_000_000_000n,
    );
    for (const voterPublicKey of voterPublicKeys) {
      assert.equal(weightByDelegate.get(voterPublicKey), 100_000_000_000n);
    }
    assert.equal(
      [...weightByDelegate.values()].reduce((sum, value) => sum + value, 0n),
      1_500_000_000_000n,
    );
    await assertBackendReadyAndCaughtUp(backend);
  });
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

function parsePrettyJsonResult<T>(output: string, requiredKey: string): T {
  const firstBrace = output.indexOf("{");
  const lastBrace = output.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < firstBrace) {
    throw new Error(`CLI output did not contain JSON:\n${output}`);
  }
  const value = JSON.parse(output.slice(firstBrace, lastBrace + 1)) as Record<
    string,
    unknown
  >;
  assert(requiredKey in value, `CLI JSON did not contain ${requiredKey}`);
  return value as T;
}

async function runCliProcess(
  args: string[],
  envOverrides: Record<string, string>,
  commandDirectory: string,
): Promise<ProcessResult> {
  const cliEntryPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const startedAt = Date.now();
  logCommandPhase("START", args);
  return await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--loader", CLI_TS_NODE_LOADER, cliEntryPath, ...args],
      {
        cwd: commandDirectory,
        env: {
          ...process.env,
          ...envOverrides,
          NODE_NO_WARNINGS: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      logCommandPhase("FAIL", args, startedAt);
      reject(new Error(`CLI timed out: ${commandPhase(args)}`));
    }, COMMAND_TIMEOUT_MS);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      logCommandPhase("FAIL", args, startedAt);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      logCommandPhase(code === 0 ? "PASS" : "FAIL", args, startedAt);
      resolve({
        code: code ?? 1,
        stdout: redactPrivateKeys(stdout),
        stderr: redactPrivateKeys(stderr),
      });
    });
  });
}

async function accountBalance(
  minaNodeUrl: string,
  publicKey: string,
): Promise<bigint> {
  const response = await fetch(minaNodeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query { account(publicKey: "${publicKey}") { balance { total } } }`,
    }),
  });
  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    data?: { account?: { balance?: { total?: string } } | null };
  };
  return BigInt(payload.data?.account?.balance?.total ?? "0");
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
  assert(Number.isSafeInteger(nonce) && nonce >= 0);
  return nonce;
}

async function runWorkerFlow(
  prefix: string,
  commonEnv: Record<string, string>,
  commandDirectory: string,
  run: (redis: RedisFixture) => Promise<void>,
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
    cwd: commandDirectory,
    nodeLoaderPath: CLI_TS_NODE_LOADER,
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

test(
  `runs the ${PROOF_MODE} CLI rejection, boundary, and payout matrix`,
  { timeout: TEST_TIMEOUT_MS },
  async (context) => {
    const tempRoot = await mkdtemp(
      join(tmpdir(), `treasury-cli-negative-${PROOF_MODE}-`),
    );
    const commandDirectory = tempRoot;
    const runLogPath = join(tempRoot, "run.log");
    const sqliteDirectory = join(tempRoot, "sqlite");
    const publicArtifactDirectory = process.env.E2E_ARTIFACT_DIRECTORY;
    const proofArtifactEvidenceRecords: ProofArtifactEvidence[] = [];
    let supportingProofBoundaryEvidence:
      | SupportingProofBoundaryEvidence
      | undefined;
    const startedAt = new Date().toISOString();
    let completed = false;
    await mkdir(join(tempRoot, "cache"), { recursive: true });
    if (publicArtifactDirectory) {
      await mkdir(publicArtifactDirectory, { recursive: true });
    }
    const nodePort = await getAvailablePort();
    const archivePort = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${nodePort}`;
    const minaNodeUrl = `${baseUrl}/graphql`;
    const archiveNodeUrl = `http://127.0.0.1:${archivePort}/graphql`;
    const commonEnv = {
      MINA_NODE_URL: minaNodeUrl,
      MINA_NETWORK_ID: "testnet",
      PROOFS_ENABLED: PROOFS_ENABLED_VALUE,
      SQLITE_DATA_DIRECTORY: sqliteDirectory,
      TS_NODE_PROJECT: CLI_TS_NODE_PROJECT,
    };
    let localBlockchain: LocalBlockchainTestServer | undefined;
    let backend: LocalE2EBackend | undefined;
    let serverOutput = "";

    const cli = async (
      args: string[],
      envOverrides: Record<string, string> = {},
    ): Promise<string> => {
      const startedAt = Date.now();
      logCommandPhase("START", args);
      await appendFile(
        runLogPath,
        `[${new Date().toISOString()}] START ${commandPhase(args)}\n`,
      );
      try {
        const output = await runCli(args, {
          cwd: commandDirectory,
          envOverrides: { ...commonEnv, ...envOverrides },
          nodeLoaderPath: CLI_TS_NODE_LOADER,
          timeoutMs: COMMAND_TIMEOUT_MS,
        });
        logCommandPhase("PASS", args, startedAt);
        await appendFile(
          runLogPath,
          `[${new Date().toISOString()}] PASS ${commandPhase(args)} ${Date.now() - startedAt}ms\n`,
        );
        return output;
      } catch (error) {
        logCommandPhase("FAIL", args, startedAt);
        await appendFile(
          runLogPath,
          `[${new Date().toISOString()}] FAIL ${commandPhase(args)} ${Date.now() - startedAt}ms\n${redactPrivateKeys(String(error))}\n`,
        );
        console.error(
          `[cli-negative-e2e:${PROOF_MODE}] local-chain output at ${commandPhase(args)} failure:\n${serverOutput.slice(-12_000)}`,
        );
        throw new Error(
          `${commandPhase(args)} failed: ${redactPrivateKeys(String(error))}`,
        );
      }
    };

    const adminState = async (): Promise<AdminState> =>
      await readJson<AdminState>(`${baseUrl}/admin/state`);

    const setSlot = async (slot: number): Promise<void> => {
      await postJson(`${baseUrl}/admin/slot/set`, { slot });
    };

    const expectCliFailure = async (
      args: string[],
      expectedMessage?: RegExp,
    ): Promise<ProcessResult> => {
      const submittedBefore = (await adminState()).submittedTransactions;
      const result = await runCliProcess(args, commonEnv, commandDirectory);
      await appendFile(
        runLogPath,
        `[${new Date().toISOString()}] EXPECTED_FAIL ${commandPhase(args)} code=${result.code}\n${redactPrivateKeys(result.stdout)}\n${redactPrivateKeys(result.stderr)}\n`,
      );
      assert.notEqual(result.code, 0, `${commandPhase(args)} must fail`);
      if (expectedMessage) {
        assert.match(`${result.stdout}\n${result.stderr}`, expectedMessage);
      }
      assert.equal(
        (await adminState()).submittedTransactions,
        submittedBefore,
        `${commandPhase(args)} must not submit a transaction`,
      );
      return result;
    };

    const generateKeypairs = async (
      count: number,
    ): Promise<GeneratedKeypair[]> => {
      const output = await cli(["generate-keypairs", String(count), "--json"]);
      return parseJsonResult<{ keypairs: GeneratedKeypair[] }>(
        output,
        "keypairs",
      ).keypairs;
    };

    try {
      console.log(
        `[cli-negative-e2e:${PROOF_MODE}] retained artifacts: ${tempRoot}`,
      );
      await writeFile(
        join(tempRoot, "run-metadata.json"),
        JSON.stringify(
          {
            proofMode: PROOF_MODE,
            proofsEnabled: PROOFS_ENABLED,
            startedAt: new Date().toISOString(),
            commandDirectory,
            sqliteDirectory,
          },
          null,
          2,
        ),
      );
      localBlockchain = startLocalBlockchainTestServer({
        nodePort,
        archivePort,
        proofsEnabled: PROOFS_ENABLED,
      });
      localBlockchain.child.stdout?.on("data", (chunk) => {
        serverOutput += chunk.toString();
      });
      localBlockchain.child.stderr?.on("data", (chunk) => {
        serverOutput += chunk.toString();
      });
      await waitForHealth(baseUrl);

      const initialState = await adminState();
      assert.equal(initialState.proofsEnabled, PROOFS_ENABLED);
      const localWhale = initialState.testAccounts[0];
      assert(localWhale, "The local blockchain must supply a funded account");

      const [treasuryOwner, pauseController, ...participants] =
        await generateKeypairs(7);
      assert(treasuryOwner && pauseController);
      assert.equal(participants.length, 5);
      const participantPublicKeysArg = participants
        .map((participant) => participant.publicKey)
        .join(",");

      const proposalKeypairs = await generateKeypairs(8);
      const proposals = Object.fromEntries(
        [
          "approved",
          "below-participation",
          "abstain-only",
          "rejected",
          "vote-boundary",
          "before-create-window",
          "after-create-window",
          "paused-create",
        ].map((name, index) => [
          name,
          {
            keypair: proposalKeypairs[index]!,
            name,
            recipientPublicKey: PrivateKey.random().toPublicKey().toBase58(),
          } satisfies ProposalFixture,
        ]),
      ) as Record<string, ProposalFixture>;

      const snapshotPath = join(tempRoot, "staking-ledger.json");
      const snapshotOutput = await cli([
        "staking-ledger",
        "create-development-snapshot",
        "--output-path",
        snapshotPath,
        "--treasury-owner-public-key",
        treasuryOwner.publicKey,
        ...participants.flatMap((participant, index) => [
          `--voter-${index + 1}-public-key`,
          participant.publicKey,
        ]),
        "--treasury-owner-balance",
        "1000",
        "--voter-balance",
        "100",
      ]);
      const snapshot = parsePrettyJsonResult<{
        ledgerHashBase58: string;
        stakingEpochDataLedgerHash: string;
        stakingEpochDataLedgerTotalCurrency: string;
      }>(snapshotOutput, "ledgerHashBase58");
      await cli([
        "staking-ledger",
        "from-file",
        "--lifecycle-id",
        LIFECYCLE_ID,
        "--staking-ledger-path",
        snapshotPath,
      ]);
      await postJson(`${baseUrl}/admin/network-state`, {
        stakingEpochDataLedgerHash: snapshot.stakingEpochDataLedgerHash,
        stakingEpochDataLedgerTotalCurrency:
          snapshot.stakingEpochDataLedgerTotalCurrency,
      });

      const stakingProofPath = join(tempRoot, "staking-exhausted.json");
      await cli(["staking-ledger-to-voting-ledger", "compile"]);
      await cli([
        "staking-ledger-to-voting-ledger",
        "trace-digest",
        "--lifecycle-id",
        LIFECYCLE_ID,
      ]);
      await runWorkerFlow(
        "cli-negative-staking",
        commonEnv,
        commandDirectory,
        async (redis) => {
          const redisArgs = [
            "--redis-host",
            redis.host,
            "--redis-port",
            String(redis.port),
            "--queue-name",
            redis.queueName,
          ];
          await cli([
            "staking-ledger-to-voting-ledger",
            "prove-digest",
            "--lifecycle-id",
            LIFECYCLE_ID,
            ...redisArgs,
          ]);
          await cli([
            "staking-ledger-to-voting-ledger",
            "prove-merge",
            "--lifecycle-id",
            LIFECYCLE_ID,
            ...redisArgs,
          ]);
        },
      );
      await cli([
        "staking-ledger-to-voting-ledger",
        "prove-exhaust",
        "--lifecycle-id",
        LIFECYCLE_ID,
        "--proof-output-path",
        stakingProofPath,
      ]);
      const serializedStakingProof = await readFile(stakingProofPath, "utf8");
      const stakingProof = parseSerializedProof(serializedStakingProof);
      assert(stakingProof.proof);
      assert(stakingProof.publicInput);
      assert(stakingProof.publicOutput);
      proofArtifactEvidenceRecords.push(
        proofArtifactEvidence("staking-exhausted", serializedStakingProof),
      );

      for (const participant of participants) {
        await cli([
          "transfer",
          "--sender-private-key",
          localWhale.privateKey,
          "--recipient-public-key",
          participant.publicKey,
          "--amount",
          VOTER_FUNDING_AMOUNT,
          "--fee",
          TX_FEE,
          "--wait",
          "true",
        ]);
      }

      const treasuryDeployedAtSlot = (await adminState()).currentSlot;
      await cli([
        "treasury-owner",
        "deploy",
        "--sender-private-key",
        localWhale.privateKey,
        "--treasury-owner-private-key",
        treasuryOwner.privateKey,
        "--pause-controller-private-key",
        pauseController.privateKey,
        "--treasury-deployed-at-slot",
        String(treasuryDeployedAtSlot),
        "--withdrawal-permission",
        "proofOrSignature",
        "--multisig-participants-public-keys",
        participantPublicKeysArg,
        "--lifecycle-period-duration",
        String(LIFECYCLE_PERIOD_DURATION),
        "--fee",
        TX_FEE,
        "--wait",
        "true",
      ]);
      await cli([
        "treasury-owner",
        "fund-treasury",
        "--sender-private-key",
        localWhale.privateKey,
        "--treasury-owner-public-key",
        treasuryOwner.publicKey,
        "--amount",
        TREASURY_FUNDING_AMOUNT,
        "--lifecycle-period-duration",
        String(LIFECYCLE_PERIOD_DURATION),
        "--fee",
        TX_FEE,
        "--wait",
        "true",
      ]);

      backend = await startLocalE2EBackend({
        runDirectory: join(tempRoot, "backend"),
        resourceId: process.env.E2E_RESOURCE_ID,
        minaNodeUrl,
        archiveNodeUrl,
        treasuryOwnerPublicKey: treasuryOwner.publicKey,
        proofsEnabled: PROOFS_ENABLED,
        env: commonEnv,
      });
      await cli(
        [
          "staking-ledger",
          "from-file",
          "--lifecycle-id",
          LIFECYCLE_ID,
          "--staking-ledger-path",
          snapshotPath,
        ],
        { SQLITE_DATA_DIRECTORY: backend.sqliteDirectory },
      );
      await waitForExactSnapshotProjection(
        backend,
        treasuryOwner.publicKey,
        participants.map((participant) => participant.publicKey),
      );
      const proposalContentPath = join(tempRoot, "proposal.md");
      await writeFile(
        proposalContentPath,
        "# CLI negative E2E proposal\n\nThis content is test data.\n",
      );

      const createArgs = (proposal: ProposalFixture): string[] => [
        "proposal",
        "create",
        "--api-url",
        backend.appApiUrl,
        "--sender-private-key",
        localWhale.privateKey,
        "--treasury-owner-public-key",
        treasuryOwner.publicKey,
        "--proposal-private-key",
        proposal.keypair.privateKey,
        "--proposal-lifecycle-id",
        LIFECYCLE_ID,
        "--recipient-public-key",
        proposal.recipientPublicKey,
        "--amount",
        PROPOSAL_AMOUNT,
        "--content-file",
        proposalContentPath,
        "--lifecycle-period-duration",
        String(LIFECYCLE_PERIOD_DURATION),
        "--fee",
        TX_FEE,
        "--wait",
        "true",
      ];

      const createProposal = async (
        proposal: ProposalFixture,
      ): Promise<void> => {
        const result = parseJsonResult<{
          proposalAddress: string;
          proposalTxHash: string;
        }>(await cli(createArgs(proposal)), "proposalTxHash");
        assert.equal(result.proposalAddress, proposal.keypair.publicKey);
        assert(result.proposalTxHash);
      };

      const proposalState = async (
        proposal: ProposalFixture,
      ): Promise<ProposalState> =>
        parseJsonResult<ProposalState>(
          await cli([
            "proposal",
            "read-state",
            "--treasury-owner-public-key",
            treasuryOwner.publicKey,
            "--proposal-public-key",
            proposal.keypair.publicKey,
          ]),
          "proposalAddress",
        );

      const buildMultisigSignatures = async (
        action: "pause-treasury" | "unpause-treasury",
        nonce: number,
      ): Promise<string> => {
        const slots = Array.from({ length: participants.length }, () => "");
        for (const participant of participants.slice(0, 3)) {
          const output = await cli([
            "multisig-sign",
            action,
            "--multisig-participants-public-keys",
            participantPublicKeysArg,
            "--multisig-signer-private-key",
            participant.privateKey,
            "--nonce",
            String(nonce),
          ]);
          const partial = parseJsonResult<MultisigResult>(output, "signature");
          slots[partial.signerParticipantIndex] = partial.signature;
        }
        return slots.join(",");
      };

      const setTreasuryPaused = async (paused: boolean): Promise<void> => {
        const action = paused ? "pause-treasury" : "unpause-treasury";
        const nonce = await accountNonce(
          minaNodeUrl,
          pauseController.publicKey,
        );
        const signatures = await buildMultisigSignatures(action, nonce);
        await cli([
          "pause-controller",
          action,
          "--sender-private-key",
          localWhale.privateKey,
          "--pause-controller-public-key",
          pauseController.publicKey,
          "--multisig-participants-public-keys",
          participantPublicKeysArg,
          "--multisig-signatures",
          signatures,
          "--fee",
          TX_FEE,
          "--wait",
          "true",
        ]);
      };

      await context.test(
        "S30-001 create one slot before proposal period rejects",
        async () => {
          await setSlot(treasuryDeployedAtSlot - 1);
          await expectCliFailure(
            createArgs(proposals["before-create-window"]!),
          );
        },
      );

      await context.test(
        "S30 boundary create at first proposal slot accepts",
        async () => {
          await setSlot(treasuryDeployedAtSlot);
          await createProposal(proposals.approved!);
        },
      );

      for (const name of ["below-participation", "abstain-only", "rejected"]) {
        await setSlot(treasuryDeployedAtSlot);
        await createProposal(proposals[name]!);
      }

      await context.test(
        "S30 boundary create at last proposal slot accepts",
        async () => {
          await setSlot(treasuryDeployedAtSlot + LIFECYCLE_PERIOD_DURATION);
          await createProposal(proposals["vote-boundary"]!);
        },
      );

      await context.test(
        "S30-002 create one slot after proposal period rejects",
        async () => {
          await setSlot(treasuryDeployedAtSlot + LIFECYCLE_PERIOD_DURATION + 1);
          await expectCliFailure(createArgs(proposals["after-create-window"]!));
        },
      );

      await context.test(
        "S60-001 create while globally paused rejects without state change",
        async () => {
          await setTreasuryPaused(true);
          try {
            await setSlot(treasuryDeployedAtSlot);
            await expectCliFailure(
              createArgs(proposals["paused-create"]!),
              /Treasury is paused/u,
            );
          } finally {
            await setTreasuryPaused(false);
          }
        },
      );

      const voteArgs = (
        proposal: ProposalFixture,
        participant: GeneratedKeypair,
        vote: VoteChoice,
      ): string[] => [
        "proposal",
        "vote",
        "--sender-private-key",
        participant.privateKey,
        "--treasury-owner-public-key",
        treasuryOwner.publicKey,
        "--proposal-public-key",
        proposal.keypair.publicKey,
        "--voter-private-key",
        participant.privateKey,
        "--vote",
        vote,
        "--lifecycle-period-duration",
        String(LIFECYCLE_PERIOD_DURATION),
        "--fee",
        TX_FEE,
        "--wait",
        "true",
      ];

      const vote = async (
        proposal: ProposalFixture,
        participant: GeneratedKeypair,
        choice: VoteChoice,
      ): Promise<void> => {
        await cli(voteArgs(proposal, participant, choice));
      };

      const fetchActionCount = async (
        proposal: ProposalFixture,
        suffix: string,
      ): Promise<number> => {
        const output = await cli([
          "proposal",
          "fetch-actions",
          "--archive-node-url",
          archiveNodeUrl,
          "--treasury-owner-public-key",
          treasuryOwner.publicKey,
          "--proposal-public-key",
          proposal.keypair.publicKey,
          "--output-path",
          join(tempRoot, `actions-${suffix}.json`),
        ]);
        return parseJsonResult<{ count: number }>(output, "count").count;
      };

      const votingStart =
        treasuryDeployedAtSlot + LIFECYCLE_PERIOD_DURATION * 2;
      await context.test(
        "S30-007 vote one slot before voting period rejects",
        async () => {
          await setSlot(votingStart - 1);
          await expectCliFailure(
            voteArgs(proposals["vote-boundary"]!, participants[0]!, "yay"),
          );
          assert.equal(
            await fetchActionCount(proposals["vote-boundary"]!, "before-vote"),
            0,
          );
        },
      );

      await context.test(
        "S30 boundary vote at first voting slot accepts",
        async () => {
          await setSlot(votingStart);
          await vote(proposals["vote-boundary"]!, participants[0]!, "yay");
        },
      );

      await context.test(
        "S30 boundary vote at last voting slot accepts",
        async () => {
          await setSlot(votingStart + LIFECYCLE_PERIOD_DURATION);
          await vote(proposals["vote-boundary"]!, participants[1]!, "yay");
        },
      );

      await context.test(
        "S30-008 vote one slot after voting period rejects",
        async () => {
          const actionsBefore = await fetchActionCount(
            proposals["vote-boundary"]!,
            "vote-after-before",
          );
          await setSlot(votingStart + LIFECYCLE_PERIOD_DURATION + 1);
          await expectCliFailure(
            voteArgs(proposals["vote-boundary"]!, participants[2]!, "yay"),
          );
          assert.equal(
            await fetchActionCount(
              proposals["vote-boundary"]!,
              "vote-after-after",
            ),
            actionsBefore,
          );
        },
      );

      await context.test(
        "S60-002 vote while globally paused rejects without an action",
        async () => {
          await setSlot(votingStart);
          await setTreasuryPaused(true);
          try {
            const actionsBefore = await fetchActionCount(
              proposals.approved!,
              "paused-vote-before",
            );
            await setSlot(votingStart);
            await expectCliFailure(
              voteArgs(proposals.approved!, participants[0]!, "yay"),
              /Treasury is paused/u,
            );
            assert.equal(
              await fetchActionCount(proposals.approved!, "paused-vote-after"),
              actionsBefore,
            );
          } finally {
            await setTreasuryPaused(false);
          }
        },
      );

      await setSlot(votingStart);
      for (const participant of participants) {
        await vote(proposals.approved!, participant, "yay");
      }
      await setSlot(votingStart);
      for (let index = 0; index < 5; index += 1) {
        await vote(proposals["below-participation"]!, participants[0]!, "yay");
      }
      await setSlot(votingStart);
      for (const participant of participants) {
        await vote(proposals["abstain-only"]!, participant, "abstain");
      }
      await setSlot(votingStart);
      for (const [index, participant] of participants.entries()) {
        await vote(proposals.rejected!, participant, index < 2 ? "yay" : "nay");
      }

      const cooldownStart =
        treasuryDeployedAtSlot + LIFECYCLE_PERIOD_DURATION * 3;
      await setSlot(cooldownStart);
      await cli(["vote-reducer", "compile"]);

      const voteProofPaths = new Map<string, string>();
      const buildVoteProof = async (
        proposal: ProposalFixture,
        redis: RedisFixture,
      ): Promise<void> => {
        const actionsPath = join(tempRoot, `actions-${proposal.name}.json`);
        const actionsOutput = await cli([
          "proposal",
          "fetch-actions",
          "--archive-node-url",
          archiveNodeUrl,
          "--treasury-owner-public-key",
          treasuryOwner.publicKey,
          "--proposal-public-key",
          proposal.keypair.publicKey,
          "--output-path",
          actionsPath,
        ]);
        assert.equal(
          parseJsonResult<{ count: number }>(actionsOutput, "count").count,
          5,
          `${proposal.name} must have five action states`,
        );
        await cli([
          "vote-reducer",
          "clear-state",
          "--lifecycle-id",
          LIFECYCLE_ID,
        ]);
        await cli([
          "vote-reducer",
          "trace-run-batch",
          "--lifecycle-id",
          LIFECYCLE_ID,
          "--vote-actions-path",
          actionsPath,
        ]);
        const proofOutputPath = join(
          tempRoot,
          `vote-proof-${proposal.name}.json`,
        );
        const redisArgs = [
          "--redis-host",
          redis.host,
          "--redis-port",
          String(redis.port),
          "--queue-name",
          redis.queueName,
        ];
        await cli([
          "vote-reducer",
          "prove-run-batch",
          "--lifecycle-id",
          LIFECYCLE_ID,
          ...redisArgs,
        ]);
        await cli([
          "vote-reducer",
          "prove-merge",
          "--lifecycle-id",
          LIFECYCLE_ID,
          ...redisArgs,
          "--proof-output-path",
          proofOutputPath,
        ]);
        const serializedProof = await readFile(proofOutputPath, "utf8");
        const proof = parseSerializedProof(serializedProof);
        assert(proof.proof);
        assert(proof.publicInput);
        assert(proof.publicOutput);
        proofArtifactEvidenceRecords.push(
          proofArtifactEvidence(`vote-${proposal.name}`, serializedProof),
        );
        voteProofPaths.set(proposal.name, proofOutputPath);
      };

      await runWorkerFlow(
        "cli-negative-votes",
        commonEnv,
        commandDirectory,
        async (redis) => {
          for (const proposal of [
            proposals.approved!,
            proposals["below-participation"]!,
            proposals["abstain-only"]!,
            proposals.rejected!,
          ]) {
            await buildVoteProof(proposal, redis);
          }
        },
      );

      const tallyArgs = (
        proposal: ProposalFixture,
        voteReducerProofPath = voteProofPaths.get(proposal.name)!,
      ): string[] => [
        "proposal",
        "tally-votes",
        "--sender-private-key",
        localWhale.privateKey,
        "--treasury-owner-public-key",
        treasuryOwner.publicKey,
        "--proposal-public-key",
        proposal.keypair.publicKey,
        "--vote-reducer-proof-path",
        voteReducerProofPath,
        "--staking-ledger-to-voting-ledger-proof-path",
        stakingProofPath,
        "--lifecycle-id",
        LIFECYCLE_ID,
        "--lifecycle-period-duration",
        String(LIFECYCLE_PERIOD_DURATION),
        "--fee",
        TX_FEE,
        "--wait",
        "true",
      ];

      const expectTallyFailure = async (
        proposal: ProposalFixture,
        expectedMessage?: RegExp,
        voteReducerProofPath?: string,
      ): Promise<void> => {
        const before = await proposalState(proposal);
        await expectCliFailure(
          tallyArgs(proposal, voteReducerProofPath),
          expectedMessage,
        );
        const after = await proposalState(proposal);
        assert.equal(after.status, before.status);
        assert.equal(after.paidOutAmount, before.paidOutAmount);
      };

      const writeProofVariant = async (
        name: string,
        sourceProofPath: string,
        mutate: (proof: SerializedProof) => void,
      ): Promise<string> => {
        const proof = parseSerializedProof(
          await readFile(sourceProofPath, "utf8"),
        );
        mutate(proof);
        const serialized = JSON.stringify(proof);
        const outputPath = join(tempRoot, `vote-proof-${name}.json`);
        await writeFile(outputPath, serialized);
        proofArtifactEvidenceRecords.push(
          proofArtifactEvidence(name, serialized),
        );
        return outputPath;
      };

      await context.test(
        "S30 tally one slot before cooldown rejects",
        async () => {
          await setSlot(cooldownStart - 1);
          await expectTallyFailure(proposals.approved!);
        },
      );

      await context.test(
        "S60-003 tally while globally paused rejects without state change",
        async () => {
          await setSlot(cooldownStart);
          await setTreasuryPaused(true);
          try {
            await setSlot(cooldownStart);
            await expectTallyFailure(
              proposals.approved!,
              /Treasury is paused/u,
            );
          } finally {
            await setTreasuryPaused(false);
          }
        },
      );

      await context.test(
        "S30-016a JSON parser rejects malformed vote proof JSON before submission",
        async () => {
          await setSlot(cooldownStart);
          const malformedPath = join(
            tempRoot,
            "vote-proof-malformed-json.json",
          );
          const malformed = "{not-valid-json";
          await writeFile(malformedPath, malformed);
          proofArtifactEvidenceRecords.push(
            proofArtifactEvidence("malformed-json", malformed),
          );
          await expectTallyFailure(
            proposals.approved!,
            /Expected property name or '\}' in JSON/u,
            malformedPath,
          );
        },
      );

      await context.test(
        "S30-016b Pickles parser rejects malformed vote proof bytes before submission",
        async () => {
          await setSlot(cooldownStart);
          const malformedProofPath = await writeProofVariant(
            "malformed-bytes",
            voteProofPaths.get("approved")!,
            (proof) => {
              proof.proof = "not-a-valid-pickles-proof";
            },
          );
          await expectTallyFailure(
            proposals.approved!,
            /Malformed input/u,
            malformedProofPath,
          );
        },
      );

      await context.test(
        "S30-016c contract rejects a mutated fromActionsHash before proof verification",
        async () => {
          await setSlot(cooldownStart);
          const mutatedInputPath = await writeProofVariant(
            "mutated-public-input",
            voteProofPaths.get("approved")!,
            (proof) => {
              proof.publicInput[0] = "0";
            },
          );
          await expectTallyFailure(
            proposals.approved!,
            /fromActionsHash should be the initial action state/u,
            mutatedInputPath,
          );
        },
      );

      await context.test(
        "S30-016d contract rejects an unknown output action state before proof verification",
        async () => {
          await setSlot(cooldownStart);
          const mutatedOutputPath = await writeProofVariant(
            "mutated-public-output",
            voteProofPaths.get("approved")!,
            (proof) => {
              proof.publicOutput[6] = "0";
            },
          );
          await expectTallyFailure(
            proposals.approved!,
            /Action state not found in the merkle list/u,
            mutatedOutputPath,
          );
        },
      );

      await context.test(
        "S30-016e contract rejects insufficient participation before proof verification",
        async () => {
          await setSlot(cooldownStart);
          const incompatibleProofPath = await writeProofVariant(
            "incompatible-program-body",
            voteProofPaths.get("below-participation")!,
            (proof) => {
              proof.proof = stakingProof.proof;
            },
          );
          // This case does not test proof authenticity. The participation
          // constraint rejects the public statement before proof verification.
          await expectTallyFailure(
            proposals["below-participation"]!,
            /Participation not met/u,
            incompatibleProofPath,
          );
        },
      );

      await context.test(
        "S30-023 supporting SDK proof boundary rejects a same-program proof-body swap only with proofs enabled",
        async () => {
          await setSlot(cooldownStart);
          const originalProofJson = JSON.parse(
            await readFile(voteProofPaths.get("approved")!, "utf8"),
          ) as JsonProof;
          const donorProofJson = JSON.parse(
            await readFile(voteProofPaths.get("rejected")!, "utf8"),
          ) as JsonProof;
          const stakingProofJson = JSON.parse(
            await readFile(stakingProofPath, "utf8"),
          ) as JsonProof;
          const alteredProofJson: JsonProof = {
            ...originalProofJson,
            publicInput: [...originalProofJson.publicInput],
            publicOutput: [...originalProofJson.publicOutput],
            proof: donorProofJson.proof,
          };
          const [
            originalProgramProof,
            donorProgramProof,
            alteredProgramProof,
            originalProof,
            alteredProof,
            typedStakingProof,
          ] = await Promise.all([
            VoteReducerProof.fromJSON(originalProofJson),
            VoteReducerProof.fromJSON(donorProofJson),
            VoteReducerProof.fromJSON(alteredProofJson),
            SideLoadedVoteReducerProof.fromJSON(originalProofJson),
            SideLoadedVoteReducerProof.fromJSON(alteredProofJson),
            SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(
              stakingProofJson,
            ),
          ]);

          const service = new SqliteTreasuryOwnerService();
          await service.compile({
            proofsEnabled: PROOFS_ENABLED,
            lifecyclePeriodDuration: UInt32.from(LIFECYCLE_PERIOD_DURATION),
            cachePath: join(commandDirectory, "cache"),
          });
          assert.equal(VoteReducer.proofsEnabled, PROOFS_ENABLED);
          configureMinaNetwork(minaNodeUrl, "testnet");

          const originalVerify = await VoteReducer.verify(originalProgramProof);
          const donorVerify = await VoteReducer.verify(donorProgramProof);
          const alteredVerify = await VoteReducer.verify(alteredProgramProof);
          const donorStatementDiffers =
            JSON.stringify({
              publicInput: donorProofJson.publicInput,
              publicOutput: donorProofJson.publicOutput,
            }) !==
            JSON.stringify({
              publicInput: originalProofJson.publicInput,
              publicOutput: originalProofJson.publicOutput,
            });
          const donorProofBodyDiffers =
            donorProofJson.proof !== originalProofJson.proof;

          assert.equal(originalVerify, true);
          assert.equal(donorVerify, true);
          assert.equal(alteredVerify, !PROOFS_ENABLED);
          if (PROOFS_ENABLED) {
            assert.equal(donorStatementDiffers, true);
            assert.equal(donorProofBodyDiffers, true);
          }

          type ProjectionSnapshot = {
            proposal: {
              contractStatus: unknown;
              contractStatusFinality: unknown;
              creationObservationStatus: unknown;
              isPaused: unknown;
              paidOutAmount: unknown;
              proposalPublicKey: unknown;
              status: unknown;
            };
            votes: {
              items: Array<{
                isNullified: unknown;
                status: unknown;
                vote: unknown;
                voteWeight: unknown;
                voterPublicKey: unknown;
              }>;
              total: unknown;
            };
          };

          const normalizeProjection = (
            proposal: Record<string, unknown>,
            votes: Array<Record<string, unknown>>,
            total: unknown,
            proposalPublicKey: string,
          ): ProjectionSnapshot => ({
            proposal: {
              proposalPublicKey: proposal.proposalPublicKey,
              status: proposal.status,
              contractStatus: proposal.contractStatus,
              contractStatusFinality: proposal.contractStatusFinality,
              creationObservationStatus: proposal.creationObservationStatus,
              isPaused: proposal.isPaused,
              paidOutAmount: proposal.paidOutAmount,
            },
            votes: {
              total,
              items: votes
                .filter((vote) => vote.proposalPublicKey === proposalPublicKey)
                .map((vote) => ({
                  voterPublicKey: vote.voterPublicKey,
                  vote: vote.vote,
                  voteWeight: vote.voteWeight,
                  isNullified: vote.isNullified,
                  status: vote.status,
                }))
                .sort((left, right) =>
                  String(left.voterPublicKey).localeCompare(
                    String(right.voterPublicKey),
                  ),
                ),
            },
          });

          const readAppProjection = async (
            proposalPublicKey: string,
          ): Promise<ProjectionSnapshot> => {
            const proposal = await readJson<Record<string, unknown>>(
              `${backend!.appApiUrl}/proposals/${proposalPublicKey}`,
            );
            const votes = await readJson<{
              items: Array<Record<string, unknown>>;
              total: unknown;
            }>(
              `${backend!.appApiUrl}/proposals/${proposalPublicKey}/votes?limit=20`,
            );
            return normalizeProjection(
              proposal,
              votes.items,
              votes.total,
              proposalPublicKey,
            );
          };

          const readProcessorProjections = async (): Promise<
            Map<string, ProjectionSnapshot>
          > => {
            const response = await readJson<{
              data: Array<
                Record<string, unknown> & {
                  votes?: Array<Record<string, unknown>>;
                }
              >;
            }>(
              `${backend!.processorApiUrl}/proposals?join=votes&sort=proposalPublicKey,ASC&limit=200`,
            );
            return new Map(
              response.data.map((proposal) => {
                const proposalPublicKey = String(
                  proposal.proposalPublicKey ?? "",
                );
                const votes = proposal.votes ?? [];
                return [
                  proposalPublicKey,
                  normalizeProjection(
                    proposal,
                    votes,
                    votes.length,
                    proposalPublicKey,
                  ),
                ];
              }),
            );
          };

          const waitForProjectionCatchUp = async () => {
            const deadline = Date.now() + 60_000;
            let lastError: unknown;
            while (Date.now() < deadline) {
              try {
                await assertBackendReadyAndCaughtUp(backend!);
                const selectedProposals = [
                  proposals.approved!,
                  proposals.rejected!,
                ];
                const appSnapshots = await Promise.all(
                  selectedProposals.map(
                    async (proposal) =>
                      await readAppProjection(proposal.keypair.publicKey),
                  ),
                );
                const processorProjections = await readProcessorProjections();
                const processorSnapshots = selectedProposals.map((proposal) => {
                  const snapshot = processorProjections.get(
                    proposal.keypair.publicKey,
                  );
                  assert(
                    snapshot,
                    `Processor projection is missing proposal ${proposal.keypair.publicKey}`,
                  );
                  return snapshot;
                });
                const snapshots = [...appSnapshots, ...processorSnapshots];
                assert(
                  snapshots.every(
                    (snapshot) =>
                      snapshot.votes.total === 5 &&
                      snapshot.votes.items.length === 5,
                  ),
                );
                const expectedVotes = [
                  participants.map((participant) => ({
                    voterPublicKey: participant.publicKey,
                    vote: "yay",
                    voteWeight: "100000000000",
                    isNullified: false,
                    status: "canonical",
                  })),
                  participants.map((participant, index) => ({
                    voterPublicKey: participant.publicKey,
                    vote: index < 2 ? "yay" : "nay",
                    voteWeight: "100000000000",
                    isNullified: false,
                    status: "canonical",
                  })),
                ].map((votes) =>
                  votes.sort((left, right) =>
                    left.voterPublicKey.localeCompare(right.voterPublicKey),
                  ),
                );
                for (const [index, snapshot] of snapshots.entries()) {
                  assert.deepEqual(
                    snapshot.votes.items,
                    expectedVotes[index % expectedVotes.length],
                  );
                }
                return snapshots;
              } catch (error) {
                lastError = error;
                await sleep(250);
              }
            }
            throw new Error(
              `Timed out waiting for protected projections: ${redactPrivateKeys(String(lastError))}`,
            );
          };

          await waitForProjectionCatchUp();
          const previousSqliteDirectory = process.env.SQLITE_DATA_DIRECTORY;
          process.env.SQLITE_DATA_DIRECTORY = sqliteDirectory;
          try {
            const treasuryOwnerPublicKey = PublicKey.fromBase58(
              treasuryOwner.publicKey,
            );
            const proposalPublicKey = PublicKey.fromBase58(
              proposals.approved!.keypair.publicKey,
            );
            const senderPublicKey = PublicKey.fromBase58(localWhale.publicKey);
            const { treasuryOwnerAccount, treasuryOwnerAccountWitness } =
              await service.getTreasuryOwnerProofInputsFromSqliteStakingLedger(
                LIFECYCLE_ID,
                treasuryOwnerPublicKey,
              );

            const protectedState = async () => {
              const state = await adminState();
              return {
                chain: {
                  currentSlot: state.currentSlot,
                  senderBalance: await accountBalance(
                    minaNodeUrl,
                    localWhale.publicKey,
                  ),
                  senderNonce: await accountNonce(
                    minaNodeUrl,
                    localWhale.publicKey,
                  ),
                  submittedTransactions: state.submittedTransactions,
                  treasuryBalance: await accountBalance(
                    minaNodeUrl,
                    treasuryOwner.publicKey,
                  ),
                },
                proposal: await service.getProposalState({
                  minaNodeUrl,
                  treasuryOwnerPublicKey,
                  proposalPublicKey,
                }),
                projections: await waitForProjectionCatchUp(),
              };
            };

            const SIGNER_BARRIER = "SUPPORTING_PROOF_BOUNDARY_SIGNER_BARRIER";
            const attemptTally = async (
              voteReducerProof: SideLoadedVoteReducerProof,
            ): Promise<{ error: string; reachedSigner: boolean }> => {
              let reachedSigner = false;
              const transactionSigner: TransactionSigner = async () => {
                reachedSigner = true;
                throw new Error(SIGNER_BARRIER);
              };
              try {
                await service.tallyVotes({
                  minaNodeUrl,
                  senderPublicKey,
                  transactionSigner,
                  treasuryOwnerPublicKey,
                  proposalPublicKey,
                  voteReducerProof,
                  stakingLedgerToVotingLedgerProof: typedStakingProof,
                  treasuryOwnerAccount,
                  treasuryOwnerAccountWitness,
                  fee: UInt64.from(TX_FEE),
                  wait: false,
                });
              } catch (error) {
                return {
                  error: redactPrivateKeys(
                    error instanceof Error ? error.message : String(error),
                  ).slice(0, 4_000),
                  reachedSigner,
                };
              }
              throw new Error("The signer barrier did not stop tallyVotes");
            };

            const before = await protectedState();
            const originalAttempt = await attemptTally(originalProof);
            assert.equal(originalAttempt.reachedSigner, true);
            assert.equal(originalAttempt.error, SIGNER_BARRIER);

            const alteredAttempt = await attemptTally(alteredProof);
            assert.equal(alteredAttempt.reachedSigner, !PROOFS_ENABLED);
            if (PROOFS_ENABLED) {
              assert.notEqual(alteredAttempt.error, SIGNER_BARRIER);
              assert(alteredAttempt.error.length > 0);
            } else {
              assert.equal(alteredAttempt.error, SIGNER_BARRIER);
            }

            const after = await protectedState();
            assert.deepEqual(after, before);
            supportingProofBoundaryEvidence = {
              label: "supporting-sdk-proof-boundary-integration",
              programProofsEnabled: VoteReducer.proofsEnabled,
              originalVerify,
              donorVerify,
              alteredVerify,
              donorStatementDiffers,
              donorProofBodyDiffers,
              originalReachedSigner: originalAttempt.reachedSigner,
              alteredReachedSigner: alteredAttempt.reachedSigner,
              alteredFailureLayer: PROOFS_ENABLED
                ? "before-signing"
                : "signer-barrier",
              alteredError: alteredAttempt.error,
              protectedStateUnchanged: true,
            };
          } finally {
            if (previousSqliteDirectory === undefined) {
              delete process.env.SQLITE_DATA_DIRECTORY;
            } else {
              process.env.SQLITE_DATA_DIRECTORY = previousSqliteDirectory;
            }
          }
        },
      );

      await context.test(
        "S30 boundary tally at first cooldown slot accepts",
        async () => {
          await setSlot(cooldownStart);
          const output = await cli(tallyArgs(proposals.approved!));
          assert(
            parseJsonResult<{ tallyTxHash: string }>(output, "tallyTxHash")
              .tallyTxHash,
          );
          assert.equal(
            (await proposalState(proposals.approved!)).status,
            "approved",
          );
        },
      );

      await context.test(
        "S30-017 a second tally rejects and keeps the approved result",
        async () => {
          await expectTallyFailure(
            proposals.approved!,
            /Vote result already set/u,
          );
          assert.equal(
            (await proposalState(proposals.approved!)).status,
            "approved",
          );
        },
      );

      await context.test(
        "S30-014 below-participation tally keeps UNKNOWN",
        async () => {
          await setSlot(cooldownStart);
          await expectTallyFailure(
            proposals["below-participation"]!,
            /Participation not met/u,
          );
          assert.equal(
            (await proposalState(proposals["below-participation"]!)).status,
            "unknown",
          );
        },
      );

      await context.test(
        "S30-015 abstain-only tally keeps UNKNOWN",
        async () => {
          await setSlot(cooldownStart);
          await expectTallyFailure(
            proposals["abstain-only"]!,
            /No approval votes cast/u,
          );
          assert.equal(
            (await proposalState(proposals["abstain-only"]!)).status,
            "unknown",
          );
        },
      );

      await context.test("S30 rejected vote result is recorded", async () => {
        await setSlot(cooldownStart);
        await cli(tallyArgs(proposals.rejected!));
        assert.equal(
          (await proposalState(proposals.rejected!)).status,
          "rejected",
        );
      });

      const executeArgs = (
        proposal: ProposalFixture,
        recipientPublicKey: string,
        amount?: bigint,
      ): string[] => [
        "proposal",
        "execute",
        "--sender-private-key",
        localWhale.privateKey,
        "--treasury-owner-public-key",
        treasuryOwner.publicKey,
        "--proposal-public-key",
        proposal.keypair.publicKey,
        "--recipient-public-key",
        recipientPublicKey,
        ...(amount === undefined
          ? []
          : ["--amount-to-pay-out", amount.toString()]),
        "--lifecycle-period-duration",
        String(LIFECYCLE_PERIOD_DURATION),
        "--fee",
        TX_FEE,
        "--wait",
        "true",
      ];

      const expectExecuteFailure = async (
        proposal: ProposalFixture,
        recipientPublicKey: string,
        amount: bigint | undefined,
        expectedMessage?: RegExp,
      ): Promise<void> => {
        const stateBefore = await proposalState(proposal);
        const ownerBalanceBefore = await accountBalance(
          minaNodeUrl,
          treasuryOwner.publicKey,
        );
        const recipientBalanceBefore = await accountBalance(
          minaNodeUrl,
          recipientPublicKey,
        );
        await expectCliFailure(
          executeArgs(proposal, recipientPublicKey, amount),
          expectedMessage,
        );
        const stateAfter = await proposalState(proposal);
        assert.equal(stateAfter.status, stateBefore.status);
        assert.equal(stateAfter.paidOutAmount, stateBefore.paidOutAmount);
        assert.equal(
          await accountBalance(minaNodeUrl, treasuryOwner.publicKey),
          ownerBalanceBefore,
        );
        assert.equal(
          await accountBalance(minaNodeUrl, recipientPublicKey),
          recipientBalanceBefore,
        );
      };

      const executionStart =
        treasuryDeployedAtSlot + LIFECYCLE_PERIOD_DURATION * 4;
      await context.test(
        "S30-019 execute one slot before the next lifecycle rejects",
        async () => {
          await setSlot(executionStart - 1);
          await expectExecuteFailure(
            proposals.approved!,
            proposals.approved!.recipientPublicKey,
            1n,
          );
        },
      );

      await context.test(
        "S60-004 execute while globally paused rejects without state change",
        async () => {
          await setSlot(executionStart);
          await setTreasuryPaused(true);
          try {
            await setSlot(executionStart);
            await expectExecuteFailure(
              proposals.approved!,
              proposals.approved!.recipientPublicKey,
              1n,
              /Treasury is paused/u,
            );
          } finally {
            await setTreasuryPaused(false);
          }
        },
      );

      await context.test(
        "S30 boundary execute at first next-lifecycle slot accepts zero",
        async () => {
          await setSlot(executionStart);
          const before = await proposalState(proposals.approved!);
          const recipientBalanceBefore = await accountBalance(
            minaNodeUrl,
            proposals.approved!.recipientPublicKey,
          );
          const output = await cli(
            executeArgs(
              proposals.approved!,
              proposals.approved!.recipientPublicKey,
              0n,
            ),
          );
          const result = parseJsonResult<{
            amountToPayOut: string;
            executeTxHash: string;
          }>(output, "executeTxHash");
          assert.equal(result.amountToPayOut, "0");
          assert(result.executeTxHash);
          const after = await proposalState(proposals.approved!);
          assert.equal(after.paidOutAmount, before.paidOutAmount);
          assert.equal(
            await accountBalance(
              minaNodeUrl,
              proposals.approved!.recipientPublicKey,
            ),
            recipientBalanceBefore,
          );
        },
      );

      await context.test(
        "S30-018 rejected proposal cannot execute",
        async () => {
          await setSlot(executionStart);
          await expectExecuteFailure(
            proposals.rejected!,
            proposals.rejected!.recipientPublicKey,
            1n,
            /Proposal not approved/u,
          );
        },
      );

      await context.test(
        "S30-020 recipient mismatch rejects without a payout",
        async () => {
          await setSlot(executionStart);
          await expectExecuteFailure(
            proposals.approved!,
            PrivateKey.random().toPublicKey().toBase58(),
            1n,
            /Recipient hash does not match on chain state/u,
          );
        },
      );

      await context.test(
        "S30-021 partial payout updates the recipient and paidOutAmount",
        async () => {
          await setSlot(executionStart);
          const balanceBefore = await accountBalance(
            minaNodeUrl,
            proposals.approved!.recipientPublicKey,
          );
          await cli(
            executeArgs(
              proposals.approved!,
              proposals.approved!.recipientPublicKey,
              PARTIAL_PAYOUT_AMOUNT,
            ),
          );
          assert.equal(
            (await proposalState(proposals.approved!)).paidOutAmount,
            PARTIAL_PAYOUT_AMOUNT.toString(),
          );
          assert.equal(
            (await accountBalance(
              minaNodeUrl,
              proposals.approved!.recipientPublicKey,
            )) - balanceBefore,
            PARTIAL_PAYOUT_AMOUNT,
          );
        },
      );

      await context.test(
        "S30-021 over-remaining payout rejects without state change",
        async () => {
          await setSlot(executionStart);
          await expectExecuteFailure(
            proposals.approved!,
            proposals.approved!.recipientPublicKey,
            EXACT_REMAINING_PAYOUT_AMOUNT + 1n,
            /Amount to pay out is greater than the remaining amount to pay out/u,
          );
        },
      );

      await context.test(
        "S30-021 exact remaining payout completes the amount with bond",
        async () => {
          await setSlot(executionStart);
          const balanceBefore = await accountBalance(
            minaNodeUrl,
            proposals.approved!.recipientPublicKey,
          );
          await cli(
            executeArgs(
              proposals.approved!,
              proposals.approved!.recipientPublicKey,
              EXACT_REMAINING_PAYOUT_AMOUNT,
            ),
          );
          assert.equal(
            (await proposalState(proposals.approved!)).paidOutAmount,
            PROPOSAL_PAYOUT_AMOUNT.toString(),
          );
          assert.equal(
            (await accountBalance(
              minaNodeUrl,
              proposals.approved!.recipientPublicKey,
            )) - balanceBefore,
            EXACT_REMAINING_PAYOUT_AMOUNT,
          );
        },
      );

      await context.test(
        "S30-022 records current omitted-amount zero execution after completion",
        async () => {
          // The service defaults an omitted amount to the remaining amount. The
          // current contract permits zero, while the user guide requires an
          // execution amount greater than zero. This test records the current
          // operator-path behavior without changing the product requirement.
          await setSlot(executionStart);
          const submittedBefore = (await adminState()).submittedTransactions;
          const stateBefore = await proposalState(proposals.approved!);
          const balanceBefore = await accountBalance(
            minaNodeUrl,
            proposals.approved!.recipientPublicKey,
          );
          const output = await cli(
            executeArgs(
              proposals.approved!,
              proposals.approved!.recipientPublicKey,
            ),
          );
          const result = parseJsonResult<{
            amountToPayOut: string;
            executeTxHash: string;
          }>(output, "executeTxHash");
          assert.equal(result.amountToPayOut, "0");
          assert(result.executeTxHash);
          assert.equal(
            (await adminState()).submittedTransactions,
            submittedBefore + 1,
          );
          assert.equal(
            (await proposalState(proposals.approved!)).paidOutAmount,
            stateBefore.paidOutAmount,
          );
          assert.equal(
            await accountBalance(
              minaNodeUrl,
              proposals.approved!.recipientPublicKey,
            ),
            balanceBefore,
          );
        },
      );

      await context.test(
        "S30-022 explicit positive execution after completion rejects",
        async () => {
          await setSlot(executionStart);
          await expectExecuteFailure(
            proposals.approved!,
            proposals.approved!.recipientPublicKey,
            1n,
            /Amount to pay out is greater than the remaining amount to pay out/u,
          );
        },
      );

      const finalState = await adminState();
      assert.equal(finalState.proofsEnabled, PROOFS_ENABLED);
      assert.match(
        serverOutput,
        new RegExp(`proofs enabled: ${PROOFS_ENABLED_VALUE}`, "u"),
      );
      completed = true;
    } finally {
      const cleanupResults = await Promise.allSettled([
        backend?.dispose() ?? Promise.resolve(),
        localBlockchain?.stop() ?? Promise.resolve(),
      ]);
      const cleanupErrors = cleanupResults.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      console.log(
        `[cli-negative-e2e:${PROOF_MODE}] artifacts retained: ${tempRoot}`,
      );
      if (publicArtifactDirectory) {
        await writeFile(
          join(publicArtifactDirectory, "cli-negative-evidence.json"),
          JSON.stringify(
            {
              schemaVersion: 1,
              suite: "cli-negative",
              proofMode: PROOF_MODE,
              proofsEnabled: PROOFS_ENABLED,
              startedAt,
              finishedAt: new Date().toISOString(),
              completed,
              privateRunArtifactsRetained: true,
              proofArtifacts: proofArtifactEvidenceRecords,
              supportingProofBoundary: supportingProofBoundaryEvidence ?? null,
            },
            null,
            2,
          ),
        );
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(cleanupErrors, "CLI negative cleanup failed");
      }
    }
  },
);
