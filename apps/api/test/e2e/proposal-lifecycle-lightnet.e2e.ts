import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { before, describe, it } from "node:test";
import { Mina, PrivateKey, PublicKey, UInt32, UInt64 } from "o1js";
import { RedisMemoryServer } from "redis-memory-server";
import {
  ArchiveClient,
  EventsApiServer,
  EventsIndexer,
  EventsRepository,
} from "@repo/indexer";
import {
  EventProcessorRouter,
  EventsProcessor,
  IndexerEventsApiClient,
} from "@repo/processor";
import { BOND_AMOUNT_DIVISOR } from "@repo/sdk/src/provable/contracts/treasury-constants.js";
import { type ProposalVote } from "@repo/sdk/src/services/treasury-owner-service.js";
import { HttpApiServer } from "../../src/http-api-server.js";
import { createIndexerStatusRoutes } from "../../src/indexer-status-routes.js";
import { createProcessorCrudRoutes } from "../../src/processor-crud-routes.js";
import { createProposalContentRoutes } from "../../src/proposal-content-routes.js";
import { createProcessorStatusRoutes } from "../../src/processor-status-routes.js";
import { ProposalCreatedEventHandler } from "../../src/processors/proposals/proposal-created-event-handler.js";
import { ProposalExecutedEventHandler } from "../../src/processors/proposals/proposal-executed-event-handler.js";
import { ProposalEventFactEntity } from "../../src/processors/proposals/proposal-event-fact-entity.js";
import { ProposalProjectionReplayEntity } from "../../src/processors/proposals/proposal-projection-replay-entity.js";
import { ProposalExecutionEntity } from "../../src/processors/proposals/proposal-execution-entity.js";
import { LifecycleVotingLedgerServiceRegistry } from "../../src/processors/proposals/lifecycle-voting-ledger-service-registry.js";
import { ProposalVoteDispatchedEventHandler } from "../../src/processors/proposals/proposal-vote-dispatched-event-handler.js";
import { ProposalVotesTalliedEventHandler } from "../../src/processors/proposals/proposal-votes-tallied-event-handler.js";
import { ProposalEntity } from "../../src/processors/proposals/proposal-entity.js";
import { VoteNullifierEntity } from "../../src/processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../../src/processors/proposals/vote-tally-entity.js";
import {
  VoteEntity,
  type VoteLabel,
} from "../../src/processors/proposals/vote-entity.js";
import { createInMemoryDataSource } from "../support/create-in-memory-data-source.js";
import {
  getCurrentGlobalSlot,
  logTestStep,
  parseTreasuryProposalResult,
  parseTreasuryProposalActionsResult,
  parseTreasuryProposalVoteResult,
  parseTreasuryProposalExecuteResult,
  parseTreasuryProposalTallyResult,
  runCli,
  sleep,
  spawnCliWorker,
  waitForExit,
  waitForGlobalSlot,
} from "../../../cli/test/utils/cli-test-utils.js";

import {
  loadPreparedLightnetFixture,
  validatePreparedLightnetFixture,
  selectPreparedProposalLifecycle,
  prepareVotingLedgerForLifecycle,
  type PreparedLightnetFixture,
} from "../../../cli/test/utils/prepared-lightnet-fixture.js";

const RUN_LIGHTNET_E2E = process.env.RUN_LIGHTNET_E2E === "true";
const TEST_NAME = "proposal-lifecycle-lightnet.e2e";
const TRACKED_EVENT_TYPES = [
  "proposalCreated",
  "proposalVoteDispatched",
  "proposalVotesTallied",
  "proposalExecuted",
] as const;
const INDEXER_EVENT_TYPE_ORDER = [
  "proposalCreated",
  "proposalExecuted",
  "proposalPauseToggled",
  "proposalVoteDispatched",
  "proposalVotesTallied",
] as const;
const PROCESSOR_NAME = "proposal-lifecycle-lightnet-e2e";
const ARCHIVE_REQUEST_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 2_000;
const API_POLL_TIMEOUT_MS = 180_000;
const TX_FEE = UInt64.from(1_000_000_000);
const VOTES_TO_CAST = 5;
const PROPOSAL_AMOUNT = UInt64.from("10000000000");
const PROPOSAL_AMOUNT_WITH_BOND = PROPOSAL_AMOUNT.add(
  PROPOSAL_AMOUNT.div(BOND_AMOUNT_DIVISOR),
);
const CLI_PROOF_ENV = {
  PROOFS_ENABLED: "true",
} as const;

type KnownEventType = (typeof TRACKED_EVENT_TYPES)[number];

interface IndexedEventRow {
  id: string;
  eventType: string | null;
  txHash: string | null;
  blockHeight: number | null;
}

interface IndexerStatusPayload {
  ok: boolean;
  archive: {
    canonicalMaxBlockHeight: number;
    pendingMaxBlockHeight: number;
  };
  pendingCursor: number | null;
  canonicalCursor: number | null;
  remainingPendingBlocks: number;
  remainingCanonicalBlocks: number;
}

interface ProcessorStatusPayload {
  ok: boolean;
  processorName: string;
  offset: {
    lastSeenUpdatedAt: string;
    lastSeenEventId: string;
    updatedAt: string;
  } | null;
  remainingEvents: number;
}

interface ProposalExecutionCrudRow {
  proposalPublicKey: string;
  lifecycleId: number;
  recipient: string;
  amountToPayOut: string;
  proposalAmount: string;
  bondAmount: string;
  senderPublicKey: string;
  paidOutAmount: string;
  remainingAmount: string;
  blockHeight: number | null;
  status: string;
}

interface VoteNullifierCrudRow {
  proposalPublicKey: string;
  voterPublicKey: string;
  vote: VoteLabel;
  blockHeight: number;
}

interface VoteCrudRow {
  proposalPublicKey: string;
  voterPublicKey: string;
  vote: VoteLabel;
  voteWeight: string;
  blockHeight: number | null;
  isNullified: boolean;
  status: string;
}

interface VoteTallyCrudRow {
  proposalPublicKey: string;
  blockHeight: number;
  yayWeight: string;
  nayWeight: string;
  abstainWeight: string;
  createdByEventType: KnownEventType | null;
  requiredParticipationBp: string | null;
  requiredApprovalBp: string | null;
  requiredParticipation: string | null;
  totalParticipatingVotes: string | null;
  approvalBp: string | null;
  voteResult: "approved" | "rejected" | null;
  votes?: VoteCrudRow[];
  nullifiers?: VoteNullifierCrudRow[];
}

interface ProposalCrudRow {
  proposalPublicKey: string;
  lifecycleId: number;
  amount: string;
  recipient: string;
  status: string;
  paidOutAmount: string;
  requiredParticipationBp: string | null;
  requiredApprovalBp: string | null;
  requiredParticipation: string | null;
  voteTallies?: VoteTallyCrudRow[];
  executions?: ProposalExecutionCrudRow[];
}

interface ApiSnapshot {
  proposals: ProposalCrudRow[];
  votes: VoteCrudRow[];
  nullifiers: VoteNullifierCrudRow[];
  tallies: VoteTallyCrudRow[];
  executions: ProposalExecutionCrudRow[];
}

interface LifecycleApiState {
  indexerStatus: IndexerStatusPayload;
  processorStatus: ProcessorStatusPayload;
  indexedEvents: IndexedEventRow[];
  snapshot: ApiSnapshot;
}

function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() =>
          reject(new Error("Unable to resolve ephemeral port")),
        );
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForSlotWithPollingLogs(
  phaseLabel: string,
  targetSlot: number,
  timeoutMs = 900_000,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const currentSlot = await getCurrentGlobalSlot();
    if (currentSlot >= targetSlot) {
      logTestStep(TEST_NAME, `${phaseLabel}: reached`, {
        currentSlot,
        targetSlot,
      });
      return;
    }

    logTestStep(TEST_NAME, `${phaseLabel}: polling`, {
      currentSlot,
      targetSlot,
      remainingSlots: targetSlot - currentSlot,
    });

    await waitForGlobalSlot(currentSlot + 1, 120_000);
  }

  throw new Error(`Timed out waiting for ${phaseLabel} at slot ${targetSlot}`);
}

async function writeProposalContentFile(
  tempDirectory: string,
): Promise<string> {
  const proposalContentPath = join(tempDirectory, "proposal-content.md");
  await writeFile(
    proposalContentPath,
    [
      "# API Lightnet lifecycle proposal",
      "",
      "This content exists only to drive the CLI proposal create flow in the API Lightnet e2e.",
    ].join("\n"),
    "utf8",
  );
  return proposalContentPath;
}

async function runProofCli(
  args: string[],
  options: Parameters<typeof runCli>[1] = {},
): Promise<string> {
  return await runCli(args, {
    ...options,
    envOverrides: {
      ...(options.envOverrides ?? {}),
      ...CLI_PROOF_ENV,
    },
  });
}

function extractCrudItems<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const candidate = payload as { data?: unknown; items?: unknown };
  if (Array.isArray(candidate.data)) {
    return candidate.data as T[];
  }
  if (Array.isArray(candidate.items)) {
    return candidate.items as T[];
  }
  return [];
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  assert.equal(response.status, 200, `expected 200 for ${url}`);
  return (await response.json()) as T;
}

async function fetchCrudRows<T>(url: string): Promise<T[]> {
  return extractCrudItems<T>(await fetchJson<unknown>(url));
}

async function fetchSnapshot(processorApiBase: string): Promise<ApiSnapshot> {
  const [proposals, votes, nullifiers, tallies, executions] = await Promise.all(
    [
      fetchCrudRows<ProposalCrudRow>(
        `${processorApiBase}/proposals?sort=proposalPublicKey,ASC&limit=200`,
      ),
      fetchCrudRows<VoteCrudRow>(
        `${processorApiBase}/votes?sort=proposalPublicKey,ASC&sort=voterPublicKey,ASC&sort=vote,ASC&limit=200`,
      ),
      fetchCrudRows<VoteNullifierCrudRow>(
        `${processorApiBase}/vote-nullifiers?sort=proposalPublicKey,ASC&sort=voterPublicKey,ASC&limit=200`,
      ),
      fetchCrudRows<VoteTallyCrudRow>(
        `${processorApiBase}/vote-tallies?sort=proposalPublicKey,ASC&sort=blockHeight,ASC&limit=200`,
      ),
      fetchCrudRows<ProposalExecutionCrudRow>(
        `${processorApiBase}/proposal-executions?sort=proposalPublicKey,ASC&sort=blockHeight,ASC&limit=200`,
      ),
    ],
  );
  return { proposals, votes, nullifiers, tallies, executions };
}

async function fetchIndexedEvents(
  indexerApiBase: string,
): Promise<IndexedEventRow[]> {
  const payload = await fetchJson<{ items: IndexedEventRow[] }>(
    `${indexerApiBase}/events?eventTypes=${TRACKED_EVENT_TYPES.join(",")}&limit=200`,
  );
  return payload.items ?? [];
}

async function fetchLifecycleApiState(
  indexerApiBase: string,
  processorApiBase: string,
): Promise<LifecycleApiState> {
  const [indexerStatus, processorStatus, indexedEvents, snapshot] =
    await Promise.all([
      fetchJson<IndexerStatusPayload>(`${indexerApiBase}/status`),
      fetchJson<ProcessorStatusPayload>(`${processorApiBase}/status`),
      fetchIndexedEvents(indexerApiBase),
      fetchSnapshot(processorApiBase),
    ]);

  return {
    indexerStatus,
    processorStatus,
    indexedEvents,
    snapshot,
  };
}

function countIndexedEvents(
  events: IndexedEventRow[],
): Record<KnownEventType, number> {
  return TRACKED_EVENT_TYPES.reduce(
    (accumulator, eventType) => {
      accumulator[eventType] = events.filter(
        (event) => event.eventType === eventType,
      ).length;
      return accumulator;
    },
    {
      proposalCreated: 0,
      proposalVoteDispatched: 0,
      proposalVotesTallied: 0,
      proposalExecuted: 0,
    } satisfies Record<KnownEventType, number>,
  );
}

function getProposalState(
  snapshot: ApiSnapshot,
  proposalPublicKey: string,
): {
  proposal: ProposalCrudRow | null;
  votes: VoteCrudRow[];
  nullifiers: VoteNullifierCrudRow[];
  tallies: VoteTallyCrudRow[];
  executions: ProposalExecutionCrudRow[];
} {
  return {
    proposal:
      snapshot.proposals.find(
        (item) => item.proposalPublicKey === proposalPublicKey,
      ) ?? null,
    votes: snapshot.votes.filter(
      (item) => item.proposalPublicKey === proposalPublicKey,
    ),
    nullifiers: snapshot.nullifiers.filter(
      (item) => item.proposalPublicKey === proposalPublicKey,
    ),
    tallies: snapshot.tallies.filter(
      (item) => item.proposalPublicKey === proposalPublicKey,
    ),
    executions: snapshot.executions.filter(
      (item) => item.proposalPublicKey === proposalPublicKey,
    ),
  };
}

async function collectArchiveDiagnostics(
  archiveClient: ArchiveClient,
  expectedTxHashes: string[],
): Promise<string> {
  const maxHeights = await archiveClient.getMaxBlockHeights();
  const fromPending = Math.max(0, maxHeights.pendingMaxBlockHeight - 30);
  const fromCanonical = Math.max(0, maxHeights.canonicalMaxBlockHeight - 30);
  const [pendingEvents, canonicalEvents] = await Promise.all([
    archiveClient.fetchEvents({
      status: "PENDING",
      from: fromPending,
      to: maxHeights.pendingMaxBlockHeight,
    }),
    archiveClient.fetchEvents({
      status: "CANONICAL",
      from: fromCanonical,
      to: maxHeights.canonicalMaxBlockHeight,
    }),
  ]);

  const pendingTxHashes = new Set(
    pendingEvents.flatMap((event) =>
      (event.eventData ?? [])
        .map((eventData) => eventData.transactionInfo?.hash ?? null)
        .filter((hash): hash is string => Boolean(hash)),
    ),
  );
  const canonicalTxHashes = new Set(
    canonicalEvents.flatMap((event) =>
      (event.eventData ?? [])
        .map((eventData) => eventData.transactionInfo?.hash ?? null)
        .filter((hash): hash is string => Boolean(hash)),
    ),
  );

  return expectedTxHashes
    .map((txHash) => {
      const inPending = pendingTxHashes.has(txHash);
      const inCanonical = canonicalTxHashes.has(txHash);
      if (inPending || inCanonical) {
        return `${txHash}: archive(pending=${String(inPending)},canonical=${String(inCanonical)})`;
      }
      return `${txHash}: archive-missing`;
    })
    .join(", ");
}

function collectIndexerDiagnostics(
  indexedEvents: IndexedEventRow[],
  expectedEventType: KnownEventType,
  expectedTxHashes: string[],
): string {
  return expectedTxHashes
    .map((txHash) => {
      const indexedByHash = indexedEvents.filter(
        (event) => event.txHash === txHash,
      );
      if (!indexedByHash.length) {
        return `${txHash}: indexer-missing`;
      }
      if (
        indexedByHash.some((event) => event.eventType === expectedEventType)
      ) {
        return `${txHash}: indexed-as-${expectedEventType}`;
      }
      return `${txHash}: indexed-as-${indexedByHash.map((event) => event.eventType ?? "null").join("|")}`;
    })
    .join(", ");
}

async function waitForApiState(
  label: string,
  indexerApiBase: string,
  processorApiBase: string,
  assertState: (state: LifecycleApiState) => void,
  timeoutMs = API_POLL_TIMEOUT_MS,
  buildDiagnostics?: (state: LifecycleApiState) => Promise<string>,
): Promise<LifecycleApiState> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = new Error(
    `No attempts made while waiting for ${label}`,
  );
  let lastState: LifecycleApiState | null = null;

  while (Date.now() < deadline) {
    try {
      const state = await fetchLifecycleApiState(
        indexerApiBase,
        processorApiBase,
      );
      lastState = state;
      assert.equal(
        state.indexerStatus.ok,
        true,
        `${label}: expected indexer status ok`,
      );
      assert.equal(
        state.processorStatus.ok,
        true,
        `${label}: expected processor status ok`,
      );
      assert.equal(
        state.processorStatus.processorName,
        PROCESSOR_NAME,
        `${label}: unexpected processor name`,
      );
      assertState(state);
      return state;
    } catch (error) {
      lastError = error;
      await sleep(POLL_INTERVAL_MS);
    }
  }

  const diagnostics =
    lastState && buildDiagnostics
      ? await buildDiagnostics(lastState).catch(
          (error) => `diagnostics failed: ${String(error)}`,
        )
      : null;
  throw new Error(
    `${label} did not reach the expected API state within ${timeoutMs}ms: ${String(lastError)}${diagnostics ? `\n${diagnostics}` : ""}`,
  );
}

// This test is opt-in because it requires Lightnet, archive ingestion, and reducer proof generation.
describe(
  "lightnet e2e: proposal lifecycle API monitoring",
  {
    skip: !RUN_LIGHTNET_E2E,
    concurrency: 1,
  },
  () => {
    let fixture: PreparedLightnetFixture;

    before(async () => {
      fixture = await loadPreparedLightnetFixture();
      await validatePreparedLightnetFixture(fixture);
      Mina.setActiveInstance(
        Mina.Network({
          mina: fixture.minaNodeUrl,
          archive: fixture.archiveNodeUrl,
          lightnetAccountManager: fixture.accountManagerUrl,
          networkId: fixture.networkId,
        }),
      );
    });

    it(
      "indexes and serves create-to-execute proposal lifecycle state",
      { timeout: 7_200_000 },
      async () => {
        const originalSqliteDataDirectory = process.env.SQLITE_DATA_DIRECTORY;

        let tempDirectory: string | null = null;
        let dataSource = null;
        let repository: EventsRepository | null = null;
        let indexer: EventsIndexer | null = null;
        let eventsApiServer: EventsApiServer | null = null;
        let processor: EventsProcessor | null = null;
        let processorApiServer: HttpApiServer | null = null;
        let votingLedgerServices: LifecycleVotingLedgerServiceRegistry | null =
          null;

        try {
          tempDirectory = await mkdtemp(
            join(tmpdir(), "api-proposal-lifecycle-e2e-"),
          );
          const voteActionsOutputPath = join(
            tempDirectory,
            "proposal-actions.json",
          );
          const voteReducerMergedProofPath = join(
            tempDirectory,
            "vote-reducer-merge.json",
          );
          const lifecycle = await selectPreparedProposalLifecycle(fixture, {
            minimumRemainingSlots: Math.ceil(
              fixture.lifecyclePeriodDurationSlots / 2,
            ),
          });
          const proposalLifecycleId = UInt32.from(lifecycle.lifecycleId);
          const proofLifecycleId = String(lifecycle.lifecycleId);
          const { sqliteDataDirectory } = await prepareVotingLedgerForLifecycle(
            fixture,
            proofLifecycleId,
            tempDirectory,
          );
          process.env.SQLITE_DATA_DIRECTORY = sqliteDataDirectory;
          Object.assign(CLI_PROOF_ENV, {
            MINA_NODE_URL: fixture.minaNodeUrl,
            ARCHIVE_NODE_URL: fixture.archiveNodeUrl,
            NETWORK: fixture.networkId,
          });
          const proposalContentPath =
            await writeProposalContentFile(tempDirectory);
          const lifecyclePeriodDuration = UInt32.from(
            fixture.lifecyclePeriodDurationSlots,
          );
          const selectedVoteActions = fixture.voters.slice(0, VOTES_TO_CAST);
          assert.equal(selectedVoteActions.length, VOTES_TO_CAST);
          const voterPrivateKeys = selectedVoteActions.map(({ privateKey }) =>
            PrivateKey.fromBase58(privateKey),
          );
          const senderPrivateKey = voterPrivateKeys[0];
          const treasuryOwnerPublicKeyBase58 = fixture.ownerPublicKey;
          const treasuryOwnerPublicKey = PublicKey.fromBase58(
            fixture.ownerPublicKey,
          );
          const treasuryOwnerLedgerBalance = fixture.ownerBalance;
          logTestStep(TEST_NAME, "using prepared Treasury deployment", {
            treasuryOwnerPublicKey: fixture.ownerPublicKey,
            lifecycleId: proofLifecycleId,
            lifecycleStartSlot: lifecycle.startSlot,
            lifecyclePeriodDurationSlots: fixture.lifecyclePeriodDurationSlots,
            stakingLedgerRoot: fixture.stakingLedgerRoot,
          });
          dataSource = createInMemoryDataSource("public", [
            ProposalEntity,
            ProposalEventFactEntity,
            ProposalProjectionReplayEntity,
            ProposalExecutionEntity,
            VoteEntity,
            VoteNullifierEntity,
            VoteTallyEntity,
          ]);
          repository = new EventsRepository(dataSource, "public", {
            knownEventTypes: [...INDEXER_EVENT_TYPE_ORDER],
          });
          await repository.initialize();
          await dataSource.synchronize();
          // This new test database has no earlier projection to replay.
          await dataSource
            .getRepository(ProposalProjectionReplayEntity)
            .insert({
              projectionName: "proposal",
              targetChangeSequence: "0",
              state: "complete",
              completedAt: new Date(),
            });

          const archiveClient = new ArchiveClient(fixture.archiveNodeUrl, {
            treasuryOwnerContractAddress: treasuryOwnerPublicKey.toBase58(),
            archiveRequestTimeoutMs: ARCHIVE_REQUEST_TIMEOUT_MS,
          });
          const initialHeights = await archiveClient.getMaxBlockHeights();
          const indexerApiPort = await getAvailablePort();
          const processorApiPort = await getAvailablePort();
          const indexerApiBase = `http://127.0.0.1:${indexerApiPort}`;
          const processorApiBase = `http://127.0.0.1:${processorApiPort}`;

          votingLedgerServices = new LifecycleVotingLedgerServiceRegistry();
          indexer = new EventsIndexer(archiveClient, repository, {
            pollPendingIntervalMs: POLL_INTERVAL_MS,
            pollCanonicalIntervalMs: 5_000,
            blockBatchSize: 10,
            startHeight: 0,
            pendingOverlapBlocks: 20,
            canonicalOverlapBlocks: 100,
            orphanDepthBlocks: 30,
          });
          eventsApiServer = new EventsApiServer(repository, {
            port: indexerApiPort,
            pageLimitDefault: 50,
            pageLimitMax: 200,
            registerTopLevelRoutes: createIndexerStatusRoutes({
              repository,
              archive: archiveClient,
            }),
          });
          processor = new EventsProcessor(
            dataSource,
            new EventProcessorRouter([
              new ProposalCreatedEventHandler({
                resolveTreasuryBalanceForLifecycle: async (lifecycleId) =>
                  lifecycleId === Number(proposalLifecycleId.toBigint())
                    ? treasuryOwnerLedgerBalance
                    : null,
              }),
              new ProposalVoteDispatchedEventHandler(
                votingLedgerServices,
                undefined,
                {
                  resolveTreasuryBalanceForLifecycle: async (lifecycleId) =>
                    lifecycleId === Number(proposalLifecycleId.toBigint())
                      ? treasuryOwnerLedgerBalance
                      : null,
                },
              ),
              new ProposalVotesTalliedEventHandler(),
              new ProposalExecutedEventHandler(),
            ]),
            {
              processorName: PROCESSOR_NAME,
              pollIntervalMs: POLL_INTERVAL_MS,
              batchSize: 200,
            },
            new IndexerEventsApiClient({
              indexerApiUrl: indexerApiBase,
            }),
          );
          processorApiServer = new HttpApiServer({
            name: "processor-api-test",
            port: processorApiPort,
            registerRoutes: async (app) => {
              createProposalContentRoutes({ dataSource })(app);
              createProcessorStatusRoutes({
                dataSource,
                processorName: PROCESSOR_NAME,
                eventTypes: [...TRACKED_EVENT_TYPES],
              })(app);
              createProcessorCrudRoutes({
                dataSource,
                pageLimitDefault: 50,
                pageLimitMax: 200,
              })(app);
            },
            onStop: async () => undefined,
          });

          await repository.setCursor(
            EventsIndexer.PENDING_CURSOR,
            Math.max(0, initialHeights.pendingMaxBlockHeight - 1),
          );
          await repository.setCursor(
            EventsIndexer.CANONICAL_CURSOR,
            Math.max(0, initialHeights.canonicalMaxBlockHeight - 1),
          );

          await indexer.start();
          await eventsApiServer.start();
          await processor.start();
          await processorApiServer.start();

          const lifecycleTxHashes = new Set<string>();
          const proposalPrivateKey = PrivateKey.random();
          const expectedProposalPublicKey = proposalPrivateKey
            .toPublicKey()
            .toBase58();
          const recipientPublicKey = PrivateKey.random().toPublicKey();
          const recipientPublicKeyBase58 = recipientPublicKey.toBase58();

          logTestStep(TEST_NAME, "creating proposal in selected lifecycle", {
            treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
            proposalPublicKey: expectedProposalPublicKey,
            proposalLifecycleId: proposalLifecycleId.toString(),
            recipientPublicKey: recipientPublicKeyBase58,
            amount: PROPOSAL_AMOUNT.toString(),
            proofsEnabled: true,
            proposalContentPath,
          });
          await validatePreparedLightnetFixture(fixture);
          const createOutput = await runProofCli(
            [
              "proposal",
              "create",
              "--api-url",
              processorApiBase,
              "--mina-node-url",
              fixture.minaNodeUrl,
              "--sender-private-key",
              senderPrivateKey.toBase58(),
              "--treasury-owner-public-key",
              treasuryOwnerPublicKey.toBase58(),
              "--proposal-private-key",
              proposalPrivateKey.toBase58(),
              "--proposal-lifecycle-id",
              proposalLifecycleId.toString(),
              "--recipient-public-key",
              recipientPublicKeyBase58,
              "--amount",
              PROPOSAL_AMOUNT.toString(),
              "--content-file",
              proposalContentPath,
              "--lifecycle-period-duration",
              lifecyclePeriodDuration.toString(),
              "--fee",
              TX_FEE.toString(),
              "--wait",
              "true",
            ],
            {
              timeoutMs: 900_000,
              streamOutput: true,
              streamLabel: "proposal create api e2e",
            },
          );
          const createResult = parseTreasuryProposalResult(createOutput);
          assert(createResult, "expected proposal create JSON output");
          const proposalPublicKeyBase58 = createResult.proposalAddress;
          assert.equal(proposalPublicKeyBase58, expectedProposalPublicKey);
          assert(
            createResult.proposalTxHash,
            "expected proposal transaction hash",
          );

          lifecycleTxHashes.add(createResult.proposalTxHash);
          await waitForApiState(
            "proposal create API projection",
            indexerApiBase,
            processorApiBase,
            (state) => {
              const proposalState = getProposalState(
                state.snapshot,
                proposalPublicKeyBase58,
              );
              const eventCounts = countIndexedEvents(
                state.indexedEvents.filter(
                  (event) =>
                    event.txHash && lifecycleTxHashes.has(event.txHash),
                ),
              );
              assert.equal(eventCounts.proposalCreated, 1);
              assert(
                state.indexedEvents.some(
                  (event) =>
                    event.eventType === "proposalCreated" &&
                    event.txHash === createResult.proposalTxHash,
                ),
                "expected indexed proposalCreated event with create tx hash",
              );
              assert.equal(state.processorStatus.remainingEvents, 0);
              assert.ok(
                proposalState.proposal,
                `expected proposal row after create; target=${proposalPublicKeyBase58}; proposals=${state.snapshot.proposals.map((item) => item.proposalPublicKey).join(",")}; indexed=${state.indexedEvents.map((event) => `${event.eventType}:${event.txHash ?? "null"}`).join(",")}`,
              );
              assert.equal(
                proposalState.proposal?.lifecycleId,
                Number(proposalLifecycleId.toBigint()),
              );
              assert.equal(
                proposalState.proposal?.amount,
                PROPOSAL_AMOUNT.toString(),
              );
              assert.equal(
                proposalState.proposal?.recipient,
                recipientPublicKeyBase58,
              );
              assert.equal(proposalState.proposal?.paidOutAmount, "0");
              assert.ok(
                proposalState.proposal?.requiredParticipationBp,
                "expected requiredParticipationBp to be projected",
              );
              assert.ok(
                proposalState.proposal?.requiredApprovalBp,
                "expected requiredApprovalBp to be projected",
              );
              assert.ok(
                proposalState.proposal?.requiredParticipation,
                "expected requiredParticipation to be projected",
              );
            },
            API_POLL_TIMEOUT_MS,
            async (state) =>
              [
                `archive diagnostics: ${await collectArchiveDiagnostics(archiveClient, [createResult.proposalTxHash ?? ""])}`,
                `indexer diagnostics: ${collectIndexerDiagnostics(state.indexedEvents, "proposalCreated", [createResult.proposalTxHash ?? ""])}`,
                "processor clue: if the create tx hash is indexed as proposalCreated but the proposal row is still missing, the failure is in processor projection rather than archive/indexer ingestion.",
              ].join("\n"),
          );

          const votePhaseStartSlot =
            lifecycle.startSlot + fixture.lifecyclePeriodDurationSlots * 2;
          const slotBeforeVotes = await getCurrentGlobalSlot();
          if (slotBeforeVotes < votePhaseStartSlot) {
            await waitForSlotWithPollingLogs(
              "waiting for vote phase",
              votePhaseStartSlot,
              Math.max(
                900_000,
                fixture.lifecyclePeriodDurationSlots *
                  2 *
                  fixture.slotDurationMs +
                  120_000,
              ),
            );
          }

          const sentVoteActions: Array<{
            index: number;
            vote: ProposalVote;
            voterPublicKey: string;
            voteTxHash: string;
          }> = [];

          for (let index = 0; index < selectedVoteActions.length; index += 1) {
            const fixtureVoteAction = selectedVoteActions[index];
            const voterPrivateKey = voterPrivateKeys[index];
            const voterPublicKey = voterPrivateKey.toPublicKey().toBase58();
            assert.strictEqual(
              voterPublicKey,
              PrivateKey.fromBase58(fixtureVoteAction.privateKey)
                .toPublicKey()
                .toBase58(),
              `fixture voter #${index + 1} public key mismatch`,
            );

            const vote = fixtureVoteAction.vote;
            logTestStep(TEST_NAME, "casting vote", {
              index: index + 1,
              voterPublicKey,
              vote,
              proofsEnabled: true,
              waitForInclusion: true,
              parallelSubmission: false,
            });

            const voteOutput = await runProofCli(
              [
                "proposal",
                "vote",
                "--mina-node-url",
                fixture.minaNodeUrl,
                "--sender-private-key",
                voterPrivateKey.toBase58(),
                "--treasury-owner-public-key",
                treasuryOwnerPublicKey.toBase58(),
                "--proposal-public-key",
                proposalPublicKeyBase58,
                "--voter-private-key",
                voterPrivateKey.toBase58(),
                "--vote",
                vote,
                "--lifecycle-period-duration",
                lifecyclePeriodDuration.toString(),
                "--fee",
                TX_FEE.toString(),
                "--wait",
                "true",
              ],
              {
                timeoutMs: 900_000,
                streamOutput: true,
                streamLabel: `proposal vote ${index + 1} api e2e`,
              },
            ).catch(async (error) => {
              const currentSlot = await getCurrentGlobalSlot().catch(() => -1);
              const votePhaseEndSlot =
                lifecycle.startSlot +
                fixture.lifecyclePeriodDurationSlots * 3 -
                1;
              throw new Error(
                `vote ${index + 1} CLI submission failed at slot=${currentSlot} during vote-phase-end=${votePhaseEndSlot}: ${String(error)}`,
              );
            });
            const voteResult = parseTreasuryProposalVoteResult(voteOutput);
            assert(
              voteResult,
              `expected proposal vote #${index + 1} JSON output`,
            );
            assert.strictEqual(
              voteResult.proposalAddress,
              proposalPublicKeyBase58,
            );
            assert(voteResult.voteTxHash, "expected vote transaction hash");

            lifecycleTxHashes.add(voteResult.voteTxHash);
            sentVoteActions.push({
              index: index + 1,
              vote,
              voterPublicKey,
              voteTxHash: voteResult.voteTxHash,
            });

            if (index < selectedVoteActions.length - 1) {
              const currentVoteSlot = await getCurrentGlobalSlot();
              await waitForSlotWithPollingLogs(
                `waiting one block after vote ${index + 1}`,
                currentVoteSlot + 1,
                120_000,
              );
            }
          }

          const postVotesSlot = await getCurrentGlobalSlot();
          await waitForSlotWithPollingLogs(
            "waiting one block after final vote",
            postVotesSlot + 1,
            120_000,
          );

          await waitForApiState(
            "proposal votes API projection",
            indexerApiBase,
            processorApiBase,
            (state) => {
              const proposalState = getProposalState(
                state.snapshot,
                proposalPublicKeyBase58,
              );
              const eventCounts = countIndexedEvents(
                state.indexedEvents.filter(
                  (event) =>
                    event.txHash && lifecycleTxHashes.has(event.txHash),
                ),
              );
              assert.equal(eventCounts.proposalCreated, 1);
              if (
                eventCounts.proposalVoteDispatched !== sentVoteActions.length
              ) {
                throw new Error(
                  `expected ${sentVoteActions.length} indexed vote events, got ${eventCounts.proposalVoteDispatched}; indexedEvents=${state.indexedEvents.map((event) => `${event.eventType}:${event.txHash ?? "null"}`).join(",")}`,
                );
              }
              assert(
                sentVoteActions.every((voteAction) =>
                  state.indexedEvents.some(
                    (event) =>
                      event.eventType === "proposalVoteDispatched" &&
                      event.txHash === voteAction.voteTxHash,
                  ),
                ),
                "expected all vote tx hashes to be visible through /events",
              );
              assert.equal(state.processorStatus.remainingEvents, 0);
              assert.ok(
                proposalState.proposal,
                "expected proposal row after votes",
              );
              if (proposalState.votes.length !== sentVoteActions.length) {
                throw new Error(
                  `expected ${sentVoteActions.length} projected votes for ${proposalPublicKeyBase58}, got ${proposalState.votes.length}; allVoteProposalKeys=${state.snapshot.votes.map((vote) => vote.proposalPublicKey).join(",")}; allVoteVoters=${state.snapshot.votes.map((vote) => vote.voterPublicKey).join(",")}`,
                );
              }
              if (proposalState.nullifiers.length !== sentVoteActions.length) {
                throw new Error(
                  `expected ${sentVoteActions.length} projected nullifiers for ${proposalPublicKeyBase58}, got ${proposalState.nullifiers.length}; allNullifierProposalKeys=${state.snapshot.nullifiers.map((nullifier) => nullifier.proposalPublicKey).join(",")}; allNullifierVoters=${state.snapshot.nullifiers.map((nullifier) => nullifier.voterPublicKey).join(",")}`,
                );
              }
              assert.equal(
                proposalState.votes.filter((vote) => vote.isNullified).length,
                0,
                "expected no duplicate votes to be nullified",
              );
              assert.ok(
                proposalState.tallies.length >= 1,
                "expected vote tally rows to exist after votes",
              );
              assert(
                proposalState.tallies.some(
                  (tally) =>
                    tally.createdByEventType === "proposalVoteDispatched" &&
                    (BigInt(tally.yayWeight) > 0n ||
                      BigInt(tally.nayWeight) > 0n ||
                      BigInt(tally.abstainWeight) > 0n),
                ),
                "expected a running tally created from vote-dispatched events",
              );
            },
            API_POLL_TIMEOUT_MS,
            async (state) =>
              [
                `archive diagnostics: ${await collectArchiveDiagnostics(
                  archiveClient,
                  sentVoteActions.map((voteAction) => voteAction.voteTxHash),
                )}`,
                `indexer diagnostics: ${collectIndexerDiagnostics(
                  state.indexedEvents,
                  "proposalVoteDispatched",
                  sentVoteActions.map((voteAction) => voteAction.voteTxHash),
                )}`,
                "processor clue: if vote tx hashes are indexed as proposalVoteDispatched but /votes or /vote-nullifiers are missing rows, the failure is in processor handling rather than archive/indexer ingestion.",
              ].join("\n"),
          );

          logTestStep(TEST_NAME, "fetching proposal actions via CLI", {
            archiveNodeUrl: fixture.archiveNodeUrl,
            treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
            proposalPublicKey: proposalPublicKeyBase58,
            outputPath: voteActionsOutputPath,
          });
          let fetchActionsResult:
            | ReturnType<typeof parseTreasuryProposalActionsResult>
            | undefined;
          const fetchActionsStartedAt = Date.now();
          while (Date.now() - fetchActionsStartedAt < 180_000) {
            const fetchActionsOutput = await runCli(
              [
                "proposal",
                "fetch-actions",
                "--archive-node-url",
                fixture.archiveNodeUrl,
                "--treasury-owner-public-key",
                treasuryOwnerPublicKey.toBase58(),
                "--proposal-public-key",
                proposalPublicKeyBase58,
                "--output-path",
                voteActionsOutputPath,
              ],
              {
                timeoutMs: 120_000,
                streamOutput: true,
                streamLabel: "proposal fetch-actions api e2e",
              },
            );
            const parsedResult =
              parseTreasuryProposalActionsResult(fetchActionsOutput);
            fetchActionsResult = parsedResult;
            if (
              parsedResult &&
              parsedResult.proposalPublicKey === proposalPublicKeyBase58 &&
              parsedResult.count >= selectedVoteActions.length
            ) {
              break;
            }
            logTestStep(
              TEST_NAME,
              "proposal actions not fully indexed yet, retrying next slot",
              {
                fetchedCount: parsedResult?.count,
                expectedCount: selectedVoteActions.length,
              },
            );
            const retrySlot = await getCurrentGlobalSlot();
            await waitForSlotWithPollingLogs(
              "waiting before proposal fetch-actions retry",
              retrySlot + 1,
              120_000,
            );
          }
          assert(
            fetchActionsResult,
            "expected proposal fetch-actions JSON output",
          );
          assert.strictEqual(
            fetchActionsResult.proposalPublicKey,
            proposalPublicKeyBase58,
          );
          assert.strictEqual(
            fetchActionsResult.count,
            selectedVoteActions.length,
            "expected fetched proposal actions count to match sent votes",
          );

          logTestStep(
            TEST_NAME,
            "running vote-reducer trace-run-batch CLI command",
            {
              lifecycleId: proofLifecycleId,
              voteActionsPath: voteActionsOutputPath,
            },
          );
          await runProofCli(
            [
              "vote-reducer",
              "trace-run-batch",
              "--staking-ledger-to-voting-ledger-proof-path",
              fixture.exhaustedProofPath,
              "--treasury-owner-public-key",
              treasuryOwnerPublicKeyBase58,
              "--lifecycle-id",
              proofLifecycleId,
              "--vote-actions-path",
              voteActionsOutputPath,
            ],
            {
              timeoutMs: 600_000,
              streamOutput: true,
              streamLabel: "vote-reducer trace-run-batch api e2e",
            },
          );

          const redisServer = new RedisMemoryServer();
          const redisHost = await redisServer.getHost();
          const redisPort = await redisServer.getPort();
          const queueName = `proposal-lifecycle-api-e2e-${Date.now()}-queue`;
          const workerProcess = spawnCliWorker(queueName, {
            redisHost,
            redisPort,
            stdio: "inherit",
            envOverrides: {
              ...CLI_PROOF_ENV,
            },
          });
          await sleep(400);
          try {
            logTestStep(
              TEST_NAME,
              "running vote-reducer prove-run-batch CLI command",
              {
                lifecycleId: proofLifecycleId,
                queueName,
                redisHost,
                redisPort,
              },
            );
            await runProofCli(
              [
                "vote-reducer",
                "prove-run-batch",
                "--vote-actions-path",
                voteActionsOutputPath,
                "--lifecycle-id",
                proofLifecycleId,
                "--queue-name",
                queueName,
                "--redis-host",
                redisHost,
                "--redis-port",
                String(redisPort),
              ],
              {
                timeoutMs: 900_000,
                streamOutput: true,
                streamLabel: "vote-reducer prove-run-batch api e2e",
              },
            );

            logTestStep(
              TEST_NAME,
              "running vote-reducer prove-merge CLI command",
              {
                lifecycleId: proofLifecycleId,
                queueName,
                outputPath: voteReducerMergedProofPath,
              },
            );
            await runProofCli(
              [
                "vote-reducer",
                "prove-merge",
                "--vote-actions-path",
                voteActionsOutputPath,
                "--lifecycle-id",
                proofLifecycleId,
                "--queue-name",
                queueName,
                "--redis-host",
                redisHost,
                "--redis-port",
                String(redisPort),
                "--proof-output-path",
                voteReducerMergedProofPath,
              ],
              {
                timeoutMs: 900_000,
                streamOutput: true,
                streamLabel: "vote-reducer prove-merge api e2e",
              },
            );
          } finally {
            workerProcess.kill("SIGTERM");
            await waitForExit(workerProcess, 5_000).catch(() => undefined);
            await redisServer.stop();
          }

          const mergedProof = JSON.parse(
            await readFile(voteReducerMergedProofPath, "utf8"),
          ) as { publicInput?: unknown; publicOutput?: unknown };
          assert(
            mergedProof.publicInput,
            "expected vote-reducer merged proof JSON to contain publicInput",
          );
          assert(
            mergedProof.publicOutput,
            "expected vote-reducer merged proof JSON to contain publicOutput",
          );
          JSON.parse(
            await readFile(fixture.exhaustedProofPath, "utf8"),
          ) as unknown;

          logTestStep(TEST_NAME, "running proposal tally-votes CLI command", {
            lifecycleId: proofLifecycleId,
            treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
            proposalPublicKey: proposalPublicKeyBase58,
            voteReducerProofPath: voteReducerMergedProofPath,
            stakingLedgerToVotingLedgerProofPath: fixture.exhaustedProofPath,
          });
          await waitForSlotWithPollingLogs(
            "waiting for cooldown phase",
            lifecycle.startSlot + fixture.lifecyclePeriodDurationSlots * 3,
            Math.max(
              900_000,
              fixture.lifecyclePeriodDurationSlots *
                3 *
                fixture.slotDurationMs +
                120_000,
            ),
          );
          const tallyOutput = await runProofCli(
            [
              "proposal",
              "tally-votes",
              "--mina-node-url",
              fixture.minaNodeUrl,
              "--sender-private-key",
              senderPrivateKey.toBase58(),
              "--treasury-owner-public-key",
              treasuryOwnerPublicKey.toBase58(),
              "--proposal-public-key",
              proposalPublicKeyBase58,
              "--vote-reducer-proof-path",
              voteReducerMergedProofPath,
              "--staking-ledger-to-voting-ledger-proof-path",
              fixture.exhaustedProofPath,
              "--lifecycle-id",
              proofLifecycleId,
              "--lifecycle-period-duration",
              String(fixture.lifecyclePeriodDurationSlots),
              "--fee",
              TX_FEE.toString(),
              "--wait",
              "true",
            ],
            {
              timeoutMs: 900_000,
              streamOutput: true,
              streamLabel: "proposal tally-votes api e2e",
            },
          );
          const tallyResult = parseTreasuryProposalTallyResult(tallyOutput);
          assert(tallyResult, "expected proposal tally-votes JSON output");
          assert.strictEqual(
            tallyResult.proposalAddress,
            proposalPublicKeyBase58,
          );
          assert(
            tallyResult.tallyTxHash,
            "expected proposal tally-votes tx hash",
          );

          lifecycleTxHashes.add(tallyResult.tallyTxHash);
          await waitForApiState(
            "proposal tally API projection",
            indexerApiBase,
            processorApiBase,
            (state) => {
              const proposalState = getProposalState(
                state.snapshot,
                proposalPublicKeyBase58,
              );
              const eventCounts = countIndexedEvents(
                state.indexedEvents.filter(
                  (event) =>
                    event.txHash && lifecycleTxHashes.has(event.txHash),
                ),
              );
              assert.equal(eventCounts.proposalVotesTallied, 1);
              assert(
                state.indexedEvents.some(
                  (event) =>
                    event.eventType === "proposalVotesTallied" &&
                    event.txHash === tallyResult.tallyTxHash,
                ),
                "expected indexed proposalVotesTallied event with tally tx hash",
              );
              assert.equal(state.processorStatus.remainingEvents, 0);
              assert.ok(
                proposalState.tallies.some(
                  (tally) =>
                    tally.createdByEventType === "proposalVotesTallied" &&
                    tally.voteResult === "approved",
                ),
                "expected a final approved tally row after tally-votes",
              );
              assert.equal(
                proposalState.executions.length,
                0,
                "expected no execution rows before execute",
              );
            },
            API_POLL_TIMEOUT_MS,
            async (state) =>
              [
                `archive diagnostics: ${await collectArchiveDiagnostics(archiveClient, [tallyResult.tallyTxHash ?? ""])}`,
                `indexer diagnostics: ${collectIndexerDiagnostics(state.indexedEvents, "proposalVotesTallied", [tallyResult.tallyTxHash ?? ""])}`,
                "processor clue: if the tally tx hash is indexed as proposalVotesTallied but the final tally row is missing or not approved, the failure is in processor tally projection.",
              ].join("\n"),
          );

          const executePhaseStartSlot =
            lifecycle.startSlot + fixture.lifecyclePeriodDurationSlots * 4;
          const slotBeforeExecute = await getCurrentGlobalSlot();
          if (slotBeforeExecute < executePhaseStartSlot) {
            await waitForSlotWithPollingLogs(
              "waiting for execute phase",
              executePhaseStartSlot,
              Math.max(
                900_000,
                fixture.lifecyclePeriodDurationSlots *
                  4 *
                  fixture.slotDurationMs +
                  120_000,
              ),
            );
          }

          logTestStep(TEST_NAME, "running proposal execute CLI command", {
            treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
            proposalPublicKey: proposalPublicKeyBase58,
            recipientPublicKey: recipientPublicKeyBase58,
            expectedAmountToPayOut: PROPOSAL_AMOUNT_WITH_BOND.toString(),
            proofsEnabled: true,
          });
          const executeOutput = await runProofCli(
            [
              "proposal",
              "execute",
              "--mina-node-url",
              fixture.minaNodeUrl,
              "--sender-private-key",
              senderPrivateKey.toBase58(),
              "--treasury-owner-public-key",
              treasuryOwnerPublicKey.toBase58(),
              "--proposal-public-key",
              proposalPublicKeyBase58,
              "--recipient-public-key",
              recipientPublicKeyBase58,
              "--amount-to-pay-out",
              PROPOSAL_AMOUNT_WITH_BOND.toString(),
              "--lifecycle-period-duration",
              String(fixture.lifecyclePeriodDurationSlots),
              "--fee",
              TX_FEE.toString(),
              "--wait",
              "true",
            ],
            {
              timeoutMs: 900_000,
              streamOutput: true,
              streamLabel: "proposal execute api e2e",
            },
          );
          const executeResult =
            parseTreasuryProposalExecuteResult(executeOutput);
          assert(executeResult, "expected proposal execute JSON output");
          assert.strictEqual(
            executeResult.proposalAddress,
            proposalPublicKeyBase58,
          );
          assert.strictEqual(
            executeResult.recipientPublicKey,
            recipientPublicKeyBase58,
          );
          assert.strictEqual(
            executeResult.amountToPayOut,
            PROPOSAL_AMOUNT_WITH_BOND.toString(),
            "expected execute payout to match configured amount",
          );
          assert(
            executeResult.executeTxHash,
            "expected proposal execute tx hash",
          );

          lifecycleTxHashes.add(executeResult.executeTxHash);
          await waitForApiState(
            "proposal execute API projection",
            indexerApiBase,
            processorApiBase,
            (state) => {
              const proposalState = getProposalState(
                state.snapshot,
                proposalPublicKeyBase58,
              );
              const eventCounts = countIndexedEvents(
                state.indexedEvents.filter(
                  (event) =>
                    event.txHash && lifecycleTxHashes.has(event.txHash),
                ),
              );
              assert.equal(eventCounts.proposalCreated, 1);
              assert.equal(
                eventCounts.proposalVoteDispatched,
                sentVoteActions.length,
              );
              assert.equal(eventCounts.proposalVotesTallied, 1);
              assert.equal(eventCounts.proposalExecuted, 1);
              assert(
                state.indexedEvents.some(
                  (event) =>
                    event.eventType === "proposalExecuted" &&
                    event.txHash === executeResult.executeTxHash,
                ),
                "expected indexed proposalExecuted event with execute tx hash",
              );
              assert.equal(state.processorStatus.remainingEvents, 0);
              assert.ok(
                proposalState.proposal,
                "expected proposal row after execute",
              );
              assert.equal(
                proposalState.proposal?.paidOutAmount,
                PROPOSAL_AMOUNT_WITH_BOND.toString(),
              );
              assert.equal(proposalState.executions.length, 1);
              assert.equal(
                proposalState.executions[0]?.recipient,
                recipientPublicKeyBase58,
              );
              assert.equal(
                proposalState.executions[0]?.amountToPayOut,
                PROPOSAL_AMOUNT_WITH_BOND.toString(),
              );
              assert.equal(
                proposalState.executions[0]?.paidOutAmount,
                PROPOSAL_AMOUNT_WITH_BOND.toString(),
              );
              assert.equal(proposalState.executions[0]?.remainingAmount, "0");
            },
            API_POLL_TIMEOUT_MS,
            async (state) =>
              [
                `archive diagnostics: ${await collectArchiveDiagnostics(archiveClient, [executeResult.executeTxHash ?? ""])}`,
                `indexer diagnostics: ${collectIndexerDiagnostics(state.indexedEvents, "proposalExecuted", [executeResult.executeTxHash ?? ""])}`,
                "processor clue: if the execute tx hash is indexed as proposalExecuted but /proposal-executions or proposal paidOutAmount remain stale, the failure is in processor execution projection.",
              ].join("\n"),
          );
        } finally {
          if (originalSqliteDataDirectory === undefined) {
            delete process.env.SQLITE_DATA_DIRECTORY;
          } else {
            process.env.SQLITE_DATA_DIRECTORY = originalSqliteDataDirectory;
          }
          if (processorApiServer) {
            await processorApiServer.stop().catch(() => null);
          }
          if (processor) {
            await processor.stop().catch(() => null);
          }
          if (eventsApiServer) {
            await eventsApiServer.stop().catch(() => null);
          }
          if (indexer) {
            await indexer.stop().catch(() => null);
          }
          if (repository) {
            await repository.close().catch(() => null);
          }
          if (votingLedgerServices) {
            await votingLedgerServices.close().catch(() => null);
          }
          if (dataSource?.isInitialized) {
            await dataSource.destroy().catch(() => null);
          }
          if (tempDirectory) {
            await rm(tempDirectory, { recursive: true, force: true }).catch(
              () => null,
            );
          }
        }
      },
    );
  },
);
