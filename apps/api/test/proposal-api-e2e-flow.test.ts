import assert from "node:assert/strict";
import { createServer } from "node:net";
import { describe, it } from "node:test";
import {
  type ArchiveEventData,
  type ArchiveEventOutput,
  type ArchiveMaxHeights,
  EventsIndexer,
  EventsApiServer,
  EventsRepository,
  type FetchEventsOptions,
} from "@repo/indexer";
import {
  EventProcessorRouter,
  EventsProcessor,
  IndexerEventsApiClient,
  ProcessorCrudApiServer,
} from "@repo/processor";
import { ProposalCreatedEventHandler } from "../src/processors/proposals/proposal-created-event-handler.js";
import { ProposalExecutedEventHandler } from "../src/processors/proposals/proposal-executed-event-handler.js";
import { ProposalExecutionEntity } from "../src/processors/proposals/proposal-execution-entity.js";
import { ProposalEntity } from "../src/processors/proposals/proposal-entity.js";
import {
  type VotingLedgerService,
  type VotingLedgerServiceLookup,
} from "../src/processors/proposals/lifecycle-voting-ledger-service-registry.js";
import { ProposalVoteDispatchedEventHandler } from "../src/processors/proposals/proposal-vote-dispatched-event-handler.js";
import { ProposalVotesTalliedEventHandler } from "../src/processors/proposals/proposal-votes-tallied-event-handler.js";
import { VoteNullifierEntity } from "../src/processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../src/processors/proposals/vote-tally-entity.js";
import { VoteEntity } from "../src/processors/proposals/vote-entity.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";

type VoteLabel = "yay" | "nay" | "abstain";
type VoteResult = "approved" | "rejected";

const KNOWN_EVENT_TYPES = [
  "proposalCreated",
  "proposalVoteDispatched",
  "proposalVotesTallied",
  "proposalExecuted",
] as const;

const EVENT_TYPE_INDEX: Record<(typeof KNOWN_EVENT_TYPES)[number], string> = {
  proposalCreated: "0",
  proposalVoteDispatched: "1",
  proposalVotesTallied: "2",
  proposalExecuted: "3",
};

const PROPOSAL_CREATED_DATA_FIELD_COUNT = 10;
const PROPOSAL_VOTE_DISPATCHED_DATA_FIELD_COUNT = 6;
const PROPOSAL_VOTES_TALLIED_DATA_FIELD_COUNT = 14;
const PROPOSAL_EXECUTED_DATA_FIELD_COUNT = 9;

interface ProposalCrudRow {
  proposalPublicKey: string;
  paidOutAmount: string;
  voteTallies?: VoteTallyCrudRow[];
  executions?: ProposalExecutionCrudRow[];
}

interface VoteCrudRow {
  proposalPublicKey: string;
  voterPublicKey: string;
  vote: VoteLabel;
  blockHeight: number | null;
  isNullified: boolean;
}

interface VoteTallyCrudRow {
  proposalPublicKey: string;
  blockHeight: number;
  yayWeight: string;
  nayWeight: string;
  abstainWeight: string;
  createdByEventType: "proposalVoteDispatched" | "proposalVotesTallied" | null;
  requiredParticipationBp: string | null;
  requiredApprovalBp: string | null;
  requiredParticipation: string | null;
  totalParticipatingVotes: string | null;
  approvalBp: string | null;
  voteResult: VoteResult | null;
  votes?: VoteCrudRow[];
  nullifiers?: VoteNullifierCrudRow[];
}

interface VoteNullifierCrudRow {
  proposalPublicKey: string;
  voterPublicKey: string;
  vote: VoteLabel;
  blockHeight: number;
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

interface ApiSnapshot {
  proposals: ProposalCrudRow[];
  votes: VoteCrudRow[];
  nullifiers: VoteNullifierCrudRow[];
  tallies: VoteTallyCrudRow[];
  executions: ProposalExecutionCrudRow[];
}

interface FlowStep {
  name: string;
  note: string;
  event: InputEvent;
  expectedCounts: {
    proposals: number;
    votes: number;
    nullifiers: number;
    tallies: number;
    executions: number;
  };
  assertSnapshot?: (snapshot: ApiSnapshot) => void;
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

async function fetchCrudRows<T>(url: string): Promise<T[]> {
  const response = await fetch(url);
  assert.equal(response.status, 200, `expected 200 for ${url}`);
  const payload = (await response.json()) as unknown;
  return extractCrudItems<T>(payload);
}

function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to resolve ephemeral port")));
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

class StubVotingLedgerService implements VotingLedgerService {
  public constructor(private readonly weightByVoter = new Map<string, bigint>()) {}

  public async start(): Promise<void> {}

  public async getVoteWeight(voterPublicKey: string): Promise<bigint> {
    return this.weightByVoter.get(voterPublicKey) ?? 0n;
  }

  public async close(): Promise<void> {}
}

class StubVotingLedgerServiceLookup implements VotingLedgerServiceLookup {
  public constructor(
    private readonly lifecycleWeights = new Map<string, Map<string, bigint>>(),
  ) {}

  public async getService(lifecycleId: string): Promise<VotingLedgerService> {
    return new StubVotingLedgerService(
      this.lifecycleWeights.get(lifecycleId) ?? new Map(),
    );
  }
}

function createTestProposalApprovalMath() {
  const BASIS_POINTS = 10_000n;
  const MIN_PARTICIPATION_BP = 2_000n;
  const MIN_APPROVAL_BP = 5_100n;
  const MAX_PARTICIPATION_BP = 5_000n;
  const MAX_APPROVAL_BP = 7_000n;
  const CURVE_CONSTANT_PARTICIPATION_BP = 500n;
  const CURVE_CONSTANT_APPROVAL_BP = 1_000n;

  const minBigInt = (a: bigint, b: bigint): bigint => (a < b ? a : b);

  return {
    async calculateAcceptanceCriteria(input: {
      proposalAmount: bigint;
      treasuryBalance: bigint;
      stakingEpochDataLedgerTotalCurrency: bigint;
    }): Promise<{ requiredParticipation: bigint; requiredApprovalBp: bigint }> {
      const ratioBp = minBigInt(
        (input.proposalAmount * BASIS_POINTS) / input.treasuryBalance,
        BASIS_POINTS,
      );
      const participationCurveDenominator =
        ratioBp +
        (CURVE_CONSTANT_PARTICIPATION_BP * (BASIS_POINTS - ratioBp)) / BASIS_POINTS;
      const participationCurveBp =
        (ratioBp * BASIS_POINTS) / participationCurveDenominator;

      const approvalCurveDenominator =
        ratioBp + (CURVE_CONSTANT_APPROVAL_BP * (BASIS_POINTS - ratioBp)) / BASIS_POINTS;
      const approvalCurveBp = (ratioBp * BASIS_POINTS) / approvalCurveDenominator;

      const requiredParticipationBp =
        MIN_PARTICIPATION_BP +
        ((MAX_PARTICIPATION_BP - MIN_PARTICIPATION_BP) * participationCurveBp) /
          BASIS_POINTS;
      const requiredApprovalBp =
        MIN_APPROVAL_BP +
        ((MAX_APPROVAL_BP - MIN_APPROVAL_BP) * approvalCurveBp) / BASIS_POINTS;
      const requiredParticipation =
        (input.stakingEpochDataLedgerTotalCurrency * requiredParticipationBp) /
        BASIS_POINTS;

      return {
        requiredParticipation,
        requiredApprovalBp,
      };
    },
    async calculateVoteResult(input: {
      yay: bigint;
      nay: bigint;
      abstain: bigint;
      requiredParticipation: bigint;
      requiredApprovalBp: bigint;
    }): Promise<"approved" | "rejected"> {
      const totalParticipatingVotes = input.yay + input.nay + input.abstain;
      const participationMet = totalParticipatingVotes >= input.requiredParticipation;
      const totalVotes = input.yay + input.nay;
      const hasApprovalVotes = totalVotes > 0n;
      const safeTotalVotes = hasApprovalVotes ? totalVotes : 1n;
      const approvalBp = (input.yay * BASIS_POINTS) / safeTotalVotes;
      const approved =
        participationMet && hasApprovalVotes && approvalBp >= input.requiredApprovalBp;
      return approved ? "approved" : "rejected";
    },
  };
}

class FakeArchiveSource {
  public pendingHead = 0;
  public canonicalHead = 0;

  private readonly pendingEvents: ArchiveEventOutput[] = [];
  private readonly canonicalEvents: ArchiveEventOutput[] = [];

  public push(status: "PENDING" | "CANONICAL", event: ArchiveEventOutput): void {
    const height = event.blockInfo.height;
    if (status === "PENDING") {
      this.pendingEvents.push(event);
      this.pendingHead = Math.max(this.pendingHead, height);
      return;
    }

    this.canonicalEvents.push(event);
    this.canonicalHead = Math.max(this.canonicalHead, height);
  }

  public async getMaxBlockHeights(): Promise<ArchiveMaxHeights> {
    return {
      canonicalMaxBlockHeight: this.canonicalHead,
      pendingMaxBlockHeight: this.pendingHead,
    };
  }

  public async fetchEvents(options: FetchEventsOptions): Promise<ArchiveEventOutput[]> {
    const source =
      options.status === "PENDING" ? this.pendingEvents : this.canonicalEvents;
    return source.filter((event) => {
      const height = event.blockInfo.height;
      return height >= options.from && height <= options.to;
    });
  }
}

abstract class InputEvent {
  public constructor(
    public readonly txHash: string,
    public readonly accountUpdateId: string,
    public readonly blockHeight: number,
  ) {}

  protected buildBaseArchiveEventData(
    eventType: (typeof KNOWN_EVENT_TYPES)[number],
    fieldValues: string[],
  ): ArchiveEventData {
    return {
      accountUpdateId: this.accountUpdateId,
      data: [EVENT_TYPE_INDEX[eventType], ...fieldValues],
      transactionInfo: {
        hash: this.txHash,
        zkappAccountUpdateIds: [Number(this.accountUpdateId)],
      },
    };
  }

  protected buildTimestamp(): string {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, this.blockHeight)).toISOString();
  }

  public abstract toArchiveEventOutput(): ArchiveEventOutput;
}

class ProposalCreatedInputEvent extends InputEvent {
  public constructor(
    txHash: string,
    accountUpdateId: string,
    blockHeight: number,
    private readonly payload: {
      proposalPublicKey: string;
      lifecycleId: number;
      amount: string;
      recipient: string;
      zkAppUriHash: string;
      stakingEpochDataLedgerHash: string;
      stakingEpochDataLedgerTotalCurrency: string;
      senderPublicKey: string;
    },
  ) {
    super(txHash, accountUpdateId, blockHeight);
  }

  public toArchiveEventOutput(): ArchiveEventOutput {
    const eventData = this.buildBaseArchiveEventData(
      "proposalCreated",
      buildMockContractFieldValues(
        this.accountUpdateId,
        PROPOSAL_CREATED_DATA_FIELD_COUNT,
      ),
    );
    const eventDataWithPayload = eventData as ArchiveEventData & {
      proposalPublicKey: string;
      lifecycleId: number;
      amount: string;
      recipient: string;
      zkAppUriHash: string;
      stakingEpochDataLedgerHash: string;
      stakingEpochDataLedgerTotalCurrency: string;
      senderPublicKey: string;
    };
    eventDataWithPayload.proposalPublicKey = this.payload.proposalPublicKey;
    eventDataWithPayload.lifecycleId = this.payload.lifecycleId;
    eventDataWithPayload.amount = this.payload.amount;
    eventDataWithPayload.recipient = this.payload.recipient;
    eventDataWithPayload.zkAppUriHash = this.payload.zkAppUriHash;
    eventDataWithPayload.stakingEpochDataLedgerHash =
      this.payload.stakingEpochDataLedgerHash;
    eventDataWithPayload.stakingEpochDataLedgerTotalCurrency =
      this.payload.stakingEpochDataLedgerTotalCurrency;
    eventDataWithPayload.senderPublicKey = this.payload.senderPublicKey;

    return {
      blockInfo: {
        height: this.blockHeight,
        timestamp: this.buildTimestamp(),
      },
      eventData: [eventDataWithPayload],
    };
  }
}

class ProposalVoteDispatchedInputEvent extends InputEvent {
  public constructor(
    txHash: string,
    accountUpdateId: string,
    blockHeight: number,
    private readonly payload: {
      proposalPublicKey: string;
      voterPublicKey: string;
      vote: VoteLabel;
      senderPublicKey: string;
    },
  ) {
    super(txHash, accountUpdateId, blockHeight);
  }

  public toArchiveEventOutput(): ArchiveEventOutput {
    const fieldValues = buildMockContractFieldValues(
      this.accountUpdateId,
      PROPOSAL_VOTE_DISPATCHED_DATA_FIELD_COUNT,
    );
    fieldValues[fieldValues.length - 1] =
      this.payload.vote === "yay"
        ? "1"
        : this.payload.vote === "nay"
          ? "2"
          : "3";
    const eventData = this.buildBaseArchiveEventData(
      "proposalVoteDispatched",
      fieldValues,
    );
    const eventDataWithPayload = eventData as ArchiveEventData & {
      proposalPublicKey: string;
      voterPublicKey: string;
      vote: VoteLabel;
      senderPublicKey: string;
    };
    eventDataWithPayload.proposalPublicKey = this.payload.proposalPublicKey;
    eventDataWithPayload.voterPublicKey = this.payload.voterPublicKey;
    eventDataWithPayload.vote = this.payload.vote;
    eventDataWithPayload.senderPublicKey = this.payload.senderPublicKey;

    return {
      blockInfo: {
        height: this.blockHeight,
        timestamp: this.buildTimestamp(),
      },
      eventData: [eventDataWithPayload],
    };
  }
}

class ProposalVotesTalliedInputEvent extends InputEvent {
  public constructor(
    txHash: string,
    accountUpdateId: string,
    blockHeight: number,
    private readonly payload: {
      proposalPublicKey: string;
      lifecycleId: number;
      proposalAmount: string;
      treasuryBalance: string;
      yayWeight: string;
      nayWeight: string;
      abstainWeight: string;
      requiredParticipationBp: string;
      requiredApprovalBp: string;
      requiredParticipation: string;
      totalParticipatingVotes: string;
      approvalBp: string;
      voteResult: VoteResult;
      senderPublicKey: string;
    },
  ) {
    super(txHash, accountUpdateId, blockHeight);
  }

  public toArchiveEventOutput(): ArchiveEventOutput {
    const fieldValues = buildMockContractFieldValues(
      this.accountUpdateId,
      PROPOSAL_VOTES_TALLIED_DATA_FIELD_COUNT,
    );
    fieldValues[fieldValues.length - 1] =
      this.payload.voteResult === "approved" ? "1" : "2";
    const eventData = this.buildBaseArchiveEventData(
      "proposalVotesTallied",
      fieldValues,
    );
    const eventDataWithPayload = eventData as ArchiveEventData & {
      proposalPublicKey: string;
      lifecycleId: number;
      proposalAmount: string;
      treasuryBalance: string;
      yayWeight: string;
      nayWeight: string;
      abstainWeight: string;
      requiredParticipationBp: string;
      requiredApprovalBp: string;
      requiredParticipation: string;
      totalParticipatingVotes: string;
      approvalBp: string;
      voteResult: VoteResult;
      senderPublicKey: string;
    };
    Object.assign(eventDataWithPayload, this.payload);

    return {
      blockInfo: {
        height: this.blockHeight,
        timestamp: this.buildTimestamp(),
      },
      eventData: [eventDataWithPayload],
    };
  }
}

class ProposalExecutedInputEvent extends InputEvent {
  public constructor(
    txHash: string,
    accountUpdateId: string,
    blockHeight: number,
    private readonly payload: {
      proposalPublicKey: string;
      lifecycleId: number;
      recipient: string;
      amountToPayOut: string;
      proposalAmount: string;
      bondAmount: string;
      senderPublicKey: string;
      paidOutAmount: string;
      remainingAmount: string;
    },
  ) {
    super(txHash, accountUpdateId, blockHeight);
  }

  public toArchiveEventOutput(): ArchiveEventOutput {
    const eventData = this.buildBaseArchiveEventData(
      "proposalExecuted",
      buildMockContractFieldValues(
        this.accountUpdateId,
        PROPOSAL_EXECUTED_DATA_FIELD_COUNT,
      ),
    );
    const eventDataWithPayload = eventData as ArchiveEventData & {
      proposalPublicKey: string;
      lifecycleId: number;
      recipient: string;
      amountToPayOut: string;
      proposalAmount: string;
      bondAmount: string;
      senderPublicKey: string;
      paidOutAmount: string;
      remainingAmount: string;
    };
    Object.assign(eventDataWithPayload, this.payload);

    return {
      blockInfo: {
        height: this.blockHeight,
        timestamp: this.buildTimestamp(),
      },
      eventData: [eventDataWithPayload],
    };
  }
}

function buildMockContractFieldValues(seed: string, count: number): string[] {
  const seedNumber = Number.parseInt(seed, 10);
  const base = Number.isFinite(seedNumber) ? seedNumber * 1_000 : 1_000;
  return Array.from({ length: count }, (_value, index) => String(base + index + 1));
}

async function fetchSnapshot(processorApiBase: string): Promise<ApiSnapshot> {
  const [proposals, votes, nullifiers, tallies, executions] = await Promise.all([
    fetchCrudRows<ProposalCrudRow>(
      `${processorApiBase}/proposals?join=voteTallies&join=voteTallies.votes&join=voteTallies.nullifiers&join=executions&sort=proposalPublicKey,ASC&limit=200`,
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
  ]);
  return { proposals, votes, nullifiers, tallies, executions };
}

describe("proposal API e2e flow", () => {
  it("indexes and projects create/vote/tally/execute flow event-by-event", async () => {
    const dataSource = createInMemoryDataSource("public", [
      ProposalEntity,
      ProposalExecutionEntity,
      VoteEntity,
      VoteNullifierEntity,
      VoteTallyEntity,
    ]);
    const repository = new EventsRepository(dataSource, "public", {
      knownEventTypes: [...KNOWN_EVENT_TYPES],
    });
    const archiveSource = new FakeArchiveSource();
    const indexer = new EventsIndexer(archiveSource, repository, {
      pollPendingIntervalMs: 60_000,
      pollCanonicalIntervalMs: 60_000,
      blockBatchSize: 10,
      pendingOverlapBlocks: 20,
      canonicalOverlapBlocks: 1,
      orphanDepthBlocks: 30,
    });

    let eventsApiServer: EventsApiServer | null = null;
    let processorCrudApiServer: ProcessorCrudApiServer | null = null;

    try {
      await repository.initialize();
      await dataSource.synchronize();

      const indexerApiPort = await getAvailablePort();
      const processorApiPort = await getAvailablePort();
      const processorApiBase = `http://127.0.0.1:${processorApiPort}`;
      const indexerApiBase = `http://127.0.0.1:${indexerApiPort}`;

      eventsApiServer = new EventsApiServer(repository, {
        port: indexerApiPort,
        pageLimitDefault: 50,
        pageLimitMax: 200,
      });
      await eventsApiServer.start();

      const votingWeights = new Map<string, Map<string, bigint>>([
        [
          "2",
          new Map<string, bigint>([
            ["voter-1", 11n],
            ["voter-2", 7n],
            ["voter-3", 5n],
            ["voter-4", 13n],
          ]),
        ],
      ]);

      const processor = new EventsProcessor(
        dataSource,
        new EventProcessorRouter([
          new ProposalCreatedEventHandler({
            resolveTreasuryBalanceForLifecycle: async (lifecycleId) =>
              lifecycleId === 2 ? "20" : null,
            deriveAcceptanceCriteria: async (input) => {
              if (input.proposalAmount === "500000000") {
                return {
                  requiredParticipationBp: "2000",
                  requiredApprovalBp: "5100",
                  requiredParticipation: "4",
                };
              }
              if (input.proposalAmount === "300000000") {
                return {
                  requiredParticipationBp: "3000",
                  requiredApprovalBp: "8000",
                  requiredParticipation: "20",
                };
              }
              return {
                requiredParticipationBp: null,
                requiredApprovalBp: null,
                requiredParticipation: null,
              };
            },
          }),
          new ProposalVoteDispatchedEventHandler(
            new StubVotingLedgerServiceLookup(votingWeights),
            createTestProposalApprovalMath(),
          ),
          new ProposalVotesTalliedEventHandler(),
          new ProposalExecutedEventHandler(),
        ]),
        {
          processorName: "proposal-api-e2e-flow-test",
          pollIntervalMs: 60_000,
          batchSize: 20,
        },
        new IndexerEventsApiClient({
          indexerApiUrl: `http://127.0.0.1:${indexerApiPort}`,
        }),
      );

      processorCrudApiServer = new ProcessorCrudApiServer({
        dataSource,
        port: processorApiPort,
        routePrefix: "processor",
        pageLimitDefault: 50,
        pageLimitMax: 200,
        outputEntitySchemas: [
          ProposalEntity,
          ProposalExecutionEntity,
          VoteEntity,
          VoteNullifierEntity,
          VoteTallyEntity,
        ],
        readOnly: true,
      });
      await processorCrudApiServer.start();

      const proposalOnePublicKey = "proposal-public-key-1";
      const proposalTwoPublicKey = "proposal-public-key-2";
      const proposalThreePublicKey = "proposal-public-key-3";

      const events = {
        createProposalOne: new ProposalCreatedInputEvent("tx-create-1", "1", 100, {
          proposalPublicKey: proposalOnePublicKey,
          lifecycleId: 2,
          amount: "500000000",
          recipient: "recipient-public-key-1",
          zkAppUriHash: "123456",
          stakingEpochDataLedgerHash: "999",
          stakingEpochDataLedgerTotalCurrency: "20",
          senderPublicKey: "sender-public-key-create-1",
        }),
        voteProposalOneYay: new ProposalVoteDispatchedInputEvent(
          "tx-vote-1",
          "2",
          101,
          {
            proposalPublicKey: proposalOnePublicKey,
            voterPublicKey: "voter-1",
            vote: "yay",
            senderPublicKey: "sender-public-key-vote-1",
          },
        ),
        voteProposalOneAbstain: new ProposalVoteDispatchedInputEvent(
          "tx-vote-2",
          "3",
          101,
          {
            proposalPublicKey: proposalOnePublicKey,
            voterPublicKey: "voter-2",
            vote: "abstain",
            senderPublicKey: "sender-public-key-vote-2",
          },
        ),
        voteProposalOneDuplicate: new ProposalVoteDispatchedInputEvent(
          "tx-vote-3",
          "4",
          101,
          {
            proposalPublicKey: proposalOnePublicKey,
            voterPublicKey: "voter-1",
            vote: "nay",
            senderPublicKey: "sender-public-key-vote-3",
          },
        ),
        tallyProposalOne: new ProposalVotesTalliedInputEvent(
          "tx-tally-1",
          "5",
          101,
          {
            proposalPublicKey: proposalOnePublicKey,
            lifecycleId: 2,
            proposalAmount: "500000000",
            treasuryBalance: "20",
            yayWeight: "11",
            nayWeight: "0",
            abstainWeight: "7",
            requiredParticipationBp: "2000",
            requiredApprovalBp: "5100",
            requiredParticipation: "4",
            totalParticipatingVotes: "18",
            approvalBp: "10000",
            voteResult: "approved",
            senderPublicKey: "sender-public-key-tally-1",
          },
        ),
        executeProposalOne: new ProposalExecutedInputEvent("tx-exec-1", "6", 130, {
          proposalPublicKey: proposalOnePublicKey,
          lifecycleId: 2,
          recipient: "recipient-public-key-1",
          amountToPayOut: "100000000",
          proposalAmount: "500000000",
          bondAmount: "50000000",
          senderPublicKey: "sender-public-key-1",
          paidOutAmount: "100000000",
          remainingAmount: "450000000",
        }),
        executeProposalOneAgain: new ProposalExecutedInputEvent(
          "tx-exec-2",
          "11",
          131,
          {
            proposalPublicKey: proposalOnePublicKey,
            lifecycleId: 2,
            recipient: "recipient-public-key-1",
            amountToPayOut: "150000000",
            proposalAmount: "500000000",
            bondAmount: "50000000",
            senderPublicKey: "sender-public-key-1",
            paidOutAmount: "250000000",
            remainingAmount: "300000000",
          },
        ),
        createProposalTwo: new ProposalCreatedInputEvent("tx-create-2", "7", 140, {
          proposalPublicKey: proposalTwoPublicKey,
          lifecycleId: 2,
          amount: "300000000",
          recipient: "recipient-public-key-2",
          zkAppUriHash: "654321",
          stakingEpochDataLedgerHash: "777",
          stakingEpochDataLedgerTotalCurrency: "20",
          senderPublicKey: "sender-public-key-create-2",
        }),
        voteProposalTwoNay: new ProposalVoteDispatchedInputEvent(
          "tx-vote-4",
          "8",
          141,
          {
            proposalPublicKey: proposalTwoPublicKey,
            voterPublicKey: "voter-3",
            vote: "nay",
            senderPublicKey: "sender-public-key-vote-4",
          },
        ),
        voteProposalTwoYay: new ProposalVoteDispatchedInputEvent(
          "tx-vote-5",
          "9",
          141,
          {
            proposalPublicKey: proposalTwoPublicKey,
            voterPublicKey: "voter-4",
            vote: "yay",
            senderPublicKey: "sender-public-key-vote-5",
          },
        ),
        tallyProposalTwo: new ProposalVotesTalliedInputEvent(
          "tx-tally-2",
          "10",
          141,
          {
            proposalPublicKey: proposalTwoPublicKey,
            lifecycleId: 2,
            proposalAmount: "300000000",
            treasuryBalance: "20",
            yayWeight: "13",
            nayWeight: "5",
            abstainWeight: "0",
            requiredParticipationBp: "3000",
            requiredApprovalBp: "8000",
            requiredParticipation: "20",
            totalParticipatingVotes: "18",
            approvalBp: "7222",
            voteResult: "rejected",
            senderPublicKey: "sender-public-key-tally-2",
          },
        ),
        createProposalThree: new ProposalCreatedInputEvent(
          "tx-create-3",
          "12",
          160,
          {
            proposalPublicKey: proposalThreePublicKey,
            lifecycleId: 2,
            amount: "100000000",
            recipient: "recipient-public-key-3",
            zkAppUriHash: "123123",
            stakingEpochDataLedgerHash: "888",
            stakingEpochDataLedgerTotalCurrency: "20",
            senderPublicKey: "sender-public-key-create-3",
          },
        ),
        tallyProposalThree: new ProposalVotesTalliedInputEvent(
          "tx-tally-3",
          "13",
          161,
          {
            proposalPublicKey: proposalThreePublicKey,
            lifecycleId: 2,
            proposalAmount: "100000000",
            treasuryBalance: "20",
            yayWeight: "0",
            nayWeight: "0",
            abstainWeight: "0",
            requiredParticipationBp: "1000",
            requiredApprovalBp: "6000",
            requiredParticipation: "2",
            totalParticipatingVotes: "0",
            approvalBp: "0",
            voteResult: "rejected",
            senderPublicKey: "sender-public-key-tally-3",
          },
        ),
      };

      const flow: FlowStep[] = [
        {
          name: "createProposalOne",
          note: "proposal is created and appears in projections",
          event: events.createProposalOne,
          expectedCounts: {
            proposals: 1,
            votes: 0,
            nullifiers: 0,
            tallies: 0,
            executions: 0,
          },
          assertSnapshot: (snapshot) => {
            const proposal = snapshot.proposals.find(
              (candidate) => candidate.proposalPublicKey === proposalOnePublicKey,
            );
            assert.ok(proposal);
            assert.equal(proposal?.paidOutAmount, "0");
          },
        },
        {
          name: "voteProposalOneYay",
          note: "first vote creates first tally row",
          event: events.voteProposalOneYay,
          expectedCounts: {
            proposals: 1,
            votes: 1,
            nullifiers: 1,
            tallies: 1,
            executions: 0,
          },
        },
        {
          name: "voteProposalOneAbstain",
          note: "second unique voter updates same block tally",
          event: events.voteProposalOneAbstain,
          expectedCounts: {
            proposals: 1,
            votes: 2,
            nullifiers: 2,
            tallies: 1,
            executions: 0,
          },
        },
        {
          name: "voteProposalOneDuplicate",
          note: "duplicate voter is recorded but nullified",
          event: events.voteProposalOneDuplicate,
          expectedCounts: {
            proposals: 1,
            votes: 3,
            nullifiers: 2,
            tallies: 1,
            executions: 0,
          },
          assertSnapshot: (snapshot) => {
            const duplicateVote = snapshot.votes.find(
              (vote) =>
                vote.proposalPublicKey === proposalOnePublicKey &&
                vote.voterPublicKey === "voter-1" &&
                vote.vote === "nay",
            );
            assert.ok(duplicateVote);
            assert.equal(duplicateVote?.isNullified, true);
          },
        },
        {
          name: "tallyProposalOne",
          note: "on-chain tally event enriches tally row with approval math and result",
          event: events.tallyProposalOne,
          expectedCounts: {
            proposals: 1,
            votes: 3,
            nullifiers: 2,
            tallies: 1,
            executions: 0,
          },
          assertSnapshot: (snapshot) => {
            const tally = snapshot.tallies.find(
              (candidate) =>
                candidate.proposalPublicKey === proposalOnePublicKey &&
                candidate.blockHeight === 101,
            );
            assert.ok(tally);
            assert.equal(tally?.yayWeight, "11");
            assert.equal(tally?.nayWeight, "0");
            assert.equal(tally?.abstainWeight, "7");
            assert.equal(tally?.createdByEventType, "proposalVotesTallied");
            assert.equal(tally?.voteResult, "approved");
            assert.equal(tally?.requiredApprovalBp, "5100");
            assert.equal(tally?.requiredParticipation, "4");
            assert.equal(tally?.totalParticipatingVotes, "18");
          },
        },
        {
          name: "executeProposalOne",
          note: "execution event creates execution projection row",
          event: events.executeProposalOne,
          expectedCounts: {
            proposals: 1,
            votes: 3,
            nullifiers: 2,
            tallies: 1,
            executions: 1,
          },
          assertSnapshot: (snapshot) => {
            const execution = snapshot.executions.find(
              (candidate) => candidate.proposalPublicKey === proposalOnePublicKey,
            );
            assert.ok(execution);
            assert.equal(execution?.amountToPayOut, "100000000");
            assert.equal(execution?.remainingAmount, "450000000");
            assert.equal(execution?.senderPublicKey, "sender-public-key-1");

            const proposal = snapshot.proposals.find(
              (candidate) => candidate.proposalPublicKey === proposalOnePublicKey,
            );
            assert.ok(proposal);
            assert.equal(proposal?.paidOutAmount, "100000000");
          },
        },
        {
          name: "executeProposalOneAgain",
          note: "second execution updates paid out total on proposal",
          event: events.executeProposalOneAgain,
          expectedCounts: {
            proposals: 1,
            votes: 3,
            nullifiers: 2,
            tallies: 1,
            executions: 2,
          },
          assertSnapshot: (snapshot) => {
            const proposal = snapshot.proposals.find(
              (candidate) => candidate.proposalPublicKey === proposalOnePublicKey,
            );
            assert.ok(proposal);
            assert.equal(proposal?.paidOutAmount, "250000000");
          },
        },
        {
          name: "createProposalTwo",
          note: "second proposal enters flow independently",
          event: events.createProposalTwo,
          expectedCounts: {
            proposals: 2,
            votes: 3,
            nullifiers: 2,
            tallies: 1,
            executions: 2,
          },
        },
        {
          name: "voteProposalTwoNay",
          note: "proposal two gets first vote and own tally row",
          event: events.voteProposalTwoNay,
          expectedCounts: {
            proposals: 2,
            votes: 4,
            nullifiers: 3,
            tallies: 2,
            executions: 2,
          },
        },
        {
          name: "voteProposalTwoYay",
          note: "proposal two receives mixed votes",
          event: events.voteProposalTwoYay,
          expectedCounts: {
            proposals: 2,
            votes: 5,
            nullifiers: 4,
            tallies: 2,
            executions: 2,
          },
        },
        {
          name: "tallyProposalTwo",
          note: "second tally marks proposal two as rejected",
          event: events.tallyProposalTwo,
          expectedCounts: {
            proposals: 2,
            votes: 5,
            nullifiers: 4,
            tallies: 2,
            executions: 2,
          },
          assertSnapshot: (snapshot) => {
            const tally = snapshot.tallies.find(
              (candidate) =>
                candidate.proposalPublicKey === proposalTwoPublicKey &&
                candidate.blockHeight === 141,
            );
            assert.ok(tally);
            assert.equal(tally?.yayWeight, "13");
            assert.equal(tally?.nayWeight, "5");
            assert.equal(tally?.abstainWeight, "0");
            assert.equal(tally?.createdByEventType, "proposalVotesTallied");
            assert.equal(tally?.voteResult, "rejected");
            assert.equal(tally?.approvalBp, "7222");
          },
        },
        {
          name: "createProposalThree",
          note: "third proposal is created for tally-only projection checks",
          event: events.createProposalThree,
          expectedCounts: {
            proposals: 3,
            votes: 5,
            nullifiers: 4,
            tallies: 2,
            executions: 2,
          },
        },
        {
          name: "tallyProposalThree",
          note: "on-chain tally without prior votes can be queried distinctly",
          event: events.tallyProposalThree,
          expectedCounts: {
            proposals: 3,
            votes: 5,
            nullifiers: 4,
            tallies: 3,
            executions: 2,
          },
          assertSnapshot: (snapshot) => {
            const tally = snapshot.tallies.find(
              (candidate) =>
                candidate.proposalPublicKey === proposalThreePublicKey &&
                candidate.blockHeight === 161,
            );
            assert.ok(tally);
            assert.equal(tally?.createdByEventType, "proposalVotesTallied");
            assert.equal(tally?.voteResult, "rejected");
          },
        },
      ];

      for (const step of flow) {
        archiveSource.push("CANONICAL", step.event.toArchiveEventOutput());
        await indexer.syncCanonicalOnce();
        assert.equal(await processor.processOnce(), 1, `expected one row after ${step.name}`);

        const snapshot = await fetchSnapshot(processorApiBase);
        assert.equal(
          snapshot.proposals.length,
          step.expectedCounts.proposals,
          `${step.name}: proposals`,
        );
        assert.equal(
          snapshot.votes.length,
          step.expectedCounts.votes,
          `${step.name}: votes`,
        );
        assert.equal(
          snapshot.nullifiers.length,
          step.expectedCounts.nullifiers,
          `${step.name}: nullifiers`,
        );
        assert.equal(
          snapshot.tallies.length,
          step.expectedCounts.tallies,
          `${step.name}: tallies`,
        );
        assert.equal(
          snapshot.executions.length,
          step.expectedCounts.executions,
          `${step.name}: executions`,
        );
        step.assertSnapshot?.(snapshot);
      }

      const sourceEventsResponse = await fetch(
        `${indexerApiBase}/events?eventTypes=${KNOWN_EVENT_TYPES.join(",")}&includeUnknown=false&limit=200`,
      );
      assert.equal(sourceEventsResponse.status, 200);
      const sourceEventsPayload = (await sourceEventsResponse.json()) as {
        items?: unknown[];
      };
      assert.equal(sourceEventsPayload.items?.length ?? 0, flow.length);

      const talliedSourceEventsResponse = await fetch(
        `${indexerApiBase}/events?eventTypes=proposalVotesTallied&includeUnknown=false&limit=200`,
      );
      assert.equal(talliedSourceEventsResponse.status, 200);
      const talliedSourceEventsPayload = (await talliedSourceEventsResponse.json()) as {
        items?: unknown[];
      };
      assert.equal(talliedSourceEventsPayload.items?.length ?? 0, 3);

      const finalSnapshot = await fetchSnapshot(processorApiBase);
      const proposalOne = finalSnapshot.proposals.find(
        (proposal) => proposal.proposalPublicKey === proposalOnePublicKey,
      );
      assert.ok(proposalOne);
      assert.equal(proposalOne?.paidOutAmount, "250000000");
      assert.equal(proposalOne?.voteTallies?.length ?? 0, 1);
      assert.equal(proposalOne?.executions?.length ?? 0, 2);

      const proposalTwo = finalSnapshot.proposals.find(
        (proposal) => proposal.proposalPublicKey === proposalTwoPublicKey,
      );
      assert.ok(proposalTwo);
      assert.equal(proposalTwo?.paidOutAmount, "0");
      assert.equal(proposalTwo?.voteTallies?.length ?? 0, 1);
      assert.equal(proposalTwo?.executions?.length ?? 0, 0);

      const proposalThree = finalSnapshot.proposals.find(
        (proposal) => proposal.proposalPublicKey === proposalThreePublicKey,
      );
      assert.ok(proposalThree);
      assert.equal(proposalThree?.paidOutAmount, "0");
      assert.equal(proposalThree?.voteTallies?.length ?? 0, 1);
      assert.equal(proposalThree?.executions?.length ?? 0, 0);

      const onChainOnlyTallies = finalSnapshot.tallies.filter(
        (tally) => tally.createdByEventType === "proposalVotesTallied",
      );
      assert.equal(onChainOnlyTallies.length, 3);
      assert.deepEqual(
        onChainOnlyTallies.map((tally) => tally.proposalPublicKey).sort(),
        [proposalOnePublicKey, proposalTwoPublicKey, proposalThreePublicKey].sort(),
      );

      await processor.stop();
    } finally {
      if (processorCrudApiServer) {
        await processorCrudApiServer.stop().catch(() => null);
      }
      if (eventsApiServer) {
        await eventsApiServer.stop().catch(() => null);
      } else {
        await repository.close().catch(() => null);
      }
      if (dataSource.isInitialized) {
        await dataSource.destroy().catch(() => null);
      }
    }
  });
});
