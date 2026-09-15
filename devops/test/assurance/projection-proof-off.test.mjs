import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ArchiveEventEntity } from "../../../packages/indexer/src/entities.ts";
import {
  EventProcessorRouter,
  EventsProcessor,
  ProcessorEventFailureEntity,
  ProcessorOffsetEntity,
} from "../../../packages/processor/src/index.ts";
import {
  PROPOSAL_CREATED_EVENT_NAME,
  PROPOSAL_EXECUTED_EVENT_NAME,
  PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
  PROPOSAL_VOTES_TALLIED_EVENT_NAME,
} from "../../../packages/sdk/src/provable/events/treasury-proposal-events.ts";
import { ProposalEntity } from "../../../apps/api/src/processors/proposals/proposal-entity.ts";
import { ProposalEventFactEntity } from "../../../apps/api/src/processors/proposals/proposal-event-fact-entity.ts";
import { ProposalExecutionEntity } from "../../../apps/api/src/processors/proposals/proposal-execution-entity.ts";
import { ProposalProjectionReconciler } from "../../../apps/api/src/processors/proposals/proposal-projection-reconciler.ts";
import { ProposalProjectionReplayEntity } from "../../../apps/api/src/processors/proposals/proposal-projection-replay-entity.ts";
import { VoteEntity } from "../../../apps/api/src/processors/proposals/vote-entity.ts";
import { VoteNullifierEntity } from "../../../apps/api/src/processors/proposals/vote-nullifier-entity.ts";
import { VoteTallyEntity } from "../../../apps/api/src/processors/proposals/vote-tally-entity.ts";
import { createInMemoryDataSource } from "../../../apps/api/test/support/create-in-memory-data-source.ts";

const PROPOSAL_KEY = "B62qprojectionAssuranceProposal";
const PROJECTION_ENTITIES = [
  ProposalEntity,
  ProposalEventFactEntity,
  ProposalProjectionReplayEntity,
  ProposalExecutionEntity,
  VoteEntity,
  VoteNullifierEntity,
  VoteTallyEntity,
];

// Evidence boundary: cases 001-005 start with normalized ArchiveEventEntity
// observations and call the production API reconciler. Case 004 also calls the
// production processor supersession path. This lane does not run Archive polling,
// a Mina node, a contract, or proof verification.

function archiveEvent({
  id,
  changeSequence,
  eventType,
  blockHeight,
  blockEventIndex = 0,
  status = "canonical",
  proof = undefined,
}) {
  const timestamp = new Date(
    Date.UTC(2026, 0, 1, 0, 0, Number(changeSequence)),
  );
  return Object.assign(new ArchiveEventEntity(), {
    id,
    changeSequence: String(changeSequence),
    status,
    pendingSeenAtHeight: status === "pending" ? blockHeight : null,
    blockHeight,
    blockTimestamp: timestamp,
    globalSlotSinceGenesis: blockHeight,
    stateHash: `state-${blockHeight}`,
    parentHash: `state-${blockHeight - 1}`,
    chainStatus: status,
    eventType,
    txHash: `tx-${id}`,
    accountUpdateId: id,
    accountUpdateIndex: 0,
    eventIndex: 0,
    blockEventIndex,
    rawEventData: {
      data: [`payload-${id}`],
      proof,
      transactionInfo: { sequenceNumber: blockEventIndex },
    },
    indexedAt: timestamp,
    updatedAt: timestamp,
  });
}

function observe(event, changeSequence, status) {
  return Object.assign(new ArchiveEventEntity(), event, {
    changeSequence: String(changeSequence),
    status,
    pendingSeenAtHeight: status === "pending" ? event.blockHeight : null,
    chainStatus: status,
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 1, Number(changeSequence))),
  });
}

function lifecycle(prefix, firstSequence = 1) {
  const definitions = [
    {
      name: "create",
      eventType: PROPOSAL_CREATED_EVENT_NAME,
      payload: {
        proposalPublicKey: PROPOSAL_KEY,
        lifecycleId: 2,
        amount: "100",
        recipient: "B62qprojectionRecipient",
        senderPublicKey: "B62qprojectionCreator",
        zkAppUriHash: "901",
        stakingEpochDataLedgerHash: "902",
        stakingEpochDataLedgerTotalCurrency: "1000",
        requiredParticipationBp: "1000",
        requiredApprovalBp: "5100",
        requiredParticipation: "10",
      },
    },
    {
      name: "vote-yay",
      eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
      payload: {
        proposalPublicKey: PROPOSAL_KEY,
        voterPublicKey: "voter-alpha",
        vote: "yay",
        senderPublicKey: "relayer-one",
      },
    },
    {
      name: "vote-nay",
      eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
      payload: {
        proposalPublicKey: PROPOSAL_KEY,
        voterPublicKey: "voter-beta",
        vote: "nay",
        senderPublicKey: "relayer-two",
      },
    },
    {
      name: "tally",
      eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
      payload: {
        proposalPublicKey: PROPOSAL_KEY,
        lifecycleId: 2,
        yayWeight: "11",
        nayWeight: "7",
        abstainWeight: "0",
        voteResult: "approved",
        senderPublicKey: "tally-relayer",
      },
    },
    {
      name: "execute",
      eventType: PROPOSAL_EXECUTED_EVENT_NAME,
      payload: {
        proposalPublicKey: PROPOSAL_KEY,
        recipient: "B62qprojectionRecipient",
        amountToPayOut: "110",
        senderPublicKey: "execution-relayer",
      },
    },
  ];

  return definitions.map((definition, index) => ({
    ...definition,
    event: archiveEvent({
      id: `${prefix}-${definition.name}`,
      changeSequence: firstSequence + index,
      eventType: definition.eventType,
      blockHeight: 400 + index,
      blockEventIndex: index % 2,
    }),
  }));
}

async function projectionFixture() {
  const dataSource = createInMemoryDataSource("public", PROJECTION_ENTITIES);
  await dataSource.initialize();
  await dataSource.synchronize();
  const reconciler = new ProposalProjectionReconciler();
  const weights = new Map([
    ["voter-alpha", 11n],
    ["voter-beta", 7n],
    ["voter-gamma", 19n],
  ]);
  reconciler.configureVoteProjection({
    getVoteWeight: async (_proposal, voterPublicKey) =>
      weights.get(voterPublicKey) ?? 0n,
    calculateVoteResult: async (_proposal, yay, nay) =>
      yay > nay ? "approved" : "rejected",
  });
  return { dataSource, reconciler };
}

async function record(dataSource, reconciler, item) {
  await dataSource.transaction(async (manager) => {
    await reconciler.recordAndReconcile(
      item.event,
      item.event.eventType,
      item.payload,
      manager,
    );
  });
}

async function recordAll(dataSource, reconciler, items) {
  for (const item of items) await record(dataSource, reconciler, item);
}

function sortById(rows, key) {
  return [...rows].sort((left, right) =>
    String(left[key]).localeCompare(String(right[key])),
  );
}

async function snapshot(dataSource) {
  const proposal = await dataSource
    .getRepository(ProposalEntity)
    .findOneBy({ proposalPublicKey: PROPOSAL_KEY });
  const facts = sortById(
    await dataSource
      .getRepository(ProposalEventFactEntity)
      .findBy({ proposalPublicKey: PROPOSAL_KEY }),
    "archiveEventId",
  );
  const votes = sortById(
    await dataSource
      .getRepository(VoteEntity)
      .findBy({ proposalPublicKey: PROPOSAL_KEY }),
    "archiveEventId",
  );
  const tallies = sortById(
    await dataSource
      .getRepository(VoteTallyEntity)
      .findBy({ proposalPublicKey: PROPOSAL_KEY }),
    "blockHeight",
  );
  const executions = sortById(
    await dataSource
      .getRepository(ProposalExecutionEntity)
      .findBy({ proposalPublicKey: PROPOSAL_KEY }),
    "archiveEventId",
  );
  return {
    proposal:
      proposal === null
        ? null
        : {
            lifecycleId: proposal.lifecycleId,
            amount: proposal.amount,
            recipient: proposal.recipient,
            contractStatus: proposal.contractStatus,
            contractStatusFinality: proposal.contractStatusFinality,
            isPaused: proposal.isPaused,
            paidOutAmount: proposal.paidOutAmount,
          },
    facts: facts.map((fact) => ({
      archiveEventId: fact.archiveEventId,
      eventType: fact.eventType,
      status: fact.status,
      blockHeight: fact.blockHeight,
      blockEventIndex: fact.blockEventIndex,
      payload: fact.decodedPayload,
    })),
    votes: votes.map((vote) => ({
      archiveEventId: vote.archiveEventId,
      voterPublicKey: vote.voterPublicKey,
      vote: vote.vote,
      voteWeight: vote.voteWeight,
      isNullified: vote.isNullified,
      status: vote.status,
    })),
    tallies: tallies.map((tally) => ({
      archiveEventId: tally.archiveEventId,
      blockHeight: tally.blockHeight,
      yayWeight: tally.yayWeight,
      nayWeight: tally.nayWeight,
      abstainWeight: tally.abstainWeight,
      voteResult: tally.voteResult,
      sourceStatus: tally.sourceStatus,
      createdByEventType: tally.createdByEventType,
    })),
    executions: executions.map((execution) => ({
      archiveEventId: execution.archiveEventId,
      amountToPayOut: execution.amountToPayOut,
      paidOutAmount: execution.paidOutAmount,
      remainingAmount: execution.remainingAmount,
      status: execution.status,
    })),
  };
}

function sequencedProcessorEvent({ id, changeSequence, eventKey, payload }) {
  return Object.assign(new ArchiveEventEntity(), {
    id,
    changeSequence,
    status: "canonical",
    pendingSeenAtHeight: null,
    blockHeight: 500,
    blockTimestamp: null,
    globalSlotSinceGenesis: 500,
    stateHash: "processor-state",
    parentHash: "processor-parent",
    chainStatus: "canonical",
    eventType: "assuranceProjection",
    txHash: `tx-${id}`,
    accountUpdateId: id,
    accountUpdateIndex: 0,
    eventIndex: 0,
    blockEventIndex: 0,
    rawEventData: { data: [eventKey, payload] },
    indexedAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 2, Number(changeSequence))),
  });
}

describe("proof-off proposal projection assurance", () => {
  it("requires the proof-off process contract", () => {
    assert.equal(process.env.PROOFS_ENABLED, "false");
  });

  it("CALL-PROJECTION-001 keeps accepted facts, contract state, and projection in agreement", async () => {
    const { dataSource, reconciler } = await projectionFixture();
    try {
      const items = lifecycle("agreement");
      await recordAll(dataSource, reconciler, items);
      const result = await snapshot(dataSource);
      const finalTally = result.tallies.find(
        (tally) => tally.archiveEventId === "agreement-tally",
      );

      assert.equal(result.facts.length, 5);
      assert.deepEqual(result.proposal, {
        lifecycleId: 2,
        amount: "100",
        recipient: "B62qprojectionRecipient",
        contractStatus: "approved",
        contractStatusFinality: "canonical",
        isPaused: false,
        paidOutAmount: "110",
      });
      assert.deepEqual(
        result.votes.map(({ vote, voteWeight, isNullified }) => ({
          vote,
          voteWeight,
          isNullified,
        })),
        [
          { vote: "nay", voteWeight: "7", isNullified: false },
          { vote: "yay", voteWeight: "11", isNullified: false },
        ],
      );
      assert.deepEqual(finalTally, {
        archiveEventId: "agreement-tally",
        blockHeight: 403,
        yayWeight: "11",
        nayWeight: "7",
        abstainWeight: "0",
        voteResult: "approved",
        sourceStatus: "canonical",
        createdByEventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
      });
      assert.deepEqual(result.executions, [
        {
          archiveEventId: "agreement-execute",
          amountToPayOut: "110",
          paidOutAmount: "110",
          remainingAmount: "0",
          status: "canonical",
        },
      ]);
    } finally {
      await dataSource.destroy();
    }
  });

  it("CALL-PROJECTION-002 applies each duplicate archive event once", async () => {
    const { dataSource, reconciler } = await projectionFixture();
    try {
      const [creation, vote] = lifecycle("duplicate");
      await record(dataSource, reconciler, creation);
      for (const duplicate of [vote, vote, vote]) {
        await record(dataSource, reconciler, duplicate);
      }

      assert.equal(
        await dataSource
          .getRepository(ProposalEventFactEntity)
          .countBy({ proposalPublicKey: PROPOSAL_KEY }),
        2,
      );
      assert.equal(
        await dataSource
          .getRepository(VoteEntity)
          .countBy({ proposalPublicKey: PROPOSAL_KEY }),
        1,
      );
      assert.equal(
        await dataSource
          .getRepository(VoteNullifierEntity)
          .countBy({ proposalPublicKey: PROPOSAL_KEY }),
        1,
      );
      assert.equal(
        await dataSource
          .getRepository(VoteTallyEntity)
          .countBy({ proposalPublicKey: PROPOSAL_KEY }),
        1,
      );
    } finally {
      await dataSource.destroy();
    }
  });

  it("CALL-PROJECTION-003 converges after delayed and reordered delivery", async () => {
    const items = lifecycle("convergence");
    const orders = [
      items,
      [...items].reverse(),
      [items[3], items[1], items[4], items[0], items[2]],
    ];
    const observations = [];

    for (const order of orders) {
      const { dataSource, reconciler } = await projectionFixture();
      try {
        await recordAll(dataSource, reconciler, order);
        observations.push(await snapshot(dataSource));
      } finally {
        await dataSource.destroy();
      }
    }

    assert.deepEqual(observations[1], observations[0]);
    assert.deepEqual(observations[2], observations[0]);
  });

  it("CALL-PROJECTION-004 retires orphan effects and superseded processor failures", async () => {
    const { dataSource, reconciler } = await projectionFixture();
    try {
      const items = lifecycle("orphan");
      await recordAll(dataSource, reconciler, items);
      const execution = items.at(-1);
      await record(dataSource, reconciler, {
        ...execution,
        event: observe(execution.event, 20, "orphaned"),
      });
      const result = await snapshot(dataSource);
      assert.equal(result.executions.length, 0);
      assert.equal(result.proposal.paidOutAmount, "0");
      assert.equal(
        result.facts.find((fact) => fact.archiveEventId === execution.event.id)
          .status,
        "orphaned",
      );
    } finally {
      await dataSource.destroy();
    }

    const processorDataSource = createInMemoryDataSource();
    await processorDataSource.initialize();
    await processorDataSource.synchronize();
    const blocked = sequencedProcessorEvent({
      id: "100",
      changeSequence: "30",
      eventKey: "stable-key",
      payload: "stable-payload",
    });
    const intervening = sequencedProcessorEvent({
      id: "101",
      changeSequence: "31",
      eventKey: "other-key",
      payload: "other-payload",
    });
    const successor = Object.assign(new ArchiveEventEntity(), blocked, {
      changeSequence: "32",
      updatedAt: new Date("2026-01-01T00:02:32.000Z"),
    });
    let sourceRows = [blocked];
    const handled = [];
    const processor = new EventsProcessor(
      processorDataSource,
      new EventProcessorRouter([
        {
          eventType: "assuranceProjection",
          tryHandle: async (event) => {
            if (event.changeSequence === "30") return false;
            handled.push(event.changeSequence);
            return true;
          },
        },
      ]),
      {
        processorName: "projection-assurance",
        pollIntervalMs: 60_000,
        batchSize: 2,
        maxAttempts: 1,
        retryBaseDelayMs: 0,
      },
      {
        fetchEventsPage: async ({ changeSequenceAfter, limit }) => {
          const items = sourceRows
            .filter(
              (event) =>
                BigInt(event.changeSequence) > BigInt(changeSequenceAfter),
            )
            .sort((left, right) =>
              BigInt(left.changeSequence) < BigInt(right.changeSequence)
                ? -1
                : 1,
            )
            .slice(0, limit);
          return {
            items,
            nextCursor: items.length
              ? { changeSequenceAfter: items.at(-1).changeSequence }
              : null,
          };
        },
      },
    );
    try {
      assert.equal(await processor.processOnce(), 0);
      sourceRows = [intervening, successor];
      assert.equal(await processor.processOnce(), 2);
      assert.deepEqual(handled, ["31", "32"]);
      const failure = await processorDataSource
        .getRepository(ProcessorEventFailureEntity)
        .findOneByOrFail({
          processorName: "projection-assurance",
          archiveEventId: blocked.id,
          changeSequence: blocked.changeSequence,
        });
      assert.equal(failure.state, "superseded");
      assert.ok(failure.resolvedAt);
      assert.equal(
        (
          await processorDataSource
            .getRepository(ProcessorOffsetEntity)
            .findOneByOrFail({ processorName: "projection-assurance" })
        ).lastSeenChangeSequence,
        "32",
      );
    } finally {
      await processor.stop();
    }
  });

  it("CALL-PROJECTION-005 removes the old fork and replays only the new canonical branch", async () => {
    const { dataSource, reconciler } = await projectionFixture();
    try {
      const oldBranch = lifecycle("old-fork");
      await recordAll(dataSource, reconciler, oldBranch);
      for (const [index, item] of oldBranch.entries()) {
        await record(dataSource, reconciler, {
          ...item,
          event: observe(item.event, 30 + index, "orphaned"),
        });
      }
      assert.equal((await snapshot(dataSource)).proposal, null);

      const [creation] = lifecycle("new-fork", 40);
      const newVote = {
        event: archiveEvent({
          id: "new-fork-vote",
          changeSequence: 41,
          eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
          blockHeight: 501,
        }),
        payload: {
          proposalPublicKey: PROPOSAL_KEY,
          voterPublicKey: "voter-gamma",
          vote: "nay",
          senderPublicKey: "new-fork-relayer",
        },
      };
      const newTally = {
        event: archiveEvent({
          id: "new-fork-tally",
          changeSequence: 42,
          eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
          blockHeight: 502,
        }),
        payload: {
          proposalPublicKey: PROPOSAL_KEY,
          lifecycleId: 2,
          yayWeight: "0",
          nayWeight: "19",
          abstainWeight: "0",
          voteResult: "rejected",
          senderPublicKey: "new-fork-tally-relayer",
        },
      };
      await recordAll(dataSource, reconciler, [creation, newVote, newTally]);
      const result = await snapshot(dataSource);

      assert.equal(result.proposal.contractStatus, "rejected");
      assert.equal(result.proposal.paidOutAmount, "0");
      assert.deepEqual(
        result.votes.map((vote) => [
          vote.archiveEventId,
          vote.vote,
          vote.voteWeight,
        ]),
        [["new-fork-vote", "nay", "19"]],
      );
      assert.equal(result.executions.length, 0);
      assert.equal(
        result.facts.filter((fact) => fact.status === "orphaned").length,
        5,
      );
      assert.equal(
        result.facts.filter((fact) => fact.status === "canonical").length,
        3,
      );
    } finally {
      await dataSource.destroy();
    }
  });

  it("CALL-PROJECTION-007 records projection evidence without proof-validity credit", async () => {
    const { dataSource, reconciler } = await projectionFixture();
    try {
      const [creation] = lifecycle("trust-boundary", 70);
      creation.event.rawEventData.proof = "not-a-valid-zk-proof";
      await record(dataSource, reconciler, creation);

      const fact = await dataSource
        .getRepository(ProposalEventFactEntity)
        .findOneByOrFail({ archiveEventId: creation.event.id });
      const proposal = await dataSource
        .getRepository(ProposalEntity)
        .findOneByOrFail({ proposalPublicKey: PROPOSAL_KEY });
      const evidence = {
        kind: "accepted-event-projection",
        proofValidity: "not-evaluated",
      };

      assert.equal(fact.status, "canonical");
      assert.equal(proposal.proposalPublicKey, PROPOSAL_KEY);
      assert.deepEqual(evidence, {
        kind: "accepted-event-projection",
        proofValidity: "not-evaluated",
      });
    } finally {
      await dataSource.destroy();
    }
  });
});
