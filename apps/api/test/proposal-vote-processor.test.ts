import assert from "node:assert/strict";
import { createServer } from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  ArchiveEventEntity,
  type ArchiveEventData,
  EventsApiServer,
  EventsRepository,
  type ArchiveEventOutput,
} from "@repo/indexer";
import {
  EventProcessorRouter,
  EventsProcessor,
  IndexerEventsApiClient,
} from "@repo/processor";
import { PrivateKey, PublicKey } from "o1js";
import type { DataSource } from "typeorm";
import { ProposalVoteDispatchedEvent } from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import { Vote } from "@repo/sdk/src/provable/contracts/treasury-proposal/vote-reducer.js";
import { ProposalCreatedEventHandler } from "../src/processors/proposals/proposal-created-event-handler.js";
import { ProposalVoteDispatchedEventHandler } from "../src/processors/proposals/proposal-vote-dispatched-event-handler.js";
import { ProposalExecutionEntity } from "../src/processors/proposals/proposal-execution-entity.js";
import { ProposalEntity } from "../src/processors/proposals/proposal-entity.js";
import { ProposalEventFactEntity } from "../src/processors/proposals/proposal-event-fact-entity.js";
import {
  type VotingLedgerService,
  type VotingLedgerServiceLookup,
} from "../src/processors/proposals/lifecycle-voting-ledger-service-registry.js";
import { VoteEntity } from "../src/processors/proposals/vote-entity.js";
import { VoteNullifierEntity } from "../src/processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../src/processors/proposals/vote-tally-entity.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";

const PROPOSAL_VOTE_DISPATCHED_EVENT_NAME = "proposalVoteDispatched";
const ARCHIVE_RECIPIENT_PUBLIC_KEY = PrivateKey.random()
  .toPublicKey()
  .toBase58();
const ARCHIVE_SENDER_PUBLIC_KEY = PrivateKey.random().toPublicKey().toBase58();

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

function buildVoteEventOutput(input: {
  proposalPublicKey: string;
  voterPublicKey: string;
  vote: "yay" | "nay" | "abstain";
  txHash: string;
  accountUpdateId: string;
  blockHeight: number;
}): ArchiveEventOutput {
  const vote =
    input.vote === "yay"
      ? Vote.YAY
      : input.vote === "nay"
        ? Vote.NAY
        : Vote.ABSTRAIN;
  const eventData: ArchiveEventData = {
    accountUpdateId: input.accountUpdateId,
    eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
    data: [
      "3",
      ...ProposalVoteDispatchedEvent.toFields(
        new ProposalVoteDispatchedEvent({
          proposalPublicKey: PublicKey.fromBase58(input.proposalPublicKey),
          voterPublicKey: PublicKey.fromBase58(input.voterPublicKey),
          vote,
          senderPublicKey: PrivateKey.random().toPublicKey(),
        }),
      ).map((field) => field.toString()),
    ],
    transactionInfo: {
      hash: input.txHash,
      zkappAccountUpdateIds: [Number(input.accountUpdateId)],
    },
  };

  return {
    blockInfo: {
      height: input.blockHeight,
      timestamp: new Date(
        Date.UTC(2026, 0, 1, 0, 0, input.blockHeight),
      ).toISOString(),
    },
    eventData: [eventData],
  };
}

function buildFieldEncodedVoteEventOutput(input: {
  proposalPublicKey: string;
  voterPublicKey: string;
  vote: Vote;
  txHash: string;
  accountUpdateId: string;
  blockHeight: number;
}): ArchiveEventOutput {
  const eventData: ArchiveEventData = {
    accountUpdateId: input.accountUpdateId,
    eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
    data: [
      "3",
      ...ProposalVoteDispatchedEvent.toFields(
        new ProposalVoteDispatchedEvent({
          proposalPublicKey: PublicKey.fromBase58(input.proposalPublicKey),
          voterPublicKey: PublicKey.fromBase58(input.voterPublicKey),
          vote: input.vote,
          senderPublicKey: PrivateKey.random().toPublicKey(),
        }),
      ).map((field) => field.toString()),
    ],
    transactionInfo: {
      hash: input.txHash,
      zkappAccountUpdateIds: [Number(input.accountUpdateId)],
    },
  };

  return {
    blockInfo: {
      height: input.blockHeight,
      timestamp: new Date(
        Date.UTC(2026, 0, 1, 0, 0, input.blockHeight),
      ).toISOString(),
    },
    eventData: [eventData],
  };
}

function buildProposalCreatedEventEntity(
  proposalPublicKey: string,
): ArchiveEventEntity {
  const now = new Date();
  const event = new ArchiveEventEntity();
  event.id = "9001";
  event.changeSequence = "9001";
  event.status = "canonical";
  event.pendingSeenAtHeight = null;
  event.blockHeight = 100;
  event.blockTimestamp = now;
  event.eventType = "proposalCreated";
  event.txHash = "tx-create-child-first";
  event.accountUpdateId = "1";
  event.accountUpdateIndex = 0;
  event.eventIndex = 0;
  event.blockEventIndex = 0;
  event.rawEventData = {
    proposalPublicKey,
    lifecycleId: 2,
    amount: "500000000",
    recipient: ARCHIVE_RECIPIENT_PUBLIC_KEY,
    zkAppUriHash: "12345",
    stakingEpochDataLedgerHash: "999",
    stakingEpochDataLedgerTotalCurrency: "20",
    requiredParticipationBp: "2000",
    requiredApprovalBp: "5100",
    requiredParticipation: "4",
    senderPublicKey: ARCHIVE_SENDER_PUBLIC_KEY,
  } as never;
  event.indexedAt = now;
  event.updatedAt = now;
  return event;
}

class StubVotingLedgerService implements VotingLedgerService {
  public constructor(
    private readonly weightByVoter = new Map<string, bigint>(),
  ) {}

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
        (CURVE_CONSTANT_PARTICIPATION_BP * (BASIS_POINTS - ratioBp)) /
          BASIS_POINTS;
      const participationCurveBp =
        (ratioBp * BASIS_POINTS) / participationCurveDenominator;

      const approvalCurveDenominator =
        ratioBp +
        (CURVE_CONSTANT_APPROVAL_BP * (BASIS_POINTS - ratioBp)) / BASIS_POINTS;
      const approvalCurveBp =
        (ratioBp * BASIS_POINTS) / approvalCurveDenominator;

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
      const participationMet =
        totalParticipatingVotes >= input.requiredParticipation;
      const totalVotes = input.yay + input.nay;
      const hasApprovalVotes = totalVotes > 0n;
      const safeTotalVotes = hasApprovalVotes ? totalVotes : 1n;
      const approvalBp = (input.yay * BASIS_POINTS) / safeTotalVotes;
      const approved =
        participationMet &&
        hasApprovalVotes &&
        approvalBp >= input.requiredApprovalBp;
      return approved ? "approved" : "rejected";
    },
  };
}

describe("proposal vote processor", () => {
  let dataSource: DataSource;
  let repository: EventsRepository;
  let eventsApiServer: EventsApiServer;
  let processor: EventsProcessor;
  let processorWeights: Map<string, Map<string, bigint>>;

  beforeEach(async () => {
    dataSource = createInMemoryDataSource("public", [
      ProposalEntity,
      ProposalEventFactEntity,
      ProposalExecutionEntity,
      VoteEntity,
      VoteNullifierEntity,
      VoteTallyEntity,
    ]);
    repository = new EventsRepository(dataSource, "public", {
      knownEventTypes: [PROPOSAL_VOTE_DISPATCHED_EVENT_NAME],
    });
    await repository.initialize();
    await dataSource.synchronize();

    const port = await getAvailablePort();
    eventsApiServer = new EventsApiServer(repository, {
      port,
      pageLimitDefault: 50,
      pageLimitMax: 200,
    });
    await eventsApiServer.start();

    processorWeights = new Map<string, Map<string, bigint>>();
    processorWeights.set("2", new Map());
    processor = new EventsProcessor(
      dataSource,
      new EventProcessorRouter([
        new ProposalVoteDispatchedEventHandler(
          new StubVotingLedgerServiceLookup(processorWeights),
          createTestProposalApprovalMath(),
          {
            resolveTreasuryBalanceForLifecycle: async (lifecycleId) =>
              lifecycleId === 2 ? "20" : null,
          },
        ),
      ]),
      {
        processorName: "proposal-vote-processor-test",
        pollIntervalMs: 60_000,
        batchSize: 20,
      },
      new IndexerEventsApiClient({
        indexerApiUrl: `http://127.0.0.1:${port}`,
      }),
    );
  });

  afterEach(async () => {
    await processor.stop().catch(() => null);
    await eventsApiServer.stop().catch(() => null);
    await repository.close().catch(() => null);
  });

  it("applies weighted tallies, nullifies duplicate voters, and reverses orphaned votes", async () => {
    const proposalPublicKey = PrivateKey.random().toPublicKey().toBase58();
    const voterOnePublicKey = PrivateKey.random().toPublicKey().toBase58();
    const voterTwoPublicKey = PrivateKey.random().toPublicKey().toBase58();

    // Seed proposal projection so vote handler can resolve lifecycle for weight lookups.
    await dataSource.getRepository(ProposalEntity).insert({
      proposalPublicKey,
      lifecycleId: 2,
      amount: "500000000",
      recipient: "recipient-public-key",
      zkAppUriHash: "12345",
      stakingEpochDataLedgerHash: "999",
      stakingEpochDataLedgerTotalCurrency: "20",
      status: "pending",
      isPaused: false,
      createdAtBlockHeight: 100,
      createdAtBlockTimestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, 100)),
    });

    const weights = new Map<string, bigint>([
      [voterOnePublicKey, 11n],
      [voterTwoPublicKey, 7n],
    ]);
    processorWeights.set("2", weights);

    const voteOne = buildVoteEventOutput({
      proposalPublicKey,
      voterPublicKey: voterOnePublicKey,
      vote: "yay",
      txHash: "tx-vote-1",
      accountUpdateId: "2",
      blockHeight: 101,
    });
    const voteDuplicate = buildVoteEventOutput({
      proposalPublicKey,
      voterPublicKey: voterOnePublicKey,
      vote: "nay",
      txHash: "tx-vote-2",
      accountUpdateId: "3",
      blockHeight: 102,
    });
    const voteTwo = buildVoteEventOutput({
      proposalPublicKey,
      voterPublicKey: voterTwoPublicKey,
      vote: "abstain",
      txHash: "tx-vote-3",
      accountUpdateId: "4",
      blockHeight: 103,
    });

    await repository.insertRawEvents([voteOne], "canonical");
    await repository.insertRawEvents([voteDuplicate], "canonical");
    await repository.insertRawEvents([voteTwo], "canonical");

    assert.equal(await processor.processOnce(), 3);

    const tallyRows = await dataSource.getRepository(VoteTallyEntity).findBy({
      proposalPublicKey,
    });
    assert.equal(tallyRows.length, 3);
    const latestTally = tallyRows.find((row) => row.blockHeight === 103);
    assert.ok(latestTally);
    assert.equal(latestTally.yayWeight, "11");
    assert.equal(latestTally.nayWeight, "0");
    assert.equal(latestTally.abstainWeight, "7");
    assert.equal(latestTally.totalParticipatingVotes, "18");
    assert.equal(latestTally.approvalBp, "10000");
    assert.equal(latestTally.voteResult, "approved");
    assert.equal(latestTally.createdByEventType, "proposalVoteDispatched");

    const duplicateVoteRow = await dataSource
      .getRepository(VoteEntity)
      .findOneBy({
        proposalPublicKey,
        voterPublicKey: voterOnePublicKey,
        vote: "nay",
      });
    assert.equal(duplicateVoteRow?.isNullified, true);

    const nullifiers = await dataSource
      .getRepository(VoteNullifierEntity)
      .findBy({
        proposalPublicKey,
      });
    assert.equal(nullifiers.length, 2);

    await dataSource
      .getRepository(ArchiveEventEntity)
      .update(
        { txHash: "tx-vote-1", accountUpdateId: "2" },
        { status: "orphaned", changeSequence: "4" },
      );
    assert.equal(await processor.processOnce(), 1);

    const voterOneNullifier = await dataSource
      .getRepository(VoteNullifierEntity)
      .findBy({
        proposalPublicKey,
        voterPublicKey: voterOnePublicKey,
      });
    assert.equal(voterOneNullifier.length, 1);

    const tallyAfterOrphan = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneBy({
        proposalPublicKey,
        blockHeight: 103,
      });
    assert.ok(tallyAfterOrphan);
    assert.equal(tallyAfterOrphan?.yayWeight, "0");
    assert.equal(tallyAfterOrphan?.nayWeight, "11");
    assert.equal(tallyAfterOrphan?.abstainWeight, "7");
    assert.equal(tallyAfterOrphan?.totalParticipatingVotes, "18");
    assert.equal(tallyAfterOrphan?.approvalBp, "0");
    assert.equal(tallyAfterOrphan?.voteResult, "rejected");

    const voteDuplicateEvent = await dataSource
      .getRepository(ArchiveEventEntity)
      .findOneBy({
        txHash: "tx-vote-2",
        accountUpdateId: "3",
      });
    assert.ok(voteDuplicateEvent);
    const promotedDuplicate = await dataSource
      .getRepository(VoteEntity)
      .findOneBy({ archiveEventId: voteDuplicateEvent!.id });
    assert.equal(promotedDuplicate?.isNullified, false);
    const promotedNullifier = await dataSource
      .getRepository(VoteNullifierEntity)
      .findOneBy({
        proposalPublicKey,
        voterPublicKey: voterOnePublicKey,
      });
    assert.equal(
      promotedNullifier?.sourceEventId,
      String(voteDuplicateEvent!.id),
    );

    const voteOneEvent = await dataSource
      .getRepository(ArchiveEventEntity)
      .findOneBy({
        txHash: "tx-vote-1",
        accountUpdateId: "2",
      });
    assert.ok(voteOneEvent);
    const voteOneProjection = await dataSource
      .getRepository(VoteEntity)
      .findOneBy({
        archiveEventId: voteOneEvent!.id,
      });
    assert.equal(voteOneProjection, null);
    const voteOneFact = await dataSource
      .getRepository(ProposalEventFactEntity)
      .findOneBy({ archiveEventId: voteOneEvent!.id });
    assert.equal(voteOneFact?.status, "orphaned");

    await dataSource
      .getRepository(ArchiveEventEntity)
      .update(
        { txHash: "tx-vote-1", accountUpdateId: "2" },
        { status: "canonical", changeSequence: "5" },
      );
    assert.equal(await processor.processOnce(), 1);
    const duplicateAfterRecanonicalization = await dataSource
      .getRepository(VoteEntity)
      .findOneBy({ archiveEventId: voteDuplicateEvent!.id });
    assert.equal(duplicateAfterRecanonicalization?.isNullified, true);
  });

  it("retains and replays a vote that arrives before its proposal", async () => {
    const proposalPublicKey = PrivateKey.random().toPublicKey().toBase58();
    const voterPublicKey = PrivateKey.random().toPublicKey().toBase58();
    processorWeights.set("2", new Map([[voterPublicKey, 13n]]));
    await repository.insertRawEvents(
      [
        buildVoteEventOutput({
          proposalPublicKey,
          voterPublicKey,
          vote: "yay",
          txHash: "tx-vote-child-first",
          accountUpdateId: "30",
          blockHeight: 101,
        }),
      ],
      "canonical",
    );

    assert.equal(await processor.processOnce(), 1);
    assert.equal(
      await dataSource.getRepository(VoteEntity).countBy({ proposalPublicKey }),
      0,
    );
    assert.equal(
      await dataSource
        .getRepository(ProposalEventFactEntity)
        .countBy({ proposalPublicKey }),
      1,
    );

    const createHandler = new ProposalCreatedEventHandler({
      resolveTreasuryBalanceForLifecycle: async () => "20",
      deriveAcceptanceCriteria: async () => ({
        requiredParticipationBp: "2000",
        requiredApprovalBp: "5100",
        requiredParticipation: "4",
      }),
    });
    await dataSource.transaction(
      async (manager) =>
        await createHandler.tryHandle(
          buildProposalCreatedEventEntity(proposalPublicKey),
          manager,
        ),
    );

    const replayedVote = await dataSource.getRepository(VoteEntity).findOneBy({
      proposalPublicKey,
      voterPublicKey,
    });
    assert.equal(replayedVote?.voteWeight, "13");
    assert.equal(replayedVote?.isNullified, false);
  });

  it("applies the contract vote rules when proposal and staking amounts are zero", async () => {
    const proposalPublicKey = PrivateKey.random().toPublicKey().toBase58();
    const voterPublicKey = PrivateKey.random().toPublicKey().toBase58();
    await dataSource.getRepository(ProposalEntity).insert({
      proposalPublicKey,
      lifecycleId: 2,
      amount: "0",
      recipient: "recipient-public-key",
      zkAppUriHash: "12345",
      stakingEpochDataLedgerHash: "999",
      stakingEpochDataLedgerTotalCurrency: "0",
      requiredParticipationBp: "2000",
      requiredApprovalBp: "5100",
      requiredParticipation: "0",
      status: "pending",
      isPaused: false,
      createdAtBlockHeight: 100,
      createdAtBlockTimestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, 100)),
    });
    processorWeights.set("2", new Map([[voterPublicKey, 1n]]));

    await repository.insertRawEvents(
      [
        buildVoteEventOutput({
          proposalPublicKey,
          voterPublicKey,
          vote: "yay",
          txHash: "tx-zero-value-vote",
          accountUpdateId: "31",
          blockHeight: 102,
        }),
      ],
      "canonical",
    );

    assert.equal(await processor.processOnce(), 1);
    const tally = await dataSource.getRepository(VoteTallyEntity).findOneBy({
      proposalPublicKey,
      blockHeight: 102,
    });
    assert.ok(tally);
    assert.equal(tally.totalParticipatingVotes, "1");
    assert.equal(tally.approvalBp, "10000");
    assert.equal(tally.voteResult, "approved");
  });

  it("keeps dispatched tallies cumulative across blocks", async () => {
    const proposalPublicKey = PrivateKey.random().toPublicKey().toBase58();
    const voterYayOnePublicKey = PrivateKey.random().toPublicKey().toBase58();
    const voterYayTwoPublicKey = PrivateKey.random().toPublicKey().toBase58();
    const voterNayPublicKey = PrivateKey.random().toPublicKey().toBase58();

    await dataSource.getRepository(ProposalEntity).insert({
      proposalPublicKey,
      lifecycleId: 2,
      amount: "500000000",
      recipient: "recipient-public-key",
      zkAppUriHash: "12345",
      stakingEpochDataLedgerHash: "999",
      stakingEpochDataLedgerTotalCurrency: "3117",
      status: "pending",
      isPaused: false,
      createdAtBlockHeight: 100,
      createdAtBlockTimestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, 100)),
    });

    processorWeights.set(
      "2",
      new Map<string, bigint>([
        [voterYayOnePublicKey, 137n],
        [voterYayTwoPublicKey, 284n],
        [voterNayPublicKey, 421n],
      ]),
    );

    const voteYayOne = buildVoteEventOutput({
      proposalPublicKey,
      voterPublicKey: voterYayOnePublicKey,
      vote: "yay",
      txHash: "tx-cumulative-vote-1",
      accountUpdateId: "20",
      blockHeight: 106,
    });
    const voteYayTwo = buildVoteEventOutput({
      proposalPublicKey,
      voterPublicKey: voterYayTwoPublicKey,
      vote: "yay",
      txHash: "tx-cumulative-vote-2",
      accountUpdateId: "21",
      blockHeight: 108,
    });
    const voteNay = buildVoteEventOutput({
      proposalPublicKey,
      voterPublicKey: voterNayPublicKey,
      vote: "nay",
      txHash: "tx-cumulative-vote-3",
      accountUpdateId: "22",
      blockHeight: 110,
    });

    await repository.insertRawEvents([voteYayOne], "canonical");
    await repository.insertRawEvents([voteYayTwo], "canonical");
    await repository.insertRawEvents([voteNay], "canonical");
    assert.equal(await processor.processOnce(), 3);

    const tallies = await dataSource.getRepository(VoteTallyEntity).findBy({
      proposalPublicKey,
    });
    const sortedTallies = tallies.sort((a, b) => a.blockHeight - b.blockHeight);
    assert.deepEqual(
      sortedTallies.map((row) => ({
        blockHeight: row.blockHeight,
        yayWeight: row.yayWeight,
        nayWeight: row.nayWeight,
        abstainWeight: row.abstainWeight,
      })),
      [
        {
          blockHeight: 106,
          yayWeight: "137",
          nayWeight: "0",
          abstainWeight: "0",
        },
        {
          blockHeight: 108,
          yayWeight: "421",
          nayWeight: "0",
          abstainWeight: "0",
        },
        {
          blockHeight: 110,
          yayWeight: "421",
          nayWeight: "421",
          abstainWeight: "0",
        },
      ],
    );
  });

  it("decodes field-encoded vote events from on-chain payloads", async () => {
    const proposalPublicKey = PrivateKey.random().toPublicKey().toBase58();
    const voterPublicKey = PrivateKey.random().toPublicKey().toBase58();

    await dataSource.getRepository(ProposalEntity).insert({
      proposalPublicKey,
      lifecycleId: 2,
      amount: "500000000",
      recipient: PrivateKey.random().toPublicKey().toBase58(),
      zkAppUriHash: "12345",
      stakingEpochDataLedgerHash: "999",
      stakingEpochDataLedgerTotalCurrency: "20",
      status: "pending",
      isPaused: false,
      createdAtBlockHeight: 100,
      createdAtBlockTimestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, 100)),
    });
    processorWeights.set("2", new Map([[voterPublicKey, 11n]]));

    await repository.insertRawEvents(
      [
        buildFieldEncodedVoteEventOutput({
          proposalPublicKey,
          voterPublicKey,
          vote: Vote.YAY,
          txHash: "tx-field-vote-1",
          accountUpdateId: "10",
          blockHeight: 102,
        }),
      ],
      "canonical",
    );

    assert.equal(await processor.processOnce(), 1);

    const votes = await dataSource.getRepository(VoteEntity).findBy({
      proposalPublicKey,
    });
    assert.equal(votes.length, 1);
    assert.equal(votes[0]?.voterPublicKey, voterPublicKey);
    assert.equal(votes[0]?.vote, "yay");
    assert.equal(votes[0]?.voteWeight, "11");
  });

  it("rejects compatibility vote payloads with invalid contract public keys", async () => {
    const proposalPublicKey = PrivateKey.random().toPublicKey().toBase58();
    const invalidEvent = buildProposalCreatedEventEntity(proposalPublicKey);
    invalidEvent.eventType = PROPOSAL_VOTE_DISPATCHED_EVENT_NAME;
    invalidEvent.rawEventData = {
      proposalPublicKey,
      voterPublicKey: "not-a-public-key",
      vote: "yay",
      senderPublicKey: ARCHIVE_SENDER_PUBLIC_KEY,
    } as never;
    const handler = new ProposalVoteDispatchedEventHandler(
      new StubVotingLedgerServiceLookup(),
      createTestProposalApprovalMath(),
      { resolveTreasuryBalanceForLifecycle: async () => "20" },
    );

    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(invalidEvent, manager),
      ),
      false,
    );
    assert.equal(
      await dataSource.getRepository(ProposalEventFactEntity).count(),
      0,
    );
  });

  it("rejects a field-encoded vote outside the contract enum", async () => {
    const proposalPublicKey = PrivateKey.random().toPublicKey().toBase58();
    const voterPublicKey = PrivateKey.random().toPublicKey().toBase58();
    const raw = buildFieldEncodedVoteEventOutput({
      proposalPublicKey,
      voterPublicKey,
      vote: Vote.YAY,
      txHash: "tx-invalid-field-vote",
      accountUpdateId: "31",
      blockHeight: 102,
    });
    const invalidEvent = buildProposalCreatedEventEntity(proposalPublicKey);
    invalidEvent.id = "invalid-field-vote";
    invalidEvent.eventType = PROPOSAL_VOTE_DISPATCHED_EVENT_NAME;
    invalidEvent.rawEventData = raw.eventData[0] as never;
    (invalidEvent.rawEventData as { data: string[] }).data[5] = "4";
    const handler = new ProposalVoteDispatchedEventHandler(
      new StubVotingLedgerServiceLookup(),
      createTestProposalApprovalMath(),
      { resolveTreasuryBalanceForLifecycle: async () => "20" },
    );

    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(invalidEvent, manager),
      ),
      false,
    );
    assert.equal(
      await dataSource.getRepository(ProposalEventFactEntity).count(),
      0,
    );
  });
});
