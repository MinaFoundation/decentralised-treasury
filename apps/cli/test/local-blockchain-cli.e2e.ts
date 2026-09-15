import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PrivateKey, PublicKey } from "o1js";
import { RedisMemoryServer } from "redis-memory-server";
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
import { assertApprovedProposalProjectionStatus } from "./utils/proposal-projection-assertions.js";
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
const PROPOSAL_PAYOUT_AMOUNT = "1100000000";
const EMERGENCY_WITHDRAWAL_AMOUNT = "1000000000";
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
if (!Number.isSafeInteger(COMMAND_TIMEOUT_MS) || COMMAND_TIMEOUT_MS <= 0) {
  throw new Error("CLI_E2E_COMMAND_TIMEOUT_MS must be a positive integer");
}
const TEST_TIMEOUT_MS = PROOFS_ENABLED ? 21_600_000 : 1_800_000;

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

interface ProofArtifactEvidence {
  byteLength: number;
  jsonKeys: string[];
  name: string;
  proofByteLength: number | null;
  publicInputFieldCount: number | null;
  publicOutputFieldCount: number | null;
  sha256: string;
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

interface ProposalProjection {
  proposalPublicKey: string;
  status: string;
  creationObservationStatus: string;
  contractStatus: string;
  contractStatusFinality: string;
  paidOutAmount: string;
  remainingPayoutAmount: string;
  finalVoteTally: {
    sourceStatus: string;
    yayWeight: string;
    nayWeight: string;
    abstainWeight: string;
    requiredParticipationBp: string;
    requiredApprovalBp: string;
    requiredParticipation: string;
    totalParticipatingVotes: string;
    approvalBp: string;
    voteResult: string;
  } | null;
}

interface ProposalVoteProjection {
  voterPublicKey: string;
  vote: string;
  voteWeight: string;
  isNullified: boolean;
  status: string;
}

interface ProposalExecutionProjection {
  proposalPublicKey: string;
  recipient: string;
  amountToPayOut: string;
  bondAmount: string;
  paidOutAmount: string;
  remainingAmount: string;
  status: string;
}

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
  const parsed = JSON.parse(serialized) as Record<string, unknown>;
  return {
    name,
    byteLength: Buffer.byteLength(serialized),
    sha256: createHash("sha256").update(serialized).digest("hex"),
    jsonKeys: Object.keys(parsed).sort(),
    proofByteLength:
      typeof parsed.proof === "string" ? Buffer.byteLength(parsed.proof) : null,
    publicInputFieldCount: Array.isArray(parsed.publicInput)
      ? parsed.publicInput.length
      : null,
    publicOutputFieldCount: Array.isArray(parsed.publicOutput)
      ? parsed.publicOutput.length
      : null,
  };
}

function logCommandPhase(
  state: "START" | "PASS" | "FAIL",
  args: string[],
  startedAt?: number,
): void {
  const duration =
    startedAt === undefined ? "" : ` ${Date.now() - startedAt}ms`;
  console.log(
    `[cli-e2e:${PROOF_MODE}] ${state} ${commandPhase(args)}${duration}`,
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

async function waitForBackendReadyAndCaughtUp(
  backend: LocalE2EBackend,
): Promise<void> {
  await waitForAssertion("backend readiness", async () => {
    await assertBackendReadyAndCaughtUp(backend);
  });
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
  });
  await waitForBackendReadyAndCaughtUp(backend);
}

async function waitForExactVotes(
  backend: LocalE2EBackend,
  proposalPublicKey: string,
  voterPublicKeys: string[],
): Promise<void> {
  await waitForAssertion("exact public vote projection", async () => {
    await assertBackendReadyAndCaughtUp(backend);
    const votes = await readJson<{
      proposalPublicKey: string;
      total: number;
      items: ProposalVoteProjection[];
    }>(`${backend.appApiUrl}/proposals/${proposalPublicKey}/votes?limit=20`);
    assert.equal(votes.proposalPublicKey, proposalPublicKey);
    assert.equal(votes.total, voterPublicKeys.length);
    assert.equal(votes.items.length, voterPublicKeys.length);
    assert.deepEqual(
      votes.items
        .map((vote) => ({
          voterPublicKey: vote.voterPublicKey,
          vote: vote.vote,
          voteWeight: vote.voteWeight,
          isNullified: vote.isNullified,
          status: vote.status,
        }))
        .sort((left, right) =>
          left.voterPublicKey.localeCompare(right.voterPublicKey),
        ),
      voterPublicKeys
        .map((voterPublicKey) => ({
          voterPublicKey,
          vote: "yay",
          voteWeight: "100000000000",
          isNullified: false,
          status: "canonical",
        }))
        .sort((left, right) =>
          left.voterPublicKey.localeCompare(right.voterPublicKey),
        ),
    );
  });
}

async function waitForExactApprovedTally(
  backend: LocalE2EBackend,
  proposalPublicKey: string,
): Promise<void> {
  await waitForAssertion("exact public tally projection", async () => {
    await assertBackendReadyAndCaughtUp(backend);
    const proposal = await readJson<ProposalProjection>(
      `${backend.appApiUrl}/proposals/${proposalPublicKey}`,
    );
    assert.equal(proposal.proposalPublicKey, proposalPublicKey);
    assertApprovedProposalProjectionStatus(proposal);
    assert.equal(proposal.paidOutAmount, "0");
    assert.equal(proposal.remainingPayoutAmount, PROPOSAL_PAYOUT_AMOUNT);
    assert(proposal.finalVoteTally);
    assert.deepEqual(
      {
        sourceStatus: proposal.finalVoteTally.sourceStatus,
        yayWeight: proposal.finalVoteTally.yayWeight,
        nayWeight: proposal.finalVoteTally.nayWeight,
        abstainWeight: proposal.finalVoteTally.abstainWeight,
        requiredParticipationBp:
          proposal.finalVoteTally.requiredParticipationBp,
        requiredApprovalBp: proposal.finalVoteTally.requiredApprovalBp,
        requiredParticipation: proposal.finalVoteTally.requiredParticipation,
        totalParticipatingVotes:
          proposal.finalVoteTally.totalParticipatingVotes,
        approvalBp: proposal.finalVoteTally.approvalBp,
        voteResult: proposal.finalVoteTally.voteResult,
      },
      {
        sourceStatus: "canonical",
        yayWeight: "500000000000",
        nayWeight: "0",
        abstainWeight: "0",
        requiredParticipationBp: "2058",
        requiredApprovalBp: "5118",
        requiredParticipation: "308700000000",
        totalParticipatingVotes: "500000000000",
        approvalBp: "10000",
        voteResult: "approved",
      },
    );
  });
}

async function waitForExactPayout(
  backend: LocalE2EBackend,
  proposalPublicKey: string,
  recipientPublicKey: string,
): Promise<void> {
  await waitForAssertion("exact public payout projection", async () => {
    await assertBackendReadyAndCaughtUp(backend);
    const [proposal, executions] = await Promise.all([
      readJson<ProposalProjection>(
        `${backend.appApiUrl}/proposals/${proposalPublicKey}`,
      ),
      readJson<{
        proposalPublicKey: string;
        total: number;
        items: ProposalExecutionProjection[];
      }>(
        `${backend.appApiUrl}/proposals/${proposalPublicKey}/executions?limit=20`,
      ),
    ]);
    assertApprovedProposalProjectionStatus(proposal);
    assert.equal(proposal.paidOutAmount, PROPOSAL_PAYOUT_AMOUNT);
    assert.equal(proposal.remainingPayoutAmount, "0");
    assert.equal(executions.proposalPublicKey, proposalPublicKey);
    assert.equal(executions.total, 1);
    assert.equal(executions.items.length, 1);
    assert.deepEqual(
      {
        proposalPublicKey: executions.items[0]!.proposalPublicKey,
        recipient: executions.items[0]!.recipient,
        amountToPayOut: executions.items[0]!.amountToPayOut,
        bondAmount: executions.items[0]!.bondAmount,
        paidOutAmount: executions.items[0]!.paidOutAmount,
        remainingAmount: executions.items[0]!.remainingAmount,
        status: executions.items[0]!.status,
      },
      {
        proposalPublicKey,
        recipient: recipientPublicKey,
        amountToPayOut: PROPOSAL_PAYOUT_AMOUNT,
        bondAmount: "100000000",
        paidOutAmount: PROPOSAL_PAYOUT_AMOUNT,
        remainingAmount: "0",
        status: "canonical",
      },
    );
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
  `runs the ${PROOF_MODE} operator CLI flow against a fresh local blockchain`,
  { timeout: TEST_TIMEOUT_MS },
  async (context) => {
    const tempRoot = await mkdtemp(
      join(tmpdir(), `treasury-cli-e2e-${PROOF_MODE}-`),
    );
    const sqliteDirectory = join(tempRoot, "sqlite");
    const publicArtifactDirectory = process.env.E2E_ARTIFACT_DIRECTORY;
    const proofArtifactEvidenceRecords: ProofArtifactEvidence[] = [];
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

    const cli = async (
      args: string[],
      envOverrides: Record<string, string> = {},
    ): Promise<string> => {
      const startedAt = Date.now();
      logCommandPhase("START", args);
      try {
        const output = await runCli(args, {
          cwd: tempRoot,
          envOverrides: { ...commonEnv, ...envOverrides },
          nodeLoaderPath: CLI_TS_NODE_LOADER,
          timeoutMs: COMMAND_TIMEOUT_MS,
        });
        logCommandPhase("PASS", args, startedAt);
        return output;
      } catch (error) {
        logCommandPhase("FAIL", args, startedAt);
        throw new Error(
          `${commandPhase(args)} failed: ${redactPrivateKeys(String(error))}`,
        );
      }
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
      localBlockchain = startLocalBlockchainTestServer({
        nodePort,
        archivePort,
        proofsEnabled: PROOFS_ENABLED,
      });
      let serverOutput = "";
      localBlockchain.child.stdout?.on("data", (chunk) => {
        serverOutput += chunk.toString();
      });
      localBlockchain.child.stderr?.on("data", (chunk) => {
        serverOutput += chunk.toString();
      });
      await waitForHealth(baseUrl);

      const helpOutput = await cli(["--help"]);
      assert.match(helpOutput, /treasury-owner/u);
      assert.match(helpOutput, /pause-controller/u);
      assert.match(helpOutput, /proposal/u);

      const initialState = await readJson<AdminState>(`${baseUrl}/admin/state`);
      assert.equal(initialState.proofsEnabled, PROOFS_ENABLED);
      const localWhale = initialState.testAccounts[0];
      assert(localWhale, "The local blockchain must supply a funded account");

      const missingSender = await runCliProcess(
        [
          "transfer",
          "--recipient-public-key",
          initialState.testAccounts[1]!.publicKey,
          "--amount",
          "1",
        ],
        commonEnv,
        tempRoot,
      );
      assert.notEqual(missingSender.code, 0);
      assert.match(
        `${missingSender.stdout}\n${missingSender.stderr}`,
        /(?:Sender private key|--sender-private-key) is required when --signer=in-memory/u,
      );

      const [treasuryOwner, pauseController, proposal, ...participants] =
        await generateKeypairs(8);
      assert(treasuryOwner && pauseController && proposal);
      assert.equal(participants.length, 5);
      const participantPublicKeys = participants.map(
        (entry) => entry.publicKey,
      );
      const participantPublicKeysArg = participantPublicKeys.join(",");

      const outsider = (await generateKeypairs(1))[0]!;
      const outsiderSignature = await runCliProcess(
        [
          "multisig-sign",
          "pause-treasury",
          "--multisig-participants-public-keys",
          participantPublicKeysArg,
          "--multisig-signer-private-key",
          outsider.privateKey,
          "--nonce",
          "0",
        ],
        commonEnv,
        tempRoot,
      );
      assert.notEqual(outsiderSignature.code, 0);
      assert.match(
        `${outsiderSignature.stdout}\n${outsiderSignature.stderr}`,
        /is not part of --multisig-participants-public-keys/u,
      );

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
      const rootOutput = await cli([
        "staking-ledger",
        "get-root-hash",
        "--lifecycle-id",
        LIFECYCLE_ID,
        "--expected-root-hash",
        snapshot.ledgerHashBase58,
        "--output-format",
        "json",
      ]);
      assert.match(rootOutput, new RegExp(snapshot.ledgerHashBase58));
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
        "cli-e2e-staking",
        commonEnv,
        tempRoot,
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
      const stakingProof = JSON.parse(serializedStakingProof) as {
        proof?: unknown;
        publicInput?: unknown;
        publicOutput?: unknown;
        maxProofsVerified?: unknown;
      };
      assert(stakingProof.proof);
      assert(stakingProof.publicInput);
      assert(stakingProof.publicOutput);
      assert.notEqual(stakingProof.maxProofsVerified, undefined);
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
      const deploymentState = await readJson<AdminState>(
        `${baseUrl}/admin/state`,
      );
      const treasuryDeployedAtSlot = deploymentState.currentSlot;
      const deployOutput = await cli([
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
      const deployResult = parseJsonResult<{
        treasuryOwnerAddress: string;
        pauseControllerAddress: string;
        treasuryOwnerTxHash: string;
        pauseControllerTxHash: string;
      }>(deployOutput, "treasuryOwnerTxHash");
      assert.equal(deployResult.treasuryOwnerAddress, treasuryOwner.publicKey);
      assert.equal(
        deployResult.pauseControllerAddress,
        pauseController.publicKey,
      );
      assert(deployResult.treasuryOwnerTxHash);
      assert(deployResult.pauseControllerTxHash);

      const ownerStateOutput = await cli([
        "treasury-owner",
        "read-state",
        "--treasury-owner-public-key",
        treasuryOwner.publicKey,
        "--lifecycle-period-duration",
        String(LIFECYCLE_PERIOD_DURATION),
      ]);
      const ownerState = parseJsonResult<{
        withdrawalPermission: string;
        pauseControllerPublicKey: string;
        currentLifecyclePeriod: { period: string; lifecycleId: string };
      }>(ownerStateOutput, "treasuryOwnerAddress");
      assert.equal(ownerState.withdrawalPermission, "proofOrSignature");
      assert.equal(
        ownerState.pauseControllerPublicKey,
        pauseController.publicKey,
      );
      assert.equal(ownerState.currentLifecyclePeriod.period, "proposal");
      assert.equal(ownerState.currentLifecyclePeriod.lifecycleId, LIFECYCLE_ID);

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
        participantPublicKeys,
      );
      const proposalContentPath = join(tempRoot, "proposal.md");
      await writeFile(
        proposalContentPath,
        "# Local CLI E2E proposal\n\nThis content is test data.\n",
      );
      const proposalRecipient = PrivateKey.random().toPublicKey().toBase58();
      const createOutput = await cli([
        "proposal",
        "create",
        "--api-url",
        backend.appApiUrl,
        "--sender-private-key",
        localWhale.privateKey,
        "--treasury-owner-public-key",
        treasuryOwner.publicKey,
        "--proposal-private-key",
        proposal.privateKey,
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
        "--fee",
        TX_FEE,
        "--wait",
        "true",
      ]);
      const createResult = parseJsonResult<{
        proposalAddress: string;
        proposalTxHash: string;
      }>(createOutput, "proposalTxHash");
      assert.equal(createResult.proposalAddress, proposal.publicKey);
      assert(createResult.proposalTxHash);

      const tooFewSignatures = await runCliProcess(
        [
          "pause-controller",
          "pause-treasury",
          "--sender-private-key",
          localWhale.privateKey,
          "--pause-controller-public-key",
          pauseController.publicKey,
          "--multisig-participants-public-keys",
          participantPublicKeysArg,
          "--multisig-signatures",
          "one,two",
        ],
        commonEnv,
        tempRoot,
      );
      assert.notEqual(tooFewSignatures.code, 0);
      assert.match(
        `${tooFewSignatures.stdout}\n${tooFewSignatures.stderr}`,
        /Invalid multisig signature|Expected at least 3 multisig signatures/u,
      );

      const buildMultisigSignatures = async (
        action:
          | "pause-treasury"
          | "unpause-treasury"
          | "toggle-pause-proposal"
          | "rotate-multisig-keys",
        nonce: number,
        extraArgs: string[] = [],
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
            ...extraArgs,
          ]);
          const partial = parseJsonResult<MultisigResult>(output, "signature");
          slots[partial.signerParticipantIndex] = partial.signature;
        }
        return slots.join(",");
      };

      const pauseNonce = await accountNonce(
        minaNodeUrl,
        pauseController.publicKey,
      );
      const pauseSignatures = await buildMultisigSignatures(
        "pause-treasury",
        pauseNonce,
      );
      await cli([
        "pause-controller",
        "pause-treasury",
        "--sender-private-key",
        localWhale.privateKey,
        "--pause-controller-public-key",
        pauseController.publicKey,
        "--multisig-participants-public-keys",
        participantPublicKeysArg,
        "--multisig-signatures",
        pauseSignatures,
        "--fee",
        TX_FEE,
        "--wait",
        "true",
      ]);
      const pausedState = parseJsonResult<{ paused: boolean }>(
        await cli([
          "pause-controller",
          "read-state",
          "--pause-controller-public-key",
          pauseController.publicKey,
        ]),
        "pauseControllerAddress",
      );
      assert.equal(pausedState.paused, true);

      const receiptsBeforeReplay = (
        await readJson<AdminState>(`${baseUrl}/admin/state`)
      ).submittedTransactions;
      const replay = await runCliProcess(
        [
          "pause-controller",
          "pause-treasury",
          "--sender-private-key",
          localWhale.privateKey,
          "--pause-controller-public-key",
          pauseController.publicKey,
          "--multisig-participants-public-keys",
          participantPublicKeysArg,
          "--multisig-signatures",
          pauseSignatures,
          "--fee",
          TX_FEE,
          "--wait",
          "true",
        ],
        commonEnv,
        tempRoot,
      );
      assert.notEqual(replay.code, 0, "A used multisig payload must fail");
      assert.equal(
        (await readJson<AdminState>(`${baseUrl}/admin/state`))
          .submittedTransactions,
        receiptsBeforeReplay,
      );

      const unpauseNonce = await accountNonce(
        minaNodeUrl,
        pauseController.publicKey,
      );
      const unpauseSignatures = await buildMultisigSignatures(
        "unpause-treasury",
        unpauseNonce,
      );
      await cli([
        "pause-controller",
        "unpause-treasury",
        "--sender-private-key",
        localWhale.privateKey,
        "--pause-controller-public-key",
        pauseController.publicKey,
        "--multisig-participants-public-keys",
        participantPublicKeysArg,
        "--multisig-signatures",
        unpauseSignatures,
        "--fee",
        TX_FEE,
        "--wait",
        "true",
      ]);

      const toggleProposal = async (): Promise<void> => {
        const nonce = await accountNonce(
          minaNodeUrl,
          pauseController.publicKey,
        );
        const extraArgs = ["--proposal-public-key", proposal.publicKey];
        const signatures = await buildMultisigSignatures(
          "toggle-pause-proposal",
          nonce,
          extraArgs,
        );
        const output = await cli([
          "pause-controller",
          "toggle-pause-proposal",
          "--sender-private-key",
          localWhale.privateKey,
          "--pause-controller-public-key",
          pauseController.publicKey,
          "--treasury-owner-public-key",
          treasuryOwner.publicKey,
          "--proposal-public-key",
          proposal.publicKey,
          "--multisig-participants-public-keys",
          participantPublicKeysArg,
          "--multisig-signatures",
          signatures,
          "--lifecycle-period-duration",
          String(LIFECYCLE_PERIOD_DURATION),
          "--fee",
          TX_FEE,
          "--wait",
          "true",
        ]);
        assert(
          parseJsonResult<{ togglePauseProposalTxHash: string }>(
            output,
            "togglePauseProposalTxHash",
          ).togglePauseProposalTxHash,
        );
      };
      await toggleProposal();
      await toggleProposal();

      const sameRecipientWithdrawal = await runCliProcess(
        [
          "treasury-owner",
          "emergency-withdraw",
          "--sender-private-key",
          localWhale.privateKey,
          "--treasury-owner-private-key",
          treasuryOwner.privateKey,
          "--recipient-public-key",
          treasuryOwner.publicKey,
          "--amount",
          EMERGENCY_WITHDRAWAL_AMOUNT,
        ],
        commonEnv,
        tempRoot,
      );
      assert.notEqual(sameRecipientWithdrawal.code, 0);
      assert.match(
        `${sameRecipientWithdrawal.stdout}\n${sameRecipientWithdrawal.stderr}`,
        /recipient must differ from the Treasury Owner/u,
      );

      const emergencyRecipient = PrivateKey.random().toPublicKey().toBase58();
      const emergencyBalanceBefore = await accountBalance(
        minaNodeUrl,
        emergencyRecipient,
      );
      await cli([
        "treasury-owner",
        "emergency-withdraw",
        "--sender-private-key",
        localWhale.privateKey,
        "--treasury-owner-private-key",
        treasuryOwner.privateKey,
        "--recipient-public-key",
        emergencyRecipient,
        "--amount",
        EMERGENCY_WITHDRAWAL_AMOUNT,
        "--fee",
        TX_FEE,
        "--wait",
        "true",
      ]);
      assert.equal(
        (await accountBalance(minaNodeUrl, emergencyRecipient)) -
          emergencyBalanceBefore,
        BigInt(EMERGENCY_WITHDRAWAL_AMOUNT),
      );

      const votingSlot = treasuryDeployedAtSlot + LIFECYCLE_PERIOD_DURATION * 2;
      await postJson(`${baseUrl}/admin/slot/set`, { slot: votingSlot });
      for (const participant of participants) {
        await cli([
          "proposal",
          "vote",
          "--sender-private-key",
          participant.privateKey,
          "--treasury-owner-public-key",
          treasuryOwner.publicKey,
          "--proposal-public-key",
          proposal.publicKey,
          "--voter-private-key",
          participant.privateKey,
          "--vote",
          "yay",
          "--lifecycle-period-duration",
          String(LIFECYCLE_PERIOD_DURATION),
          "--fee",
          TX_FEE,
          "--wait",
          "true",
        ]);
      }
      await waitForExactVotes(
        backend,
        proposal.publicKey,
        participantPublicKeys,
      );

      const cooldownSlot =
        treasuryDeployedAtSlot + LIFECYCLE_PERIOD_DURATION * 3;
      await postJson(`${baseUrl}/admin/slot/set`, { slot: cooldownSlot });
      const actionsPath = join(tempRoot, "vote-actions.json");
      const actionsOutput = await cli([
        "proposal",
        "fetch-actions",
        "--archive-node-url",
        archiveNodeUrl,
        "--treasury-owner-public-key",
        treasuryOwner.publicKey,
        "--proposal-public-key",
        proposal.publicKey,
        "--output-path",
        actionsPath,
      ]);
      assert.equal(
        parseJsonResult<{ count: number }>(actionsOutput, "count").count,
        participants.length,
      );

      const voteProofPath = join(tempRoot, "vote-reducer-merged.json");
      await cli(["vote-reducer", "compile"]);
      await cli([
        "vote-reducer",
        "trace-run-batch",
        "--lifecycle-id",
        LIFECYCLE_ID,
        "--vote-actions-path",
        actionsPath,
      ]);
      await runWorkerFlow(
        "cli-e2e-vote",
        commonEnv,
        tempRoot,
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
            voteProofPath,
          ]);
        },
      );
      const serializedVoteProof = await readFile(voteProofPath, "utf8");
      const voteProof = JSON.parse(serializedVoteProof) as {
        proof?: unknown;
        publicInput?: unknown;
        publicOutput?: unknown;
        maxProofsVerified?: unknown;
      };
      assert(voteProof.proof);
      assert(voteProof.publicInput);
      assert(voteProof.publicOutput);
      assert.notEqual(voteProof.maxProofsVerified, undefined);
      proofArtifactEvidenceRecords.push(
        proofArtifactEvidence("vote-merged", serializedVoteProof),
      );

      await context.test(
        `tallies and executes with transported ${PROOF_MODE} artifacts`,
        async () => {
          const tallyOutput = await cli([
            "proposal",
            "tally-votes",
            "--sender-private-key",
            localWhale.privateKey,
            "--treasury-owner-public-key",
            treasuryOwner.publicKey,
            "--proposal-public-key",
            proposal.publicKey,
            "--vote-reducer-proof-path",
            voteProofPath,
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
          ]);
          assert(
            parseJsonResult<{ tallyTxHash: string }>(tallyOutput, "tallyTxHash")
              .tallyTxHash,
          );

          const proposalState = parseJsonResult<{ status: string }>(
            await cli([
              "proposal",
              "read-state",
              "--treasury-owner-public-key",
              treasuryOwner.publicKey,
              "--proposal-public-key",
              proposal.publicKey,
            ]),
            "proposalAddress",
          );
          assert.equal(proposalState.status, "approved");
          await waitForExactApprovedTally(backend!, proposal.publicKey);

          const executionSlot =
            treasuryDeployedAtSlot + LIFECYCLE_PERIOD_DURATION * 4;
          await postJson(`${baseUrl}/admin/slot/set`, { slot: executionSlot });
          const payoutBalanceBefore = await accountBalance(
            minaNodeUrl,
            proposalRecipient,
          );
          const executeOutput = await cli([
            "proposal",
            "execute",
            "--sender-private-key",
            localWhale.privateKey,
            "--treasury-owner-public-key",
            treasuryOwner.publicKey,
            "--proposal-public-key",
            proposal.publicKey,
            "--recipient-public-key",
            proposalRecipient,
            "--amount-to-pay-out",
            PROPOSAL_PAYOUT_AMOUNT,
            "--lifecycle-period-duration",
            String(LIFECYCLE_PERIOD_DURATION),
            "--fee",
            TX_FEE,
            "--wait",
            "true",
          ]);
          assert(
            parseJsonResult<{ executeTxHash: string }>(
              executeOutput,
              "executeTxHash",
            ).executeTxHash,
          );
          assert.equal(
            (await accountBalance(minaNodeUrl, proposalRecipient)) -
              payoutBalanceBefore,
            BigInt(PROPOSAL_PAYOUT_AMOUNT),
          );
          await waitForExactPayout(
            backend!,
            proposal.publicKey,
            proposalRecipient,
          );
        },
      );

      const newParticipants = await generateKeypairs(5);
      const newParticipantPublicKeysArg = newParticipants
        .map((entry) => entry.publicKey)
        .join(",");
      const rotateNonce = await accountNonce(
        minaNodeUrl,
        pauseController.publicKey,
      );
      const rotateSignatures = await buildMultisigSignatures(
        "rotate-multisig-keys",
        rotateNonce,
        [
          "--new-multisig-participants-public-keys",
          newParticipantPublicKeysArg,
        ],
      );
      const rotateOutput = await cli([
        "pause-controller",
        "rotate-multisig-keys",
        "--sender-private-key",
        localWhale.privateKey,
        "--pause-controller-public-key",
        pauseController.publicKey,
        "--current-multisig-participants-public-keys",
        participantPublicKeysArg,
        "--new-multisig-participants-public-keys",
        newParticipantPublicKeysArg,
        "--multisig-signatures",
        rotateSignatures,
        "--fee",
        TX_FEE,
        "--wait",
        "true",
      ]);
      assert(
        parseJsonResult<{ rotateMultisigKeysTxHash: string }>(
          rotateOutput,
          "rotateMultisigKeysTxHash",
        ).rotateMultisigKeysTxHash,
      );
      await waitForBackendReadyAndCaughtUp(backend);

      const finalState = await readJson<AdminState>(`${baseUrl}/admin/state`);
      assert(finalState.submittedTransactions >= 18);
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
      console.log(`[cli-e2e:${PROOF_MODE}] artifacts retained: ${tempRoot}`);
      if (publicArtifactDirectory) {
        await writeFile(
          join(publicArtifactDirectory, "cli-golden-evidence.json"),
          JSON.stringify(
            {
              schemaVersion: 1,
              suite: "cli-golden",
              proofMode: PROOF_MODE,
              proofsEnabled: PROOFS_ENABLED,
              startedAt,
              finishedAt: new Date().toISOString(),
              completed,
              privateRunArtifactsRetained: true,
              proofArtifacts: proofArtifactEvidenceRecords,
            },
            null,
            2,
          ),
        );
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(cleanupErrors, "CLI golden cleanup failed");
      }
    }
  },
);
