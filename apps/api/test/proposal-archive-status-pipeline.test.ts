import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  type ArchiveEventData,
  ArchiveEventEntity,
  type ArchiveEventOutput,
  EventsRepository,
} from "@repo/indexer";
import {
  EventProcessorRouter,
  EventsProcessor,
  type IndexerEventsSource,
} from "@repo/processor";
import {
  ProposalCreatedEvent,
  ProposalVoteDispatchedEvent,
  PROPOSAL_CREATED_EVENT_NAME,
  PROPOSAL_EXECUTED_EVENT_NAME,
  PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
  PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
  PROPOSAL_VOTES_TALLIED_EVENT_NAME,
} from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import { Vote } from "@repo/sdk/src/provable/contracts/treasury-proposal/vote-reducer.js";
import { Field, PrivateKey, PublicKey, UInt32, UInt64 } from "o1js";
import type { DataSource } from "typeorm";
import { ProposalCreatedEventHandler } from "../src/processors/proposals/proposal-created-event-handler.js";
import { ProposalEntity } from "../src/processors/proposals/proposal-entity.js";
import { ProposalProjectionReconciler } from "../src/processors/proposals/proposal-projection-reconciler.js";
import { ProposalVoteDispatchedEventHandler } from "../src/processors/proposals/proposal-vote-dispatched-event-handler.js";
import { proposalProcessorOutputEntities } from "../src/processors/proposals/processor-output-entities.js";
import type {
  VotingLedgerService,
  VotingLedgerServiceLookup,
} from "../src/processors/proposals/lifecycle-voting-ledger-service-registry.js";
import { VoteEntity } from "../src/processors/proposals/vote-entity.js";
import { VoteTallyEntity } from "../src/processors/proposals/vote-tally-entity.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";

type KnownEventType =
  | typeof PROPOSAL_CREATED_EVENT_NAME
  | typeof PROPOSAL_EXECUTED_EVENT_NAME
  | typeof PROPOSAL_PAUSE_TOGGLED_EVENT_NAME
  | typeof PROPOSAL_VOTE_DISPATCHED_EVENT_NAME
  | typeof PROPOSAL_VOTES_TALLIED_EVENT_NAME;

const EVENT_TYPES: KnownEventType[] = [
  PROPOSAL_CREATED_EVENT_NAME,
  PROPOSAL_EXECUTED_EVENT_NAME,
  PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
  PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
  PROPOSAL_VOTES_TALLIED_EVENT_NAME,
].sort();

interface StatusFixture {
  proposalEvent: ArchiveEventOutput;
  voteEvent: ArchiveEventOutput;
  proposalPublicKey: string;
  voterPublicKey: string;
  voteBlockHeight: number;
}

class FixedVotingLedgerService implements VotingLedgerService {
  public async start(): Promise<void> {}

  public async getVoteWeight(): Promise<bigint> {
    return 9n;
  }

  public async close(): Promise<void> {}
}

class FixedVotingLedgerServiceLookup implements VotingLedgerServiceLookup {
  private readonly service = new FixedVotingLedgerService();

  public async getService(): Promise<VotingLedgerService> {
    return this.service;
  }
}

function publicKey(seed: bigint): PublicKey {
  return PrivateKey.fromBigInt(seed).toPublicKey();
}

function eventTypeIndex(eventType: KnownEventType): string {
  const index = EVENT_TYPES.indexOf(eventType);
  assert.notEqual(index, -1);
  return String(index);
}

function archiveEvent(
  eventType: KnownEventType,
  fields: string[],
  txHash: string,
  accountUpdateId: string,
  blockHeight: number,
  stateHash: string,
  parentHash: string,
): ArchiveEventOutput {
  const eventData: ArchiveEventData = {
    accountUpdateId,
    data: [eventTypeIndex(eventType), ...fields],
    transactionInfo: {
      hash: txHash,
      zkappAccountUpdateIds: [Number(accountUpdateId)],
    },
  };
  return {
    blockInfo: {
      height: blockHeight,
      timestamp: new Date(
        Date.UTC(2026, 0, 1, 0, 0, blockHeight),
      ).toISOString(),
      globalSlotSinceGenesis: blockHeight,
      stateHash,
      parentHash,
    },
    eventData: [eventData],
  };
}

function buildStatusFixture(input: {
  name: string;
  baseHeight: number;
  accountUpdateId: number;
  proposalSeed: bigint;
  recipientSeed: bigint;
  senderSeed: bigint;
  voterSeed: bigint;
}): StatusFixture {
  const proposal = publicKey(input.proposalSeed);
  const recipient = publicKey(input.recipientSeed);
  const sender = publicKey(input.senderSeed);
  const voter = publicKey(input.voterSeed);
  const proposalStateHash = `state-${input.name}-proposal`;
  const voteStateHash = `state-${input.name}-vote`;

  const proposalEvent = archiveEvent(
    PROPOSAL_CREATED_EVENT_NAME,
    ProposalCreatedEvent.toFields(
      new ProposalCreatedEvent({
        proposalPublicKey: proposal,
        lifecycleId: UInt32.from(2),
        amount: UInt64.from(500_000_000),
        recipient,
        zkAppUriHash: Field(123_456),
        stakingEpochDataLedgerHash: Field(999),
        stakingEpochDataLedgerTotalCurrency: UInt64.from(20),
        proposerPublicKey: sender,
        senderPublicKey: sender,
      }),
    ).map((field) => field.toString()),
    `tx-${input.name}-proposal`,
    String(input.accountUpdateId),
    input.baseHeight,
    proposalStateHash,
    `state-${input.name}-parent`,
  );
  const voteEvent = archiveEvent(
    PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
    ProposalVoteDispatchedEvent.toFields(
      new ProposalVoteDispatchedEvent({
        proposalPublicKey: proposal,
        voterPublicKey: voter,
        vote: Vote.YAY,
        senderPublicKey: sender,
      }),
    ).map((field) => field.toString()),
    `tx-${input.name}-vote`,
    String(input.accountUpdateId + 1),
    input.baseHeight + 1,
    voteStateHash,
    proposalStateHash,
  );

  return {
    proposalEvent,
    voteEvent,
    proposalPublicKey: proposal.toBase58(),
    voterPublicKey: voter.toBase58(),
    voteBlockHeight: input.baseHeight + 1,
  };
}

function repositoryEventSource(
  repository: EventsRepository,
): IndexerEventsSource {
  return {
    async fetchEventsPage({ handledEventTypes, changeSequenceAfter, limit }) {
      const items = await repository.getEventsPage({
        eventTypes: handledEventTypes,
        includeUnknown: false,
        changeSequenceAfter,
        limit,
      });
      const lastItem = items.at(-1);
      return {
        items,
        nextCursor: lastItem
          ? { changeSequenceAfter: lastItem.changeSequence }
          : null,
      };
    },
  };
}

async function advancePgMemChangeSequence(
  dataSource: DataSource,
  events: ArchiveEventOutput[],
): Promise<void> {
  // Production PostgreSQL uses the archive event update trigger. pg-mem does
  // not run that trigger, so this helper applies its sequence side effect.
  for (const event of events) {
    const txHash = event.eventData?.[0]?.transactionInfo?.hash;
    assert.ok(txHash);
    await dataSource.query(
      `UPDATE "archive_events"
       SET "change_sequence" = nextval('archive_event_change_sequence_seq')
       WHERE "tx_hash" = $1`,
      [txHash],
    );
  }
}

async function archiveStatuses(
  dataSource: DataSource,
  fixture: StatusFixture,
): Promise<
  Array<{ changeSequence: string; id: string; status: string; txHash: string }>
> {
  return await dataSource.getRepository(ArchiveEventEntity).find({
    select: { changeSequence: true, id: true, status: true, txHash: true },
    where: [
      { txHash: fixture.proposalEvent.eventData![0]!.transactionInfo!.hash! },
      { txHash: fixture.voteEvent.eventData![0]!.transactionInfo!.hash! },
    ],
    order: { txHash: "ASC" },
  });
}

describe("proposal Archive status pipeline", () => {
  let dataSource: DataSource;
  let repository: EventsRepository;
  let processor: EventsProcessor;

  beforeEach(async () => {
    dataSource = createInMemoryDataSource(
      "public",
      proposalProcessorOutputEntities,
    );
    repository = new EventsRepository(dataSource, "public", {
      knownEventTypes: EVENT_TYPES,
    });
    await repository.initialize();
    await dataSource.synchronize();

    const reconciler = new ProposalProjectionReconciler();
    processor = new EventsProcessor(
      dataSource,
      new EventProcessorRouter([
        new ProposalCreatedEventHandler(
          {
            resolveTreasuryBalanceForLifecycle: async () => "20",
            deriveAcceptanceCriteria: async () => ({
              requiredParticipationBp: "2000",
              requiredApprovalBp: "5100",
              requiredParticipation: "4",
            }),
          },
          reconciler,
        ),
        new ProposalVoteDispatchedEventHandler(
          new FixedVotingLedgerServiceLookup(),
          undefined,
          { resolveTreasuryBalanceForLifecycle: async () => "20" },
          reconciler,
        ),
      ]),
      {
        processorName: "proposal-archive-status-pipeline-test",
        pollIntervalMs: 60_000,
        batchSize: 20,
      },
      repositoryEventSource(repository),
    );
  });

  afterEach(async () => {
    await processor.stop().catch(() => undefined);
    await repository.close().catch(() => undefined);
  });

  async function assertActiveProjection(
    fixture: StatusFixture,
    status: "pending" | "canonical",
  ): Promise<void> {
    const proposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneBy({ proposalPublicKey: fixture.proposalPublicKey });
    assert.ok(proposal);
    assert.equal(proposal.status, status);
    assert.equal(proposal.creationObservationStatus, status);
    assert.equal(
      proposal.contractStatusFinality,
      status === "canonical" ? "canonical" : "pending",
    );

    const vote = await dataSource.getRepository(VoteEntity).findOneBy({
      proposalPublicKey: fixture.proposalPublicKey,
      voterPublicKey: fixture.voterPublicKey,
    });
    assert.ok(vote);
    assert.equal(vote.status, status);
    assert.equal(vote.vote, "yay");
    assert.equal(vote.voteWeight, "9");
    assert.equal(vote.blockHeight, fixture.voteBlockHeight);
    assert.equal(vote.isNullified, false);

    const tally = await dataSource.getRepository(VoteTallyEntity).findOneBy({
      proposalPublicKey: fixture.proposalPublicKey,
      blockHeight: fixture.voteBlockHeight,
    });
    assert.ok(tally);
    assert.equal(tally.sourceStatus, status);
    assert.equal(tally.yayWeight, "9");
  }

  it("moves pending proposal and vote observations to canonical projections", async () => {
    const fixture = buildStatusFixture({
      name: "promotion",
      baseHeight: 100,
      accountUpdateId: 10,
      proposalSeed: 101n,
      recipientSeed: 102n,
      senderSeed: 103n,
      voterSeed: 104n,
    });
    const events = [fixture.proposalEvent, fixture.voteEvent];

    assert.equal(await repository.insertRawEvents(events, "pending"), 2);
    assert.equal(await processor.processOnce(), 2);
    await assertActiveProjection(fixture, "pending");

    assert.equal(await repository.insertRawEvents(events, "canonical"), 2);
    await advancePgMemChangeSequence(dataSource, events);
    assert.equal(await processor.processOnce(), 2);
    await assertActiveProjection(fixture, "canonical");
    assert.deepEqual(
      (await archiveStatuses(dataSource, fixture)).map((event) => event.status),
      ["canonical", "canonical"],
    );
  });

  it("restores pending projections when immutable orphaned events reappear", async () => {
    const fixture = buildStatusFixture({
      name: "reappearance",
      baseHeight: 200,
      accountUpdateId: 20,
      proposalSeed: 201n,
      recipientSeed: 202n,
      senderSeed: 203n,
      voterSeed: 204n,
    });
    const events = [fixture.proposalEvent, fixture.voteEvent];

    assert.equal(await repository.insertRawEvents(events, "pending"), 2);
    assert.equal(await processor.processOnce(), 2);
    await assertActiveProjection(fixture, "pending");
    const firstPendingRows = await archiveStatuses(dataSource, fixture);

    assert.equal(await repository.markPendingAsOrphaned(201, 0), 2);
    await advancePgMemChangeSequence(dataSource, events);
    assert.equal(await processor.processOnce(), 2);
    assert.equal(
      await dataSource
        .getRepository(ProposalEntity)
        .countBy({ proposalPublicKey: fixture.proposalPublicKey }),
      0,
    );
    assert.equal(
      await dataSource
        .getRepository(VoteEntity)
        .countBy({ proposalPublicKey: fixture.proposalPublicKey }),
      0,
    );
    const orphanedRows = await archiveStatuses(dataSource, fixture);
    assert.deepEqual(
      orphanedRows.map((event) => event.status),
      ["orphaned", "orphaned"],
    );
    assert.deepEqual(
      orphanedRows.map((event) => event.id),
      firstPendingRows.map((event) => event.id),
    );

    assert.equal(await repository.insertRawEvents(events, "pending"), 2);
    await advancePgMemChangeSequence(dataSource, events);
    assert.equal(await processor.processOnce(), 2);
    await assertActiveProjection(fixture, "pending");
    assert.deepEqual(
      (await archiveStatuses(dataSource, fixture)).map((event) => event.id),
      firstPendingRows.map((event) => event.id),
    );
  });

  it("keeps canonical projections after later orphaned and pending observations", async () => {
    const fixture = buildStatusFixture({
      name: "sticky-canonical",
      baseHeight: 300,
      accountUpdateId: 30,
      proposalSeed: 301n,
      recipientSeed: 302n,
      senderSeed: 303n,
      voterSeed: 304n,
    });
    const events = [fixture.proposalEvent, fixture.voteEvent];

    assert.equal(await repository.insertRawEvents(events, "canonical"), 2);
    assert.equal(await processor.processOnce(), 2);
    await assertActiveProjection(fixture, "canonical");
    const canonicalRows = await archiveStatuses(dataSource, fixture);

    assert.equal(await repository.insertRawEvents(events, "orphaned"), 2);
    assert.equal(await processor.processOnce(), 0);
    assert.deepEqual(await archiveStatuses(dataSource, fixture), canonicalRows);
    await assertActiveProjection(fixture, "canonical");

    assert.equal(await repository.insertRawEvents(events, "pending"), 2);
    assert.equal(await processor.processOnce(), 0);
    assert.deepEqual(await archiveStatuses(dataSource, fixture), canonicalRows);
    await assertActiveProjection(fixture, "canonical");
  });
});
