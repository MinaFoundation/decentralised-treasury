import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { LedgerHashBase58, Reducer, UInt128, UInt64 } from "o1js";
import { RedisMemoryServer } from "redis-memory-server";
import { KeyvSqlite } from "@keyv/sqlite";
import { PersistentStakingLedger } from "@repo/sdk/src/ledgers/staking-ledger/persistent-staking-ledger.js";
import { PersistentVotingLedger } from "@repo/sdk/src/ledgers/voting-ledger/persistent-voting-ledger.js";
import { VotingAccount } from "@repo/sdk/src/provable/voting-account.js";
import { TreasuryProposalSmartContract } from "@repo/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.js";
import { SideLoadedVoteReducerProof } from "@repo/sdk/src/provable/contracts/treasury-proposal/vote-reducer.js";
import { SideLoadedStakingLedgerToVotingLedgerProof } from "@repo/sdk/src/provable/staking-ledger-to-voting-ledger.js";
import { createSqliteStakingLedgerStorage } from "@repo/sdk/src/storage/sqlite/factory/sqlite-staking-ledger-storage.js";
import { createSqliteVotingLedgerStorage } from "@repo/sdk/src/storage/sqlite/factory/sqlite-voting-ledger-storage.js";
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
import {
  assertApprovedProposalProjectionStatus,
  assertRunningAndFinalTallies,
} from "./utils/proposal-projection-assertions.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CLI_PACKAGE_DIRECTORY = fileURLToPath(new URL("../", import.meta.url));
const CLI_TS_NODE_PROJECT = join(CLI_PACKAGE_DIRECTORY, "tsconfig.json");
const CLI_TS_NODE_LOADER = join(
  CLI_PACKAGE_DIRECTORY,
  "node_modules/ts-node/esm.mjs",
);
const MINI_LEDGER_PATH = fileURLToPath(
  new URL("../../../packages/sdk/test/test-ledger-mini.json", import.meta.url),
);
const DEFAULT_TOKEN_ID = "wSHV2S4qX9jFsLjQo8r1BsMLH2ZRKsZx6EJd1sbozGPieEC4Jf";
const LIFECYCLE_ID = "0";
const LIFECYCLE_PERIOD_DURATION = 20;
const TX_FEE = "100000000";
const VOTER_FUNDING_AMOUNT = "2000000000";
const TREASURY_FUNDING_AMOUNT = "100000000000";
const PROPOSAL_AMOUNT = "1000000000";
const UINT64_MAX = (1n << 64n) - 1n;
const BALANCES = {
  O: UINT64_MAX - 60n,
  V1: 10n,
  V2: 20n,
  V3: 30n,
  V4: 0n,
  V5: 0n,
} as const;
const EXPECTED_WEIGHTS = {
  V1: 20n,
  V2: 10n,
  V3: 0n,
  V4: 0n,
  V5: UINT64_MAX - 30n,
} as const;
const LEDGER_ORDER = ["V4", "O", "V2", "V5", "V1", "V3"] as const;
const VOTE_ORDER = ["V3", "V2", "V4", "V1", "V5"] as const;
const REQUIRED_PARTICIPATION_BP = "2000";
const REQUIRED_APPROVAL_BP = "5100";
const REQUIRED_PARTICIPATION = (
  (UINT64_MAX * BigInt(REQUIRED_PARTICIPATION_BP)) /
  10_000n
).toString();
const PROOFS_ENABLED_VALUE = process.env.PROOFS_ENABLED;
if (PROOFS_ENABLED_VALUE !== "false" && PROOFS_ENABLED_VALUE !== "true") {
  throw new Error(
    "PROOFS_ENABLED must be set explicitly to false or true for this E2E test",
  );
}
const PROOFS_ENABLED = PROOFS_ENABLED_VALUE === "true";
const PROOF_MODE = PROOFS_ENABLED ? "proof-on" : "proof-off";
const COMMAND_TIMEOUT_MS = PROOFS_ENABLED ? 3_600_000 : 900_000;
const TEST_TIMEOUT_MS = PROOFS_ENABLED ? 21_600_000 : 1_800_000;

type LedgerRole = (typeof LEDGER_ORDER)[number];
type VoterRole = keyof typeof EXPECTED_WEIGHTS;

interface GeneratedKeypair {
  privateKey: string;
  publicKey: string;
}

interface AdminState {
  currentSlot: number;
  proofsEnabled: boolean;
  testAccounts: Array<GeneratedKeypair & { balance: string }>;
}

interface MinaLedgerAccount {
  pk: string;
  balance: string;
  delegate: string;
  token: string;
  [key: string]: unknown;
}

interface RootResult {
  ledgerHashBase58: string;
  stakingEpochDataLedgerHash: string;
}

interface VoteActionsFile {
  proposalPublicKey: string;
  proposalTokenId: string;
  actionStateHistoryTarget: {
    actionStateOne: string;
    actionStateTwo: string;
    actionStateThree: string;
    actionStateFour: string;
    actionStateFive: string;
  };
  voteActions: Array<{ publicKey: string; vote: string }>;
}

interface ProjectedVote {
  voterPublicKey: string;
  vote: string;
  voteWeight: string;
  status: string;
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

interface ProposalProjection {
  proposalPublicKey: string;
  status: string;
  creationObservationStatus: string;
  contractStatus: string;
  contractStatusFinality: string;
  requiredParticipationBp: string | null;
  requiredApprovalBp: string | null;
  requiredParticipation: string | null;
  contents: string | null;
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

interface ProcessorProposalProjection {
  proposalPublicKey: string;
  status: string;
  contractStatus: string;
  contractStatusFinality: string;
  requiredParticipationBp: string | null;
  requiredApprovalBp: string | null;
  requiredParticipation: string | null;
  votes?: ProjectedVote[];
  voteTallies?: Array<{
    createdByEventType: string;
    blockHeight: number;
    sourceStatus: string;
    yayWeight: string;
    nayWeight: string;
    abstainWeight: string;
    requiredParticipationBp: string | null;
    requiredApprovalBp: string | null;
    requiredParticipation: string | null;
    totalParticipatingVotes: string | null;
    approvalBp: string | null;
    voteResult: string;
  }>;
}

interface ProofArtifactEvidence {
  name: string;
  byteLength: number;
  sha256: string;
  jsonKeys: string[];
  proofByteLength: number | null;
  publicInputFieldCount: number | null;
  publicOutputFieldCount: number | null;
}

function listItems<T>(payload: { data?: T[]; items?: T[] }): T[] {
  return payload.items ?? payload.data ?? [];
}

function redactPrivateKeys(value: string): string {
  return value.replace(/EK[1-9A-HJ-NP-Za-km-z]{45,60}/gu, "<private-key>");
}

function parseJsonResult<T>(output: string, requiredKey: string): T {
  const lines = output.split(/\r?\n/u);
  for (let start = lines.length - 1; start >= 0; start -= 1) {
    if (!lines[start]?.trim().startsWith("{")) continue;
    for (let end = lines.length; end > start; end -= 1) {
      try {
        const value = JSON.parse(lines.slice(start, end).join("\n")) as Record<
          string,
          unknown
        >;
        if (requiredKey in value) return value as T;
      } catch {}
    }
  }
  throw new Error(`CLI output did not contain JSON key ${requiredKey}`);
}

function formatNanomina(value: bigint): string {
  assert(value >= 0n, "nanomina value must not be negative");
  const whole = value / 1_000_000_000n;
  const fractional = (value % 1_000_000_000n).toString().padStart(9, "0");
  return `${whole}.${fractional}`;
}

function expectedVotePrefixSums(): bigint[] {
  let sum = 0n;
  return VOTE_ORDER.map((role) => {
    sum += EXPECTED_WEIGHTS[role];
    assert(sum <= UINT64_MAX, `vote prefix through ${role} exceeds UInt64`);
    return sum;
  });
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

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200, `GET ${url} failed`);
  return (await response.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200, `POST ${url} failed`);
  return (await response.json()) as T;
}

async function waitFor<T>(
  label: string,
  probe: () => Promise<T>,
  timeoutMs = 300_000,
): Promise<T> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await probe();
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }
  const boundedLastError = redactPrivateKeys(String(lastError)).slice(0, 4_000);
  console.error(
    `[cli-varied-e2e:${PROOF_MODE}] WAIT_TIMEOUT ${label}: ${boundedLastError}`,
  );
  throw new Error(`${label} timed out: ${boundedLastError}`);
}

async function waitForHealth(baseUrl: string): Promise<void> {
  await waitFor(
    "local blockchain health",
    async () => {
      const response = await fetch(`${baseUrl}/healthz`, {
        signal: AbortSignal.timeout(5_000),
      });
      assert(response.ok, `health returned ${response.status}`);
    },
    30_000,
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

async function readProjectedProposal(
  baseUrl: string,
  proposalPublicKey: string,
): Promise<ProposalProjection> {
  const payload = await readJson<{
    data?: ProposalProjection[];
    items?: ProposalProjection[];
  }>(`${baseUrl}/proposals?limit=20`);
  const proposal = listItems(payload).find(
    (item) => item.proposalPublicKey === proposalPublicKey,
  );
  assert(proposal, `proposal ${proposalPublicKey} is missing at ${baseUrl}`);
  return proposal;
}

async function readProcessorProposal(
  baseUrl: string,
  proposalPublicKey: string,
): Promise<ProcessorProposalProjection> {
  const payload = await readJson<{
    data?: ProcessorProposalProjection[];
    items?: ProcessorProposalProjection[];
  }>(`${baseUrl}/proposals?join=voteTallies&join=votes&limit=20`);
  const proposal = listItems(payload).find(
    (item) => item.proposalPublicKey === proposalPublicKey,
  );
  assert(proposal, `proposal ${proposalPublicKey} is missing at ${baseUrl}`);
  return proposal;
}

function assertExactVoteItems(
  items: ProjectedVote[],
  voterByRole: Record<VoterRole, GeneratedKeypair>,
): void {
  assert.equal(items.length, VOTE_ORDER.length);
  const projectedWeightByVoter = new Map(
    items.map((vote) => [vote.voterPublicKey, vote]),
  );
  for (const role of Object.keys(EXPECTED_WEIGHTS) as VoterRole[]) {
    const projected = projectedWeightByVoter.get(voterByRole[role].publicKey);
    assert(projected, `missing projected vote for ${role}`);
    assert.equal(projected.vote, "yay");
    assert.equal(projected.voteWeight, EXPECTED_WEIGHTS[role].toString());
    assert.equal(projected.status, "canonical");
  }
}

async function assertExactProjectedVotes(
  baseUrl: string,
  proposalPublicKey: string,
  voterByRole: Record<VoterRole, GeneratedKeypair>,
): Promise<void> {
  const payload = await readJson<{
    proposalPublicKey: string;
    total: number;
    data?: ProjectedVote[];
    items?: ProjectedVote[];
  }>(`${baseUrl}/proposals/${proposalPublicKey}/votes?limit=20`);
  const items = listItems(payload);
  assert.equal(payload.proposalPublicKey, proposalPublicKey);
  assert.equal(payload.total, VOTE_ORDER.length);
  assertExactVoteItems(items, voterByRole);
}

async function assertExactProcessorProjectedVotes(
  baseUrl: string,
  proposalPublicKey: string,
  voterByRole: Record<VoterRole, GeneratedKeypair>,
): Promise<void> {
  const proposal = await readProcessorProposal(baseUrl, proposalPublicKey);
  assertExactVoteItems(proposal.votes ?? [], voterByRole);
}

async function assertExactApprovedProjection(
  baseUrl: string,
  proposalPublicKey: string,
  expectedContents?: string,
): Promise<void> {
  const proposal = await readProjectedProposal(baseUrl, proposalPublicKey);
  assert.equal(proposal.proposalPublicKey, proposalPublicKey);
  assertApprovedProposalProjectionStatus(proposal);
  assert.equal(proposal.requiredParticipationBp, REQUIRED_PARTICIPATION_BP);
  assert.equal(proposal.requiredApprovalBp, REQUIRED_APPROVAL_BP);
  assert.equal(proposal.requiredParticipation, REQUIRED_PARTICIPATION);
  if (expectedContents !== undefined) {
    assert.equal(proposal.contents, expectedContents);
  }
  assert(proposal.finalVoteTally);
  assert.deepEqual(
    {
      sourceStatus: proposal.finalVoteTally.sourceStatus,
      yayWeight: proposal.finalVoteTally.yayWeight,
      nayWeight: proposal.finalVoteTally.nayWeight,
      abstainWeight: proposal.finalVoteTally.abstainWeight,
      requiredParticipationBp: proposal.finalVoteTally.requiredParticipationBp,
      requiredApprovalBp: proposal.finalVoteTally.requiredApprovalBp,
      requiredParticipation: proposal.finalVoteTally.requiredParticipation,
      totalParticipatingVotes: proposal.finalVoteTally.totalParticipatingVotes,
      approvalBp: proposal.finalVoteTally.approvalBp,
      voteResult: proposal.finalVoteTally.voteResult,
    },
    {
      sourceStatus: "canonical",
      yayWeight: UINT64_MAX.toString(),
      nayWeight: "0",
      abstainWeight: "0",
      requiredParticipationBp: REQUIRED_PARTICIPATION_BP,
      requiredApprovalBp: REQUIRED_APPROVAL_BP,
      requiredParticipation: REQUIRED_PARTICIPATION,
      totalParticipatingVotes: UINT64_MAX.toString(),
      approvalBp: "10000",
      voteResult: "approved",
    },
  );
}

async function assertExactProcessorApprovedProjection(
  baseUrl: string,
  proposalPublicKey: string,
): Promise<void> {
  const proposal = await readProcessorProposal(baseUrl, proposalPublicKey);
  assert.equal(proposal.status, "canonical");
  assert.equal(proposal.contractStatus, "approved");
  assert.equal(proposal.contractStatusFinality, "canonical");
  assert.equal(proposal.requiredParticipationBp, REQUIRED_PARTICIPATION_BP);
  assert.equal(proposal.requiredApprovalBp, REQUIRED_APPROVAL_BP);
  assert.equal(proposal.requiredParticipation, REQUIRED_PARTICIPATION);
  const tally = assertRunningAndFinalTallies(proposal.voteTallies ?? [], [
    "0",
    "10",
    "10",
    "30",
    UINT64_MAX.toString(),
  ]);
  assert.deepEqual(
    {
      sourceStatus: tally.sourceStatus,
      yayWeight: tally.yayWeight,
      nayWeight: tally.nayWeight,
      abstainWeight: tally.abstainWeight,
      requiredParticipationBp: tally.requiredParticipationBp,
      requiredApprovalBp: tally.requiredApprovalBp,
      requiredParticipation: tally.requiredParticipation,
      totalParticipatingVotes: tally.totalParticipatingVotes,
      approvalBp: tally.approvalBp,
      voteResult: tally.voteResult,
    },
    {
      sourceStatus: "canonical",
      yayWeight: UINT64_MAX.toString(),
      nayWeight: "0",
      abstainWeight: "0",
      requiredParticipationBp: REQUIRED_PARTICIPATION_BP,
      requiredApprovalBp: REQUIRED_APPROVAL_BP,
      requiredParticipation: REQUIRED_PARTICIPATION,
      totalParticipatingVotes: UINT64_MAX.toString(),
      approvalBp: "10000",
      voteResult: "approved",
    },
  );
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await waitForExit(child, 10_000).catch(async () => {
    child.kill("SIGKILL");
    await waitForExit(child, 5_000);
  });
}

async function runWorkerFlow(
  label: string,
  commonEnv: Record<string, string>,
  cwd: string,
  callback: (redis: {
    host: string;
    port: number;
    queueName: string;
  }) => Promise<void>,
): Promise<void> {
  const redis = new RedisMemoryServer();
  const host = await redis.getHost();
  const port = await redis.getPort();
  const queueName = `varied-ledger-${PROOF_MODE}-${label}-${Date.now()}`;
  const worker = spawnCliWorker(queueName, {
    redisHost: host,
    redisPort: port,
    cwd,
    nodeLoaderPath: CLI_TS_NODE_LOADER,
    envOverrides: commonEnv,
    stdio: "inherit",
  });
  await sleep(1_000);
  assert.equal(worker.exitCode, null, `${label} worker exited early`);
  try {
    await callback({ host, port, queueName });
  } finally {
    await stopChild(worker);
    await redis.stop();
  }
}

/**
 * This read-only oracle derives expected roots from the finalized Mina JSON
 * and the explicit expected voting weights. It uses separate in-memory state.
 * It does not read a CLI or backend database, submit an actor action, or
 * replace an actor CLI command.
 */
async function readIndependentLedgerOracle(
  stakingLedgerPath: string,
  publicKeyByRole: Record<LedgerRole, string>,
  delegateByRole: Record<LedgerRole, VoterRole>,
): Promise<{
  stakingRoot: string;
  stakingRootBase58: string;
  emptyVotingRoot: string;
  votingRoot: string;
  accounts: Array<{
    publicKey: string;
    balance: bigint;
    delegate: string;
  }>;
}> {
  const finalizedJson = JSON.parse(
    await readFile(stakingLedgerPath, "utf8"),
  ) as MinaLedgerAccount[];
  assert.deepEqual(
    finalizedJson.map((account) => account.pk),
    LEDGER_ORDER.map((role) => publicKeyByRole[role]),
  );
  assert.deepEqual(
    finalizedJson.map((account) => account.balance),
    LEDGER_ORDER.map((role) => formatNanomina(BALANCES[role])),
  );
  assert.deepEqual(
    finalizedJson.map((account) => account.delegate),
    LEDGER_ORDER.map((role) => publicKeyByRole[delegateByRole[role]]),
  );

  const sqlite = new KeyvSqlite({ uri: "sqlite://:memory:" });
  const stakingStorage = createSqliteStakingLedgerStorage(
    "oracle-staking",
    sqlite,
  );
  const stakingLedger = new PersistentStakingLedger(
    stakingStorage.accountStorage,
    stakingStorage.merkleTreeStorage,
  );
  const votingStorage = createSqliteVotingLedgerStorage(
    "oracle-voting",
    sqlite,
  );
  const votingLedger = new PersistentVotingLedger(
    votingStorage.votingAccountStorage,
    votingStorage.merkleTreeStorage,
  );
  try {
    const accounts = await stakingLedger.readStakingLedger(stakingLedgerPath);
    await stakingLedger.hydrateAccounts(accounts);
    await stakingLedger.hydrateMerkleTree(accounts);
    const emptyVotingRoot = (await votingLedger.getRoot()).toString();
    for (const role of Object.keys(EXPECTED_WEIGHTS) as VoterRole[]) {
      const votingAccount = new VotingAccount({
        balance: UInt64.from(EXPECTED_WEIGHTS[role]),
      });
      const publicKey = publicKeyByRole[role];
      await votingLedger.setVotingAccount(publicKey, votingAccount);
      await votingLedger.setLeaf(publicKey, votingAccount);
    }
    const stakingRoot = await stakingLedger.getRoot();
    return {
      stakingRoot: stakingRoot.toString(),
      stakingRootBase58: LedgerHashBase58.toBase58(stakingRoot),
      emptyVotingRoot,
      votingRoot: (await votingLedger.getRoot()).toString(),
      accounts: accounts.map((account) => ({
        publicKey: account.pk.toBase58(),
        balance: account.balance.toBigInt(),
        delegate: account.delegate.toBase58(),
      })),
    };
  } finally {
    const closeResults = await Promise.allSettled([
      votingLedger.close(),
      stakingLedger.close(),
    ]);
    await sqlite.disconnect();
    const closeErrors = closeResults.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (closeErrors.length > 0) {
      throw new AggregateError(
        closeErrors,
        "independent ledger oracle cleanup failed",
      );
    }
  }
}

test("validates the varied UInt64 ledger arithmetic and import boundary", async () => {
  assert.equal(UInt64.MAXINT().toBigInt(), UINT64_MAX);
  assert.equal(
    Object.values(BALANCES).reduce((sum, value) => sum + value, 0n),
    UINT64_MAX,
  );
  assert.deepEqual(expectedVotePrefixSums(), [0n, 10n, 10n, 30n, UINT64_MAX]);
  assert.equal(
    Object.values(EXPECTED_WEIGHTS).reduce((sum, value) => sum + value, 0n),
    UINT64_MAX,
  );
  assert.equal(REQUIRED_PARTICIPATION, "3689348814741910323");
  const acceptanceCriteria =
    TreasuryProposalSmartContract.calculateAcceptanceCriteria(
      UInt128.from(PROPOSAL_AMOUNT),
      UInt128.from(BALANCES.O),
      UInt64.from(UINT64_MAX),
    );
  assert.equal(
    acceptanceCriteria.requiredParticipationBp.toString(),
    REQUIRED_PARTICIPATION_BP,
  );
  assert.equal(
    acceptanceCriteria.requiredApprovalBp.toString(),
    REQUIRED_APPROVAL_BP,
  );
  assert.equal(
    acceptanceCriteria.requiredParticipation.toString(),
    REQUIRED_PARTICIPATION,
  );

  const tempRoot = await mkdtemp(
    join(tmpdir(), "treasury-cli-uint64-boundary-"),
  );
  try {
    const fixture = JSON.parse(
      await readFile(MINI_LEDGER_PATH, "utf8"),
    ) as MinaLedgerAccount[];
    assert(fixture[0], "the supported Mina JSON fixture must not be empty");
    fixture[0].balance = formatNanomina(UINT64_MAX + 1n);
    const overflowPath = join(tempRoot, "staking-ledger-max-plus-one.json");
    await writeFile(overflowPath, `${JSON.stringify(fixture, null, 2)}\n`);
    await assert.rejects(
      runCli(
        [
          "staking-ledger",
          "from-file",
          "--lifecycle-id",
          "1",
          "--staking-ledger-path",
          overflowPath,
        ],
        {
          cwd: tempRoot,
          envOverrides: {
            PROOFS_ENABLED: PROOFS_ENABLED_VALUE,
            SQLITE_DATA_DIRECTORY: join(tempRoot, "sqlite"),
            TS_NODE_PROJECT: CLI_TS_NODE_PROJECT,
          },
          nodeLoaderPath: CLI_TS_NODE_LOADER,
          timeoutMs: 120_000,
        },
      ),
      /UInt64: Expected number between 0 and 2\^64 - 1, got 18446744073709551616/u,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test(
  `runs the ${PROOF_MODE} varied-ledger CLI voting flow`,
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const tempRoot = await mkdtemp(
      join(tmpdir(), `treasury-cli-varied-${PROOF_MODE}-`),
    );
    const cliSqliteDirectory = join(tempRoot, "cli-sqlite");
    await mkdir(cliSqliteDirectory, { recursive: true });
    await mkdir(join(tempRoot, "cache"), { recursive: true });
    const nodePort = await getAvailablePort();
    const archivePort = await getAvailablePort();
    const baseUrl = `http://127.0.0.1:${nodePort}`;
    const minaNodeUrl = `${baseUrl}/graphql`;
    const archiveNodeUrl = `http://127.0.0.1:${archivePort}/graphql`;
    const commonEnv = {
      MINA_NODE_URL: minaNodeUrl,
      MINA_NETWORK_ID: "testnet",
      PROOFS_ENABLED: PROOFS_ENABLED_VALUE,
      SQLITE_DATA_DIRECTORY: cliSqliteDirectory,
      TS_NODE_PROJECT: CLI_TS_NODE_PROJECT,
    };
    let localBlockchain: LocalBlockchainTestServer | undefined;
    let backend: LocalE2EBackend | undefined;
    let completed = false;
    const startedAt = new Date().toISOString();
    const publicArtifactDirectory = process.env.E2E_ARTIFACT_DIRECTORY;
    const proofArtifacts: ProofArtifactEvidence[] = [];
    const voterFundingTxHashes: string[] = [];
    const voteTxHashes: string[] = [];
    let independentOracle:
      | Awaited<ReturnType<typeof readIndependentLedgerOracle>>
      | undefined;
    let cliRootResult: RootResult | undefined;
    let backendRootResult: RootResult | undefined;
    let deployResult:
      | {
          treasuryOwnerTxHash: string;
          pauseControllerTxHash: string;
        }
      | undefined;
    let treasuryFundingTxHash: string | undefined;
    let proposalTxHash: string | undefined;
    let tallyTxHash: string | undefined;
    let publicEvidence: Record<string, unknown> | undefined;

    const cli = async (
      args: string[],
      envOverrides: Record<string, string> = {},
    ): Promise<string> => {
      const [command, subcommand] = args;
      console.log(
        `[cli-varied-e2e:${PROOF_MODE}] START ${command ?? "unknown"}${subcommand ? ` ${subcommand}` : ""}`,
      );
      try {
        const output = await runCli(args, {
          cwd: tempRoot,
          envOverrides: { ...commonEnv, ...envOverrides },
          nodeLoaderPath: CLI_TS_NODE_LOADER,
          timeoutMs: COMMAND_TIMEOUT_MS,
        });
        console.log(
          `[cli-varied-e2e:${PROOF_MODE}] PASS ${command ?? "unknown"}${subcommand ? ` ${subcommand}` : ""}`,
        );
        return output;
      } catch (error) {
        throw new Error(redactPrivateKeys(String(error)));
      }
    };

    try {
      localBlockchain = startLocalBlockchainTestServer({
        nodePort,
        archivePort,
        proofsEnabled: PROOFS_ENABLED,
      });
      let localBlockchainOutput = "";
      localBlockchain.child.stdout?.on("data", (chunk) => {
        localBlockchainOutput =
          `${localBlockchainOutput}${chunk.toString()}`.slice(-200_000);
      });
      localBlockchain.child.stderr?.on("data", (chunk) => {
        localBlockchainOutput =
          `${localBlockchainOutput}${chunk.toString()}`.slice(-200_000);
      });
      await waitForHealth(baseUrl);
      const adminState = await readJson<AdminState>(`${baseUrl}/admin/state`);
      assert.equal(adminState.proofsEnabled, PROOFS_ENABLED);
      const sender = adminState.testAccounts[0];
      assert(
        sender,
        `local blockchain account missing: ${localBlockchainOutput}`,
      );

      const generated = parseJsonResult<{ keypairs: GeneratedKeypair[] }>(
        await cli(["generate-keypairs", "9", "--json"]),
        "keypairs",
      ).keypairs;
      assert.equal(generated.length, 9);
      const [treasuryOwner, pauseController, proposal, recipient, ...voters] =
        generated;
      assert(treasuryOwner && pauseController && proposal && recipient);
      assert.equal(voters.length, 5);
      const voterByRole = Object.fromEntries(
        voters.map((keypair, index) => [`V${index + 1}`, keypair]),
      ) as Record<VoterRole, GeneratedKeypair>;
      const publicKeyByRole: Record<LedgerRole, string> = {
        O: treasuryOwner.publicKey,
        V1: voterByRole.V1.publicKey,
        V2: voterByRole.V2.publicKey,
        V3: voterByRole.V3.publicKey,
        V4: voterByRole.V4.publicKey,
        V5: voterByRole.V5.publicKey,
      };
      const delegateByRole: Record<LedgerRole, VoterRole> = {
        O: "V5",
        V1: "V2",
        V2: "V1",
        V3: "V5",
        V4: "V4",
        V5: "V3",
      };

      const templatePath = join(tempRoot, "staking-ledger-template.json");
      await cli([
        "staking-ledger",
        "create-development-snapshot",
        "--output-path",
        templatePath,
        "--treasury-owner-public-key",
        treasuryOwner.publicKey,
        ...voters.flatMap((voter, index) => [
          `--voter-${index + 1}-public-key`,
          voter.publicKey,
        ]),
      ]);
      const templates = JSON.parse(
        await readFile(templatePath, "utf8"),
      ) as MinaLedgerAccount[];
      const templateByPublicKey = new Map(
        templates.map((account) => [account.pk, account]),
      );
      const variedLedger = LEDGER_ORDER.map((role) => {
        const template = templateByPublicKey.get(publicKeyByRole[role]);
        assert(template, `missing Mina JSON template for ${role}`);
        return {
          ...template,
          balance: formatNanomina(BALANCES[role]),
          delegate: publicKeyByRole[delegateByRole[role]],
          token: DEFAULT_TOKEN_ID,
        };
      });
      const stakingLedgerPath = join(tempRoot, "staking-ledger-varied.json");
      await writeFile(
        stakingLedgerPath,
        `${JSON.stringify(variedLedger, null, 2)}\n`,
      );
      const oracle = await readIndependentLedgerOracle(
        stakingLedgerPath,
        publicKeyByRole,
        delegateByRole,
      );
      independentOracle = oracle;
      assert.deepEqual(
        oracle.accounts.map((account) => account.publicKey),
        LEDGER_ORDER.map((role) => publicKeyByRole[role]),
      );
      assert.deepEqual(
        oracle.accounts.map((account) => account.balance),
        LEDGER_ORDER.map((role) => BALANCES[role]),
      );
      assert.deepEqual(
        oracle.accounts.map((account) => account.delegate),
        LEDGER_ORDER.map((role) => publicKeyByRole[delegateByRole[role]]),
      );

      const importLedger = async (sqliteDirectory: string): Promise<void> => {
        await cli(
          [
            "staking-ledger",
            "from-file",
            "--lifecycle-id",
            LIFECYCLE_ID,
            "--staking-ledger-path",
            stakingLedgerPath,
          ],
          { SQLITE_DATA_DIRECTORY: sqliteDirectory },
        );
      };
      await importLedger(cliSqliteDirectory);
      const rootResult = parseJsonResult<RootResult>(
        await cli([
          "staking-ledger",
          "get-root-hash",
          "--lifecycle-id",
          LIFECYCLE_ID,
          "--expected-root-hash",
          oracle.stakingRootBase58,
          "--output-format",
          "json",
        ]),
        "ledgerHashBase58",
      );
      cliRootResult = rootResult;
      assert.equal(rootResult.ledgerHashBase58, oracle.stakingRootBase58);
      assert.equal(rootResult.stakingEpochDataLedgerHash, oracle.stakingRoot);
      await postJson(`${baseUrl}/admin/network-state`, {
        stakingEpochDataLedgerHash: rootResult.stakingEpochDataLedgerHash,
        stakingEpochDataLedgerTotalCurrency: UINT64_MAX.toString(),
      });

      const stakingProofPath = join(tempRoot, "staking-proof.json");
      await cli(["staking-ledger-to-voting-ledger", "compile"]);
      await cli([
        "staking-ledger-to-voting-ledger",
        "trace-digest",
        "--lifecycle-id",
        LIFECYCLE_ID,
      ]);
      await runWorkerFlow(
        "staking",
        commonEnv,
        tempRoot,
        async ({ host, port, queueName }) => {
          const redisArgs = [
            "--redis-host",
            host,
            "--redis-port",
            String(port),
            "--queue-name",
            queueName,
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
      const stakingProof =
        await SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(
          JSON.parse(await readFile(stakingProofPath, "utf8")),
        );
      assert.equal(stakingProof.publicInput.index.toBigInt(), 0n);
      assert.equal(
        stakingProof.publicInput.stakingLedgerRoot.toString(),
        oracle.stakingRoot,
      );
      assert.equal(
        stakingProof.publicInput.votingLedgerRoot.toString(),
        oracle.emptyVotingRoot,
      );
      assert.equal(stakingProof.publicOutput.index.toBigInt(), 9n);
      assert.equal(stakingProof.publicOutput.exhausted.toBoolean(), true);
      assert.equal(
        stakingProof.publicOutput.votingLedgerRoot.toString(),
        oracle.votingRoot,
      );
      const serializedStakingProof = await readFile(stakingProofPath, "utf8");
      proofArtifacts.push(
        proofArtifactEvidence("staking-exhausted", serializedStakingProof),
      );

      for (const voter of voters) {
        const transfer = parseJsonResult<{ transferTxHash: string }>(
          await cli([
            "transfer",
            "--sender-private-key",
            sender.privateKey,
            "--recipient-public-key",
            voter.publicKey,
            "--amount",
            VOTER_FUNDING_AMOUNT,
            "--fee",
            TX_FEE,
            "--wait",
            "true",
          ]),
          "transferTxHash",
        );
        assert(transfer.transferTxHash);
        voterFundingTxHashes.push(transfer.transferTxHash);
      }
      const deploymentState = await readJson<AdminState>(
        `${baseUrl}/admin/state`,
      );
      const deployedAtSlot = deploymentState.currentSlot;
      const participantKeys = voters.map((voter) => voter.publicKey).join(",");
      const deploymentResult = parseJsonResult<{
        treasuryOwnerAddress: string;
        pauseControllerAddress: string;
        treasuryOwnerTxHash: string;
        pauseControllerTxHash: string;
      }>(
        await cli([
          "treasury-owner",
          "deploy",
          "--sender-private-key",
          sender.privateKey,
          "--treasury-owner-private-key",
          treasuryOwner.privateKey,
          "--pause-controller-private-key",
          pauseController.privateKey,
          "--treasury-deployed-at-slot",
          String(deployedAtSlot),
          "--withdrawal-permission",
          "proofOrSignature",
          "--multisig-participants-public-keys",
          participantKeys,
          "--lifecycle-period-duration",
          String(LIFECYCLE_PERIOD_DURATION),
          "--fee",
          TX_FEE,
          "--wait",
          "true",
        ]),
        "treasuryOwnerTxHash",
      );
      assert.equal(
        deploymentResult.treasuryOwnerAddress,
        treasuryOwner.publicKey,
      );
      assert.equal(
        deploymentResult.pauseControllerAddress,
        pauseController.publicKey,
      );
      assert(deploymentResult.treasuryOwnerTxHash);
      assert(deploymentResult.pauseControllerTxHash);
      deployResult = deploymentResult;

      const treasuryFundingResult = parseJsonResult<{
        transferTxHash: string;
      }>(
        await cli([
          "treasury-owner",
          "fund-treasury",
          "--sender-private-key",
          sender.privateKey,
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
        ]),
        "transferTxHash",
      );
      assert(treasuryFundingResult.transferTxHash);
      treasuryFundingTxHash = treasuryFundingResult.transferTxHash;

      backend = await startLocalE2EBackend({
        runDirectory: join(tempRoot, "backend"),
        resourceId: process.env.E2E_RESOURCE_ID,
        minaNodeUrl,
        archiveNodeUrl,
        treasuryOwnerPublicKey: treasuryOwner.publicKey,
        proofsEnabled: PROOFS_ENABLED,
        env: commonEnv,
      });
      await importLedger(backend.sqliteDirectory);
      backendRootResult = parseJsonResult<RootResult>(
        await cli(
          [
            "staking-ledger",
            "get-root-hash",
            "--lifecycle-id",
            LIFECYCLE_ID,
            "--expected-root-hash",
            oracle.stakingRootBase58,
            "--output-format",
            "json",
          ],
          { SQLITE_DATA_DIRECTORY: backend.sqliteDirectory },
        ),
        "ledgerHashBase58",
      );
      assert.equal(
        backendRootResult.ledgerHashBase58,
        oracle.stakingRootBase58,
      );
      assert.equal(
        backendRootResult.stakingEpochDataLedgerHash,
        oracle.stakingRoot,
      );

      const proposalContentPath = join(tempRoot, "proposal.md");
      const proposalContents =
        "# Varied staking ledger\n\nThis proposal validates delegated UInt64 voting weights.\n";
      await writeFile(proposalContentPath, proposalContents);
      const createResult = parseJsonResult<{
        proposalAddress: string;
        proposalTxHash: string;
        contentSubmission: {
          ok: boolean;
          proposalPublicKey: string;
          contentChars: number;
        };
      }>(
        await cli([
          "proposal",
          "create",
          "--api-url",
          backend.appApiUrl,
          "--sender-private-key",
          sender.privateKey,
          "--treasury-owner-public-key",
          treasuryOwner.publicKey,
          "--proposal-private-key",
          proposal.privateKey,
          "--proposal-lifecycle-id",
          LIFECYCLE_ID,
          "--recipient-public-key",
          recipient.publicKey,
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
        ]),
        "proposalTxHash",
      );
      assert.equal(createResult.proposalAddress, proposal.publicKey);
      assert.equal(createResult.contentSubmission.ok, true);
      assert.equal(
        createResult.contentSubmission.proposalPublicKey,
        proposal.publicKey,
      );
      assert.equal(
        createResult.contentSubmission.contentChars,
        Array.from(proposalContents).length,
      );
      proposalTxHash = createResult.proposalTxHash;

      await postJson(`${baseUrl}/admin/slot/set`, {
        slot: deployedAtSlot + LIFECYCLE_PERIOD_DURATION * 2,
      });
      for (const role of VOTE_ORDER) {
        const voter = voterByRole[role];
        const voteResult = parseJsonResult<{
          proposalAddress: string;
          voteTxHash: string;
        }>(
          await cli([
            "proposal",
            "vote",
            "--sender-private-key",
            voter.privateKey,
            "--treasury-owner-public-key",
            treasuryOwner.publicKey,
            "--proposal-public-key",
            proposal.publicKey,
            "--voter-private-key",
            voter.privateKey,
            "--vote",
            "yay",
            "--lifecycle-period-duration",
            String(LIFECYCLE_PERIOD_DURATION),
            "--fee",
            TX_FEE,
            "--wait",
            "true",
          ]),
          "voteTxHash",
        );
        assert.equal(voteResult.proposalAddress, proposal.publicKey);
        assert(voteResult.voteTxHash);
        voteTxHashes.push(voteResult.voteTxHash);
      }

      await postJson(`${baseUrl}/admin/slot/set`, {
        slot: deployedAtSlot + LIFECYCLE_PERIOD_DURATION * 3,
      });
      const actionsPath = join(tempRoot, "vote-actions.json");
      const actionsResult = parseJsonResult<{ count: number }>(
        await cli([
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
        ]),
        "count",
      );
      assert.equal(actionsResult.count, 5);
      const actions = JSON.parse(
        await readFile(actionsPath, "utf8"),
      ) as VoteActionsFile;
      assert.equal(actions.proposalPublicKey, proposal.publicKey);
      assert.deepEqual(
        actions.voteActions.map((action) => action.publicKey),
        VOTE_ORDER.map((role) => voterByRole[role].publicKey),
      );
      assert(actions.voteActions.every((action) => action.vote === "1"));

      await waitFor(
        "five canonical varied-weight votes in App and Processor",
        async () => {
          await assertBackendReadyAndCaughtUp(backend!);
          await Promise.all([
            assertExactProjectedVotes(
              backend!.appApiUrl,
              proposal.publicKey,
              voterByRole,
            ),
            assertExactProcessorProjectedVotes(
              backend!.processorApiUrl,
              proposal.publicKey,
              voterByRole,
            ),
          ]);
        },
      );

      const voteProofPath = join(tempRoot, "vote-proof.json");
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
        "vote",
        commonEnv,
        tempRoot,
        async ({ host, port, queueName }) => {
          const redisArgs = [
            "--redis-host",
            host,
            "--redis-port",
            String(port),
            "--queue-name",
            queueName,
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
      const voteProof = await SideLoadedVoteReducerProof.fromJSON(
        JSON.parse(await readFile(voteProofPath, "utf8")),
      );
      assert.equal(
        voteProof.publicInput.fromActionsHash.toString(),
        Reducer.initialActionState.toString(),
      );
      assert.equal(
        voteProof.publicInput.votingLedgerRoot.toString(),
        oracle.votingRoot,
      );
      assert.equal(
        voteProof.publicInput.votingLedgerRoot.toString(),
        stakingProof.publicOutput.votingLedgerRoot.toString(),
      );
      assert.equal(
        voteProof.publicOutput.toActionsHash.toString(),
        actions.actionStateHistoryTarget.actionStateOne,
      );
      for (const key of [
        "actionStateOne",
        "actionStateTwo",
        "actionStateThree",
        "actionStateFour",
        "actionStateFive",
      ] as const) {
        assert.equal(
          voteProof.publicInput.actionStateHistoryTarget[key].toString(),
          actions.actionStateHistoryTarget[key],
        );
      }
      assert.equal(voteProof.publicOutput.yay.toBigInt(), UINT64_MAX);
      assert.equal(voteProof.publicOutput.nay.toBigInt(), 0n);
      assert.equal(voteProof.publicOutput.abstain.toBigInt(), 0n);
      assert.equal(
        voteProof.publicOutput.actionStateHistory.actionStateOne.found.toBoolean(),
        true,
      );
      const serializedVoteProof = await readFile(voteProofPath, "utf8");
      proofArtifacts.push(
        proofArtifactEvidence("vote-merged", serializedVoteProof),
      );

      const tallyResult = parseJsonResult<{
        tallyTxHash: string;
        proposalAddress: string;
      }>(
        await cli([
          "proposal",
          "tally-votes",
          "--sender-private-key",
          sender.privateKey,
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
        ]),
        "tallyTxHash",
      );
      assert(tallyResult.tallyTxHash);
      assert.equal(tallyResult.proposalAddress, proposal.publicKey);
      tallyTxHash = tallyResult.tallyTxHash;
      const proposalState = parseJsonResult<{
        amount: string;
        lifecycleId: string;
        stakingEpochDataLedgerHash: string;
        stakingEpochDataLedgerTotalCurrency: string;
        status: string;
        statusField: string;
        paidOutAmount: string;
      }>(
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
      assert.equal(proposalState.amount, PROPOSAL_AMOUNT);
      assert.equal(proposalState.lifecycleId, LIFECYCLE_ID);
      assert.equal(
        proposalState.stakingEpochDataLedgerHash,
        oracle.stakingRoot,
      );
      assert.equal(
        proposalState.stakingEpochDataLedgerTotalCurrency,
        UINT64_MAX.toString(),
      );
      assert.equal(proposalState.status, "approved");
      assert.equal(proposalState.statusField, "1");
      assert.equal(proposalState.paidOutAmount, "0");

      await waitFor(
        "canonical maximum tally in App and Processor",
        async () => {
          await assertBackendReadyAndCaughtUp(backend!);
          await Promise.all([
            assertExactApprovedProjection(
              backend!.appApiUrl,
              proposal.publicKey,
              proposalContents,
            ),
            assertExactProcessorApprovedProjection(
              backend!.processorApiUrl,
              proposal.publicKey,
            ),
          ]);
        },
      );

      assert(independentOracle);
      assert(cliRootResult);
      assert(backendRootResult);
      assert(deployResult);
      assert(treasuryFundingTxHash);
      assert(proposalTxHash);
      assert(tallyTxHash);
      assert.equal(voterFundingTxHashes.length, 5);
      assert.equal(voteTxHashes.length, 5);
      const ledgerJson = await readFile(stakingLedgerPath, "utf8");
      publicEvidence = {
        schemaVersion: 1,
        suite: "cli-varied-ledger",
        proofMode: PROOF_MODE,
        proofsEnabled: PROOFS_ENABLED,
        startedAt,
        finishedAt: new Date().toISOString(),
        completed: true,
        workflowCount: 1,
        ledger: {
          accountCount: LEDGER_ORDER.length,
          roleOrder: [...LEDGER_ORDER],
          balancesNanomina: Object.fromEntries(
            LEDGER_ORDER.map((role) => [role, BALANCES[role].toString()]),
          ),
          delegateRoles: {
            O: "V5",
            V1: "V2",
            V2: "V1",
            V3: "V5",
            V4: "V4",
            V5: "V3",
          },
          expectedVotingWeights: Object.fromEntries(
            Object.entries(EXPECTED_WEIGHTS).map(([role, weight]) => [
              role,
              weight.toString(),
            ]),
          ),
          totalCurrency: UINT64_MAX.toString(),
          minaJsonSha256: createHash("sha256").update(ledgerJson).digest("hex"),
        },
        votes: {
          count: VOTE_ORDER.length,
          roleOrder: [...VOTE_ORDER],
          choice: "yay",
          projectedStatus: "canonical",
          yayWeight: UINT64_MAX.toString(),
          nayWeight: "0",
          abstainWeight: "0",
        },
        roots: {
          independentStakingField: independentOracle.stakingRoot,
          independentStakingBase58: independentOracle.stakingRootBase58,
          cliImportedStakingField: cliRootResult.stakingEpochDataLedgerHash,
          backendImportedStakingField:
            backendRootResult.stakingEpochDataLedgerHash,
          independentVotingField: independentOracle.votingRoot,
          independentEmptyVotingField: independentOracle.emptyVotingRoot,
          stakingProofInputField:
            stakingProof.publicInput.stakingLedgerRoot.toString(),
          stakingProofInputVotingField:
            stakingProof.publicInput.votingLedgerRoot.toString(),
          stakingProofOutputVotingField:
            stakingProof.publicOutput.votingLedgerRoot.toString(),
          voteProofInputVotingField:
            voteProof.publicInput.votingLedgerRoot.toString(),
        },
        proofStatements: {
          stakingInputIndex: stakingProof.publicInput.index.toString(),
          stakingOutputIndex: stakingProof.publicOutput.index.toString(),
          stakingExhausted: stakingProof.publicOutput.exhausted.toBoolean(),
          voteFromActionsHash: voteProof.publicInput.fromActionsHash.toString(),
          voteToActionsHash: voteProof.publicOutput.toActionsHash.toString(),
          archiveTargetActionsHash:
            actions.actionStateHistoryTarget.actionStateOne,
        },
        tally: {
          sourceStatus: "canonical",
          contractStatus: "approved",
          contractStatusFinality: "canonical",
          requiredParticipationBp: REQUIRED_PARTICIPATION_BP,
          requiredApprovalBp: REQUIRED_APPROVAL_BP,
          requiredParticipation: REQUIRED_PARTICIPATION,
          totalParticipatingVotes: UINT64_MAX.toString(),
          approvalBp: "10000",
        },
        transactionHashes: {
          voterFunding: voterFundingTxHashes,
          pauseControllerDeployment: deployResult.pauseControllerTxHash,
          treasuryOwnerDeployment: deployResult.treasuryOwnerTxHash,
          treasuryFunding: treasuryFundingTxHash,
          proposalCreation: proposalTxHash,
          votes: voteTxHashes,
          tally: tallyTxHash,
        },
        proofArtifacts,
        cache: {
          freshPerWorkflowAndMode: true,
          cliAndWorkersShareOnlyThisWorkflowCache: true,
          pathPublished: false,
        },
        privateKeysPublished: false,
        sqlitePublished: false,
      };
      completed = true;
    } finally {
      const cleanupResults = await Promise.allSettled([
        backend?.dispose() ?? Promise.resolve(),
        localBlockchain?.stop() ?? Promise.resolve(),
      ]);
      const cleanupErrors = cleanupResults.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      let publicEvidenceRetained = false;
      if (publicArtifactDirectory && publicEvidence) {
        await mkdir(publicArtifactDirectory, { recursive: true });
        await writeFile(
          join(publicArtifactDirectory, "cli-varied-ledger-evidence.json"),
          `${JSON.stringify(publicEvidence, null, 2)}\n`,
        );
        publicEvidenceRetained = true;
      }
      if (completed && cleanupErrors.length === 0 && publicEvidenceRetained) {
        await rm(tempRoot, { recursive: true, force: true });
      } else {
        console.error(`Varied-ledger private run data retained: ${tempRoot}`);
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          "varied-ledger E2E cleanup failed",
        );
      }
    }
  },
);
