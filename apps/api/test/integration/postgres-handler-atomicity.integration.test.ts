import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  ArchiveEventEntity,
  ArchiveEventRejectionEntity,
  IndexerCursorEntity,
  IndexerRuntimeStatusEntity,
} from "@repo/indexer";
import {
  ProcessorEventFailureEntity,
  ProcessorOffsetEntity,
  ProcessorRuntimeStatusEntity,
} from "@repo/processor";
import {
  PROPOSAL_EXECUTED_EVENT_NAME,
  PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
} from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import { PrivateKey } from "o1js";
import { DataSource } from "typeorm";
import { ensureDatabaseSchema } from "../../src/db/ensure-database-schema.js";
import { ConfigureProcessorSchema1775649313439 } from "../../src/db/migrations/1775649313439-configure-processor-schema.js";
import { InitializeProcessorSchema1775649313440 } from "../../src/db/migrations/1775649313440-initialize-processor-schema.js";
import { BackendPipelineHardening1788447600000 } from "../../src/db/migrations/1788447600000-backend-pipeline-hardening.js";
import { ProposalContractProjection1788451200000 } from "../../src/db/migrations/1788451200000-proposal-contract-projection.js";
import { proposalProcessorOutputEntities } from "../../src/processors/proposals/processor-output-entities.js";
import { ProposalEntity } from "../../src/processors/proposals/proposal-entity.js";
import { ProposalEventFactEntity } from "../../src/processors/proposals/proposal-event-fact-entity.js";
import { ProposalExecutedEventHandler } from "../../src/processors/proposals/proposal-executed-event-handler.js";
import { ProposalExecutionEntity } from "../../src/processors/proposals/proposal-execution-entity.js";
import { ProposalProjectionReconciler } from "../../src/processors/proposals/proposal-projection-reconciler.js";
import { ProposalVoteDispatchedEventHandler } from "../../src/processors/proposals/proposal-vote-dispatched-event-handler.js";
import { VoteEntity } from "../../src/processors/proposals/vote-entity.js";
import { VoteNullifierEntity } from "../../src/processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../../src/processors/proposals/vote-tally-entity.js";

const databaseTestUrl = process.env.DATABASE_TEST_URL;
const MAX_UINT64 = 18_446_744_073_709_551_615n;

function postgresDataSource(databaseUrl: string, schema: string): DataSource {
  return new DataSource({
    type: "postgres",
    url: databaseUrl,
    schema,
    synchronize: false,
    entities: [
      ArchiveEventEntity,
      ArchiveEventRejectionEntity,
      IndexerCursorEntity,
      IndexerRuntimeStatusEntity,
      ProcessorOffsetEntity,
      ProcessorEventFailureEntity,
      ProcessorRuntimeStatusEntity,
      ...proposalProcessorOutputEntities,
    ],
    migrations: [
      ConfigureProcessorSchema1775649313439,
      InitializeProcessorSchema1775649313440,
      BackendPipelineHardening1788447600000,
      ProposalContractProjection1788451200000,
    ],
    migrationsTableName: "typeorm_migrations",
  });
}

async function withPostgresDataSource(
  run: (dataSource: DataSource) => Promise<void>,
): Promise<void> {
  assert.ok(databaseTestUrl);
  const schema = `backend_atomicity_${randomUUID().replaceAll("-", "")}`;
  const admin = new DataSource({ type: "postgres", url: databaseTestUrl });
  let dataSource: DataSource | null = null;

  try {
    await admin.initialize();
    await ensureDatabaseSchema(databaseTestUrl, schema);
    dataSource = postgresDataSource(databaseTestUrl, schema);
    await dataSource.initialize();
    await dataSource.runMigrations();
    await run(dataSource);
  } finally {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
    if (admin.isInitialized) {
      try {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await admin.destroy();
      }
    }
  }
}

function event(input: {
  id: string;
  changeSequence: string;
  eventType: string;
  blockHeight: number;
  rawEventData: Record<string, unknown>;
}): ArchiveEventEntity {
  const timestamp = new Date(
    Date.UTC(2026, 8, 4, 0, 0, input.blockHeight % 60),
  );
  return Object.assign(new ArchiveEventEntity(), {
    id: input.id,
    changeSequence: input.changeSequence,
    status: "canonical",
    pendingSeenAtHeight: null,
    blockHeight: input.blockHeight,
    blockTimestamp: timestamp,
    globalSlotSinceGenesis: input.blockHeight,
    stateHash: `state-${input.blockHeight}`,
    parentHash: `state-${input.blockHeight - 1}`,
    chainStatus: "canonical",
    eventType: input.eventType,
    txHash: `tx-${input.id}`,
    accountUpdateId: input.id,
    accountUpdateIndex: 0,
    eventIndex: 0,
    blockEventIndex: 0,
    rawEventData: input.rawEventData,
    indexedAt: timestamp,
    updatedAt: timestamp,
  }) as ArchiveEventEntity;
}

async function insertProposal(
  dataSource: DataSource,
  proposalPublicKey: string,
): Promise<void> {
  await dataSource.getRepository(ProposalEntity).insert({
    proposalPublicKey,
    lifecycleId: 1,
    amount: "100",
    recipient: PrivateKey.fromBigInt(2n).toPublicKey().toBase58(),
    senderPublicKey: PrivateKey.fromBigInt(3n).toPublicKey().toBase58(),
    zkAppUriHash: "123",
    stakingEpochDataLedgerHash: "456",
    stakingEpochDataLedgerTotalCurrency: "100",
    requiredParticipationBp: "0",
    requiredApprovalBp: "0",
    requiredParticipation: "0",
    status: "canonical",
    contractStatus: "unknown",
    contractStatusFinality: "canonical",
    contractStatusSourceEventId: null,
    contractStatusBlockHeight: 1,
    creationObservationStatus: "canonical",
    isPaused: false,
    paidOutAmount: "0",
    contents: null,
    createdAtBlockHeight: 1,
    createdAtBlockTimestamp: new Date("2026-09-04T00:00:01.000Z"),
  });
}

async function readVoteState(
  dataSource: DataSource,
  proposalPublicKey: string,
): Promise<Record<string, unknown>> {
  const [facts, votes, nullifiers, tallies, proposal] = await Promise.all([
    dataSource.getRepository(ProposalEventFactEntity).find({
      where: { proposalPublicKey },
      order: { changeSequence: "ASC" },
    }),
    dataSource.getRepository(VoteEntity).find({
      where: { proposalPublicKey },
      order: { archiveEventId: "ASC" },
    }),
    dataSource.getRepository(VoteNullifierEntity).find({
      where: { proposalPublicKey },
      order: { sourceEventId: "ASC" },
    }),
    dataSource.getRepository(VoteTallyEntity).find({
      where: { proposalPublicKey },
      order: { blockHeight: "ASC" },
    }),
    dataSource
      .getRepository(ProposalEntity)
      .findOneByOrFail({ proposalPublicKey }),
  ]);

  return {
    facts: facts.map((fact) => ({
      archiveEventId: fact.archiveEventId,
      changeSequence: fact.changeSequence,
      eventType: fact.eventType,
      status: fact.status,
    })),
    votes: votes.map((vote) => ({
      archiveEventId: vote.archiveEventId,
      voterPublicKey: vote.voterPublicKey,
      vote: vote.vote,
      voteWeight: vote.voteWeight,
      blockHeight: vote.blockHeight,
      isNullified: vote.isNullified,
      status: vote.status,
    })),
    nullifiers: nullifiers.map((nullifier) => ({
      sourceEventId: nullifier.sourceEventId,
      voterPublicKey: nullifier.voterPublicKey,
      vote: nullifier.vote,
      voteWeight: nullifier.voteWeight,
      blockHeight: nullifier.blockHeight,
    })),
    tallies: tallies.map((tally) => ({
      archiveEventId: tally.archiveEventId,
      sourceStatus: tally.sourceStatus,
      blockHeight: tally.blockHeight,
      yayWeight: tally.yayWeight,
      nayWeight: tally.nayWeight,
      abstainWeight: tally.abstainWeight,
      totalParticipatingVotes: tally.totalParticipatingVotes,
      createdByEventType: tally.createdByEventType,
    })),
    proposal: {
      contractStatus: proposal.contractStatus,
      paidOutAmount: proposal.paidOutAmount,
    },
  };
}

test(
  "PostgreSQL rolls back an overpayment rejected by the execution handler",
  { skip: databaseTestUrl ? false : "DATABASE_TEST_URL is not set" },
  async () => {
    await withPostgresDataSource(async (dataSource) => {
      const proposalPublicKey = PrivateKey.fromBigInt(10n)
        .toPublicKey()
        .toBase58();
      const senderPublicKey = PrivateKey.fromBigInt(11n)
        .toPublicKey()
        .toBase58();
      await insertProposal(dataSource, proposalPublicKey);
      const rejectedEvent = event({
        id: "1001",
        changeSequence: "1001",
        eventType: PROPOSAL_EXECUTED_EVENT_NAME,
        blockHeight: 2,
        rawEventData: {
          proposalPublicKey,
          amountToPayOut: "111",
          senderPublicKey,
        },
      });
      const handler = new ProposalExecutedEventHandler(
        new ProposalProjectionReconciler(),
      );

      await assert.rejects(
        dataSource.transaction(
          async (manager) => await handler.tryHandle(rejectedEvent, manager),
        ),
        /paid out amount exceeds the contract payout limit/,
      );

      assert.equal(
        await dataSource
          .getRepository(ProposalEventFactEntity)
          .countBy({ archiveEventId: rejectedEvent.id }),
        0,
      );
      assert.equal(
        await dataSource
          .getRepository(ProposalExecutionEntity)
          .countBy({ archiveEventId: rejectedEvent.id }),
        0,
      );
      const proposal = await dataSource
        .getRepository(ProposalEntity)
        .findOneByOrFail({ proposalPublicKey });
      assert.deepEqual(
        {
          contractStatus: proposal.contractStatus,
          paidOutAmount: proposal.paidOutAmount,
        },
        { contractStatus: "unknown", paidOutAmount: "0" },
      );
    });
  },
);

test(
  "PostgreSQL restores prior vote projections after a running-tally overflow",
  { skip: databaseTestUrl ? false : "DATABASE_TEST_URL is not set" },
  async () => {
    await withPostgresDataSource(async (dataSource) => {
      const proposalPublicKey = PrivateKey.fromBigInt(20n)
        .toPublicKey()
        .toBase58();
      const senderPublicKey = PrivateKey.fromBigInt(21n)
        .toPublicKey()
        .toBase58();
      const firstVoterPublicKey = PrivateKey.fromBigInt(22n)
        .toPublicKey()
        .toBase58();
      const overflowVoterPublicKey = PrivateKey.fromBigInt(23n)
        .toPublicKey()
        .toBase58();
      const weights = new Map<string, bigint>([
        [firstVoterPublicKey, MAX_UINT64],
        [overflowVoterPublicKey, 1n],
      ]);
      await insertProposal(dataSource, proposalPublicKey);
      const reconciler = new ProposalProjectionReconciler();
      const handler = new ProposalVoteDispatchedEventHandler(
        {
          getService: async () => ({
            start: async () => undefined,
            getVoteWeight: async (voterPublicKey) =>
              weights.get(voterPublicKey) ?? 0n,
            close: async () => undefined,
          }),
        },
        {
          calculateAcceptanceCriteria: async () => ({
            requiredParticipation: 0n,
            requiredApprovalBp: 0n,
          }),
          calculateVoteResult: async () => "approved",
        },
        { resolveTreasuryBalanceForLifecycle: async () => "100" },
        reconciler,
      );
      const firstEvent = event({
        id: "2001",
        changeSequence: "2001",
        eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
        blockHeight: 2,
        rawEventData: {
          proposalPublicKey,
          voterPublicKey: firstVoterPublicKey,
          vote: "yay",
          senderPublicKey,
        },
      });
      assert.equal(
        await dataSource.transaction(
          async (manager) => await handler.tryHandle(firstEvent, manager),
        ),
        true,
      );
      const stateBeforeRejection = await readVoteState(
        dataSource,
        proposalPublicKey,
      );
      const rejectedEvent = event({
        id: "2002",
        changeSequence: "2002",
        eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
        blockHeight: 3,
        rawEventData: {
          proposalPublicKey,
          voterPublicKey: overflowVoterPublicKey,
          vote: "yay",
          senderPublicKey,
        },
      });

      await assert.rejects(
        dataSource.transaction(
          async (manager) => await handler.tryHandle(rejectedEvent, manager),
        ),
        /running yay tally must be in the UInt64 range/,
      );

      assert.equal(
        await dataSource
          .getRepository(ProposalEventFactEntity)
          .countBy({ archiveEventId: rejectedEvent.id }),
        0,
      );
      assert.equal(
        await dataSource
          .getRepository(VoteEntity)
          .countBy({ archiveEventId: rejectedEvent.id }),
        0,
      );
      assert.deepEqual(
        await readVoteState(dataSource, proposalPublicKey),
        stateBeforeRejection,
      );
    });
  },
);
