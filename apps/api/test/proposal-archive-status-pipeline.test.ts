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
  ProcessorEventFailureEntity,
  ProcessorOffsetEntity,
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
import { ProposalProjectionReplayEntity } from "../src/processors/proposals/proposal-projection-replay-entity.js";
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
      const rows = await repository.getEventsPage({
        eventTypes: handledEventTypes,
        includeUnknown: false,
        changeSequenceAfter,
        limit,
      });
      // Match the HTTP source: pg-mem returns generated bigint IDs as numbers.
      const items = rows.map((event) =>
        Object.assign(event, { id: String(event.id) }),
      );
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
  let ledgerUnavailable = false;

  beforeEach(async () => {
    ledgerUnavailable = false;
    dataSource = createInMemoryDataSource(
      "public",
      proposalProcessorOutputEntities,
    );
    repository = new EventsRepository(dataSource, "public", {
      knownEventTypes: EVENT_TYPES,
    });
    await repository.initialize();
    await dataSource.synchronize();

    const reconciler = new ProposalProjectionReconciler(
      "proposal-archive-status-pipeline-test",
    );
    processor = new EventsProcessor(
      dataSource,
      new EventProcessorRouter([
        new ProposalCreatedEventHandler(
          {
            resolveTreasuryBalanceForLifecycle: async () => {
              if (ledgerUnavailable)
                throw new Error("Ledger temporarily unavailable");
              return "20";
            },
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
        maxAttempts: 2,
        retryBaseDelayMs: 0,
      },
      repositoryEventSource(repository),
      undefined,
      async ({ manager, processorName }) => {
        const offset = await manager
          .getRepository(ProcessorOffsetEntity)
          .findOneBy({ processorName });
        await reconciler.finishReplay(
          manager,
          offset?.lastSeenChangeSequence ?? "0",
        );
      },
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

  it("keeps one projection effect when Archive account-update IDs change", async () => {
    const fixture = buildStatusFixture({
      name: "renumbered",
      baseHeight: 100,
      accountUpdateId: 10,
      proposalSeed: 101n,
      recipientSeed: 102n,
      senderSeed: 103n,
      voterSeed: 104n,
    });
    const events = [fixture.proposalEvent, fixture.voteEvent];
    await repository.insertRawEvents(events, "pending");
    assert.equal(await processor.processOnce(), 2);
    const rebuilt = structuredClone(events);
    for (const event of rebuilt)
      for (const update of event.eventData!) {
        update.accountUpdateId = String(Number(update.accountUpdateId) + 10000);
        update.transactionInfo!.zkappAccountUpdateIds =
          update.transactionInfo!.zkappAccountUpdateIds!.map(
            (id) => id + 10000,
          );
      }
    await repository.insertRawEvents(rebuilt, "canonical");
    await advancePgMemChangeSequence(dataSource, rebuilt);
    assert.equal(await processor.processOnce(), 2);
    assert.equal(await dataSource.getRepository(ArchiveEventEntity).count(), 2);
    assert.equal(await dataSource.getRepository(ProposalEntity).count(), 1);
    assert.equal(await dataSource.getRepository(VoteEntity).count(), 1);
    assert.equal(await processor.processOnce(), 0);
  });

  it("retries temporary ledger failures without quarantining valid events", async () => {
    const fixture = buildStatusFixture({
      name: "retry",
      baseHeight: 100,
      accountUpdateId: 10,
      proposalSeed: 101n,
      recipientSeed: 102n,
      senderSeed: 103n,
      voterSeed: 104n,
    });
    await repository.insertRawEvents([fixture.proposalEvent], "pending");
    ledgerUnavailable = true;
    assert.equal(await processor.processOnce(), 0);
    const failure = await dataSource
      .getRepository(ProcessorEventFailureEntity)
      .findOneByOrFail({ state: "retrying" });
    assert.equal(failure.errorCode, "EVENT_HANDLER_FAILED");
    assert.equal(
      await dataSource.getRepository(ProcessorOffsetEntity).count(),
      0,
    );
    ledgerUnavailable = false;
    assert.equal(await processor.processOnce(), 1);
    assert.equal(await dataSource.getRepository(ProposalEntity).count(), 1);
  });

  it("quarantines malformed fields without stopping unrelated Proposal events", async () => {
    const bad = buildStatusFixture({
      name: "bad",
      baseHeight: 100,
      accountUpdateId: 10,
      proposalSeed: 101n,
      recipientSeed: 102n,
      senderSeed: 103n,
      voterSeed: 104n,
    });
    const later = buildStatusFixture({
      name: "later",
      baseHeight: 102,
      accountUpdateId: 12,
      proposalSeed: 105n,
      recipientSeed: 106n,
      senderSeed: 107n,
      voterSeed: 108n,
    });
    bad.proposalEvent.eventData![0].data!.splice(2);
    await repository.insertRawEvents(
      [bad.proposalEvent, later.proposalEvent, later.voteEvent],
      "pending",
    );
    await dataSource.getRepository(ProposalProjectionReplayEntity).insert({
      projectionName: "proposal",
      targetChangeSequence: "3",
      state: "collecting",
      completedAt: null,
    });
    assert.equal(await processor.processOnce(), 2);
    await assertActiveProjection(later, "pending");
    const failure = await dataSource
      .getRepository(ProcessorEventFailureEntity)
      .findOneByOrFail({ state: "quarantined" });
    assert.equal(failure.errorCode, "EVENT_NOT_HANDLED");
    assert.deepEqual(
      (failure.eventSnapshot.rawEventData as { data: string[] }).data,
      bad.proposalEvent.eventData![0].data,
    );
    assert.equal(
      await dataSource
        .getRepository(ProposalEntity)
        .countBy({ proposalPublicKey: bad.proposalPublicKey }),
      0,
    );
  });

  it("finishes replay after a quarantined tail without a later valid event", async () => {
    const valid = buildStatusFixture({
      name: "valid-tail",
      baseHeight: 100,
      accountUpdateId: 10,
      proposalSeed: 101n,
      recipientSeed: 102n,
      senderSeed: 103n,
      voterSeed: 104n,
    });
    const bad = buildStatusFixture({
      name: "bad-tail",
      baseHeight: 102,
      accountUpdateId: 12,
      proposalSeed: 105n,
      recipientSeed: 106n,
      senderSeed: 107n,
      voterSeed: 108n,
    });
    bad.proposalEvent.eventData![0].data!.splice(2);
    await repository.insertRawEvents(
      [valid.proposalEvent, bad.proposalEvent],
      "canonical",
    );
    await dataSource.getRepository(ProposalProjectionReplayEntity).insert({
      projectionName: "proposal",
      targetChangeSequence: "2",
      state: "collecting",
      completedAt: null,
    });

    assert.equal(await processor.processOnce(), 1);
    const replay = await dataSource
      .getRepository(ProposalProjectionReplayEntity)
      .findOneByOrFail({ projectionName: "proposal" });
    assert.equal(replay.state, "complete");
    assert.ok(replay.completedAt);
    assert.equal(
      await dataSource
        .getRepository(ProposalEntity)
        .countBy({ proposalPublicKey: valid.proposalPublicKey }),
      1,
    );
    assert.equal(
      await dataSource
        .getRepository(ProposalEntity)
        .countBy({ proposalPublicKey: bad.proposalPublicKey }),
      0,
    );
    const failure = await dataSource
      .getRepository(ProcessorEventFailureEntity)
      .findOneByOrFail({ state: "quarantined" });
    assert.equal(failure.changeSequence, "2");
    assert.equal(failure.errorCode, "EVENT_NOT_HANDLED");
    const offset = await dataSource
      .getRepository(ProcessorOffsetEntity)
      .findOneByOrFail({
        processorName: "proposal-archive-status-pipeline-test",
      });
    assert.equal(offset.lastSeenChangeSequence, "2");
    assert.equal(await processor.processOnce(), 0);
    assert.equal(
      await dataSource
        .getRepository(ProcessorEventFailureEntity)
        .countBy({ state: "quarantined" }),
      1,
    );
    assert.equal(await dataSource.getRepository(ProposalEntity).count(), 1);
  });

  it("processes shortened events and later proposals through status changes", async () => {
    let senderSeed = 1n;
    while (publicKey(senderSeed).isOdd.toBoolean()) senderSeed += 1n;
    const shortened = buildStatusFixture({
      name: "shortened",
      baseHeight: 100,
      accountUpdateId: 10,
      proposalSeed: 101n,
      recipientSeed: 102n,
      senderSeed,
      voterSeed: 104n,
    });
    const later = buildStatusFixture({
      name: "later",
      baseHeight: 102,
      accountUpdateId: 12,
      proposalSeed: 105n,
      recipientSeed: 106n,
      senderSeed: 107n,
      voterSeed: 108n,
    });
    for (const event of [shortened.proposalEvent, shortened.voteEvent]) {
      assert.equal(event.eventData![0].data!.pop(), "0");
    }
    const events = [
      shortened.proposalEvent,
      shortened.voteEvent,
      later.proposalEvent,
      later.voteEvent,
    ];
    assert.equal(await repository.insertRawEvents(events, "pending"), 4);
    assert.equal(await processor.processOnce(), 4);
    await assertActiveProjection(shortened, "pending");
    await assertActiveProjection(later, "pending");
    assert.equal(await processor.processOnce(), 0);
    assert.equal(
      await dataSource.getRepository(ProcessorEventFailureEntity).count(),
      0,
    );
    const last = (await archiveStatuses(dataSource, later)).find((row) =>
      row.txHash.endsWith("vote"),
    )!;
    const offset = await dataSource
      .getRepository(ProcessorOffsetEntity)
      .findOneByOrFail({
        processorName: "proposal-archive-status-pipeline-test",
      });
    assert.equal(offset.lastSeenChangeSequence, last.changeSequence);

    assert.equal(await repository.markPendingAsOrphaned(103, 0), 4);
    await advancePgMemChangeSequence(dataSource, events);
    assert.equal(await processor.processOnce(), 4);
    assert.equal(await dataSource.getRepository(ProposalEntity).count(), 0);
    assert.equal(await dataSource.getRepository(VoteEntity).count(), 0);

    assert.equal(await repository.insertRawEvents(events, "canonical"), 4);
    await advancePgMemChangeSequence(dataSource, events);
    assert.equal(await processor.processOnce(), 4);
    await assertActiveProjection(shortened, "canonical");
    await assertActiveProjection(later, "canonical");
    assert.equal(
      await dataSource.getRepository(ProcessorEventFailureEntity).count(),
      0,
    );
    const stored = await dataSource
      .getRepository(ArchiveEventEntity)
      .findOneByOrFail({
        txHash: "tx-shortened-vote",
      });
    assert.deepEqual(
      stored.rawEventData.data,
      shortened.voteEvent.eventData![0].data,
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
