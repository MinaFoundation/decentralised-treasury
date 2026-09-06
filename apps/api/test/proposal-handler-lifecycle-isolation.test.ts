import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ArchiveEventEntity } from "@repo/indexer";
import type { EventProcessorHandler } from "@repo/processor";
import {
  PROPOSAL_CREATED_EVENT_NAME,
  PROPOSAL_EXECUTED_EVENT_NAME,
  PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
  PROPOSAL_VOTES_TALLIED_EVENT_NAME,
  ProposalCreatedEvent,
  ProposalExecutedEvent,
  ProposalVoteDispatchedEvent,
  ProposalVotesTalliedEvent,
} from "@repo/sdk/src/provable/events/treasury-proposal-events.js";
import { Vote } from "@repo/sdk/src/provable/contracts/treasury-proposal/vote-reducer.js";
import { Account } from "@repo/sdk/src/provable/account.js";
import { Field, PrivateKey, PublicKey, UInt32, UInt64 } from "o1js";
import type { DataSource, EntityManager } from "typeorm";
import { ProposalCreatedEventHandler } from "../src/processors/proposals/proposal-created-event-handler.js";
import { ProposalExecutedEventHandler } from "../src/processors/proposals/proposal-executed-event-handler.js";
import { ProposalExecutionEntity } from "../src/processors/proposals/proposal-execution-entity.js";
import { ProposalEntity } from "../src/processors/proposals/proposal-entity.js";
import { ProposalEventFactEntity } from "../src/processors/proposals/proposal-event-fact-entity.js";
import { ProposalProjectionReconciler } from "../src/processors/proposals/proposal-projection-reconciler.js";
import { ProposalVoteDispatchedEventHandler } from "../src/processors/proposals/proposal-vote-dispatched-event-handler.js";
import { ProposalVotesTalliedEventHandler } from "../src/processors/proposals/proposal-votes-tallied-event-handler.js";
import type { VotingLedgerServiceLookup } from "../src/processors/proposals/lifecycle-voting-ledger-service-registry.js";
import { VoteEntity } from "../src/processors/proposals/vote-entity.js";
import { VoteNullifierEntity } from "../src/processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../src/processors/proposals/vote-tally-entity.js";
import type { StakingLedgerServiceLookup } from "../src/staking-ledger/lifecycle-staking-ledger-service-registry.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";

const TREASURY_OWNER_PUBLIC_KEY = PrivateKey.random().toPublicKey().toBase58();

interface LookupLog {
  stakingLifecycleIds: string[];
  treasuryAccountLifecycleIds: string[];
  votingLifecycleIds: string[];
}

interface HandlerHarness {
  rootsByLifecycle: Map<string, string>;
  lookupLog: LookupLog;
  created: ProposalCreatedEventHandler;
  voted: ProposalVoteDispatchedEventHandler;
  tallied: ProposalVotesTalliedEventHandler;
  executed: ProposalExecutedEventHandler;
}

function createHandlerHarness(input: {
  rootsByLifecycle: Map<string, string>;
  balancesByLifecycle: Map<string, string>;
  voteWeightsByLifecycle: Map<string, Map<string, bigint>>;
  injectedVotingWeightsByLifecycle?: Map<string, Map<string, bigint>>;
}): HandlerHarness {
  const lookupLog: LookupLog = {
    stakingLifecycleIds: [],
    treasuryAccountLifecycleIds: [],
    votingLifecycleIds: [],
  };
  const stakingLedgerServices: StakingLedgerServiceLookup = {
    async getService(lifecycleId) {
      lookupLog.stakingLifecycleIds.push(lifecycleId);
      const root = input.rootsByLifecycle.get(lifecycleId);
      const balance = input.balancesByLifecycle.get(lifecycleId);
      assert.ok(root, `missing test staking root for lifecycle ${lifecycleId}`);
      assert.ok(
        balance,
        `missing test treasury balance for lifecycle ${lifecycleId}`,
      );
      const voteWeights = input.voteWeightsByLifecycle.get(lifecycleId);
      assert.ok(
        voteWeights,
        `missing test staking weights for lifecycle ${lifecycleId}`,
      );
      const accounts = Array.from(voteWeights, ([delegate, voteWeight]) => {
        const account = Account.empty();
        account.pk = PrivateKey.random().toPublicKey();
        account.delegate = PublicKey.fromBase58(delegate);
        account.balance = UInt64.from(voteWeight);
        return account;
      });
      return {
        async getRootHash() {
          return Field(root);
        },
        async getAccountByPublicKey(publicKey: string) {
          assert.equal(publicKey, TREASURY_OWNER_PUBLIC_KEY);
          lookupLog.treasuryAccountLifecycleIds.push(lifecycleId);
          const account = Account.empty();
          account.pk = PublicKey.fromBase58(TREASURY_OWNER_PUBLIC_KEY);
          account.balance = UInt64.from(balance);
          return {
            index: 0n,
            account,
          };
        },
        async getWitness(index: bigint) {
          return {
            calculateIndex: () => Field(index),
            calculateRoot: () => Field(root),
          } as never;
        },
        async getAllAccounts() {
          return accounts;
        },
        async getAccount(index: bigint) {
          return accounts[Number(index)] ?? Account.empty();
        },
      } as never;
    },
  };
  const votingLedgerServices: VotingLedgerServiceLookup = {
    async getService(lifecycleId) {
      lookupLog.votingLifecycleIds.push(lifecycleId);
      const weights = (
        input.injectedVotingWeightsByLifecycle ?? input.voteWeightsByLifecycle
      ).get(lifecycleId);
      assert.ok(
        weights,
        `missing test voting ledger for lifecycle ${lifecycleId}`,
      );
      return {
        async start() {},
        async getVoteWeight(voterPublicKey: string) {
          return weights.get(voterPublicKey) ?? 0n;
        },
        async close() {},
      };
    },
  };
  const reconciler = new ProposalProjectionReconciler();
  const options = {
    stakingLedgerServices,
    treasuryOwnerPublicKey: TREASURY_OWNER_PUBLIC_KEY,
  };

  return {
    rootsByLifecycle: input.rootsByLifecycle,
    lookupLog,
    created: new ProposalCreatedEventHandler(options, reconciler),
    voted: new ProposalVoteDispatchedEventHandler(
      votingLedgerServices,
      undefined,
      options,
      reconciler,
    ),
    tallied: new ProposalVotesTalliedEventHandler(reconciler),
    executed: new ProposalExecutedEventHandler(reconciler),
  };
}

function fieldEncodedEvent(input: {
  id: string;
  eventType: string;
  fields: Field[];
  blockHeight: number;
}): ArchiveEventEntity {
  const event = new ArchiveEventEntity();
  const observedAt = new Date(
    Date.UTC(2026, 0, 1, 0, 0, input.blockHeight % 60),
  );
  event.id = input.id;
  event.changeSequence = input.id;
  event.status = "canonical";
  event.pendingSeenAtHeight = null;
  event.blockHeight = input.blockHeight;
  event.blockTimestamp = observedAt;
  event.globalSlotSinceGenesis = input.blockHeight;
  event.stateHash = null;
  event.parentHash = null;
  event.chainStatus = "canonical";
  event.eventType = input.eventType;
  event.txHash = `tx-${input.id}`;
  event.accountUpdateId = input.id;
  event.accountUpdateIndex = 0;
  event.eventIndex = 0;
  event.blockEventIndex = 0;
  event.rawEventData = {
    data: input.fields.map((field) => field.toString()),
  } as never;
  event.indexedAt = observedAt;
  event.updatedAt = observedAt;
  return event;
}

function proposalCreatedEvent(input: {
  id: string;
  proposalPublicKey: PublicKey;
  lifecycleId: number;
  amount: number;
  recipient: PublicKey;
  stakingRoot: string;
  stakingTotal: number;
  senderPublicKey: PublicKey;
  blockHeight: number;
}): ArchiveEventEntity {
  const payload = new ProposalCreatedEvent({
    proposalPublicKey: input.proposalPublicKey,
    lifecycleId: UInt32.from(input.lifecycleId),
    amount: UInt64.from(input.amount),
    recipient: input.recipient,
    zkAppUriHash: Field(input.lifecycleId * 1_000),
    stakingEpochDataLedgerHash: Field(input.stakingRoot),
    stakingEpochDataLedgerTotalCurrency: UInt64.from(input.stakingTotal),
    proposerPublicKey: input.senderPublicKey,
    senderPublicKey: input.senderPublicKey,
  });
  return fieldEncodedEvent({
    id: input.id,
    eventType: PROPOSAL_CREATED_EVENT_NAME,
    fields: ProposalCreatedEvent.toFields(payload),
    blockHeight: input.blockHeight,
  });
}

function proposalVoteEvent(input: {
  id: string;
  proposalPublicKey: PublicKey;
  voterPublicKey: PublicKey;
  blockHeight: number;
}): ArchiveEventEntity {
  const payload = new ProposalVoteDispatchedEvent({
    proposalPublicKey: input.proposalPublicKey,
    voterPublicKey: input.voterPublicKey,
    vote: Vote.YAY,
    senderPublicKey: PrivateKey.random().toPublicKey(),
  });
  return fieldEncodedEvent({
    id: input.id,
    eventType: PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
    fields: ProposalVoteDispatchedEvent.toFields(payload),
    blockHeight: input.blockHeight,
  });
}

function proposalTalliedEvent(input: {
  id: string;
  proposalPublicKey: PublicKey;
  lifecycleId: number;
  yayWeight: number;
  blockHeight: number;
}): ArchiveEventEntity {
  const payload = new ProposalVotesTalliedEvent({
    proposalPublicKey: input.proposalPublicKey,
    lifecycleId: UInt32.from(input.lifecycleId),
    yayWeight: UInt64.from(input.yayWeight),
    nayWeight: UInt64.zero,
    abstainWeight: UInt64.zero,
    voteResult: Field(1),
    senderPublicKey: PrivateKey.random().toPublicKey(),
  });
  return fieldEncodedEvent({
    id: input.id,
    eventType: PROPOSAL_VOTES_TALLIED_EVENT_NAME,
    fields: ProposalVotesTalliedEvent.toFields(payload),
    blockHeight: input.blockHeight,
  });
}

function proposalExecutedEvent(input: {
  id: string;
  proposalPublicKey: PublicKey;
  amountToPayOut: number;
  blockHeight: number;
}): ArchiveEventEntity {
  const payload = new ProposalExecutedEvent({
    proposalPublicKey: input.proposalPublicKey,
    amountToPayOut: UInt64.from(input.amountToPayOut),
    senderPublicKey: PrivateKey.random().toPublicKey(),
  });
  return fieldEncodedEvent({
    id: input.id,
    eventType: PROPOSAL_EXECUTED_EVENT_NAME,
    fields: ProposalExecutedEvent.toFields(payload),
    blockHeight: input.blockHeight,
  });
}

async function handle(
  dataSource: DataSource,
  handler: EventProcessorHandler,
  event: ArchiveEventEntity,
): Promise<boolean> {
  return await dataSource.transaction(
    async (manager: EntityManager) => await handler.tryHandle(event, manager),
  );
}

describe("proposal handler lifecycle isolation", () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = createInMemoryDataSource("public", [
      ProposalEntity,
      ProposalEventFactEntity,
      ProposalExecutionEntity,
      VoteEntity,
      VoteNullifierEntity,
      VoteTallyEntity,
    ]);
    await dataSource.initialize();
    await dataSource.synchronize();
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it("keeps two interleaved proposal lifecycles independent", async () => {
    const lifecycleA = "11";
    const lifecycleB = "22";
    const stakingRootA = Field(111_111).toString();
    const stakingRootB = Field(222_222).toString();
    const proposalA = PrivateKey.random().toPublicKey();
    const proposalB = PrivateKey.random().toPublicKey();
    const voter = PrivateKey.random().toPublicKey();
    const harness = createHandlerHarness({
      rootsByLifecycle: new Map([
        [lifecycleA, stakingRootA],
        [lifecycleB, stakingRootB],
      ]),
      balancesByLifecycle: new Map([
        [lifecycleA, "10000"],
        [lifecycleB, "20000"],
      ]),
      voteWeightsByLifecycle: new Map([
        [lifecycleA, new Map([[voter.toBase58(), 7n]])],
        [lifecycleB, new Map([[voter.toBase58(), 19n]])],
      ]),
    });
    const events = {
      createA: proposalCreatedEvent({
        id: "1",
        proposalPublicKey: proposalA,
        lifecycleId: Number(lifecycleA),
        amount: 100,
        recipient: PrivateKey.random().toPublicKey(),
        stakingRoot: stakingRootA,
        stakingTotal: 20,
        senderPublicKey: PrivateKey.random().toPublicKey(),
        blockHeight: 100,
      }),
      createB: proposalCreatedEvent({
        id: "2",
        proposalPublicKey: proposalB,
        lifecycleId: Number(lifecycleB),
        amount: 200,
        recipient: PrivateKey.random().toPublicKey(),
        stakingRoot: stakingRootB,
        stakingTotal: 60,
        senderPublicKey: PrivateKey.random().toPublicKey(),
        blockHeight: 200,
      }),
      voteB: proposalVoteEvent({
        id: "3",
        proposalPublicKey: proposalB,
        voterPublicKey: voter,
        blockHeight: 201,
      }),
      voteA: proposalVoteEvent({
        id: "4",
        proposalPublicKey: proposalA,
        voterPublicKey: voter,
        blockHeight: 101,
      }),
      tallyA: proposalTalliedEvent({
        id: "5",
        proposalPublicKey: proposalA,
        lifecycleId: Number(lifecycleA),
        yayWeight: 7,
        blockHeight: 102,
      }),
      tallyB: proposalTalliedEvent({
        id: "6",
        proposalPublicKey: proposalB,
        lifecycleId: Number(lifecycleB),
        yayWeight: 19,
        blockHeight: 202,
      }),
      executeB: proposalExecutedEvent({
        id: "7",
        proposalPublicKey: proposalB,
        amountToPayOut: 90,
        blockHeight: 203,
      }),
      executeA: proposalExecutedEvent({
        id: "8",
        proposalPublicKey: proposalA,
        amountToPayOut: 50,
        blockHeight: 103,
      }),
    };

    for (const [handler, event] of [
      [harness.created, events.createA],
      [harness.created, events.createB],
      [harness.voted, events.voteB],
      [harness.voted, events.voteA],
      [harness.tallied, events.tallyA],
      [harness.tallied, events.tallyB],
      [harness.executed, events.executeB],
      [harness.executed, events.executeA],
    ] as const) {
      assert.equal(await handle(dataSource, handler, event), true);
    }

    const proposals = await dataSource.getRepository(ProposalEntity).find();
    const proposalByKey = new Map(
      proposals.map((proposal) => [proposal.proposalPublicKey, proposal]),
    );
    assert.equal(proposals.length, 2);
    assert.equal(
      proposalByKey.get(proposalA.toBase58())?.stakingEpochDataLedgerHash,
      stakingRootA,
    );
    assert.equal(
      proposalByKey.get(proposalB.toBase58())?.stakingEpochDataLedgerHash,
      stakingRootB,
    );
    assert.equal(proposalByKey.get(proposalA.toBase58())?.paidOutAmount, "50");
    assert.equal(proposalByKey.get(proposalB.toBase58())?.paidOutAmount, "90");

    const votes = await dataSource.getRepository(VoteEntity).find();
    const voteByProposal = new Map(
      votes.map((vote) => [vote.proposalPublicKey, vote]),
    );
    assert.equal(votes.length, 2);
    assert.equal(
      voteByProposal.get(proposalA.toBase58())?.voterPublicKey,
      voter.toBase58(),
    );
    assert.equal(voteByProposal.get(proposalA.toBase58())?.voteWeight, "7");
    assert.equal(
      voteByProposal.get(proposalB.toBase58())?.voterPublicKey,
      voter.toBase58(),
    );
    assert.equal(voteByProposal.get(proposalB.toBase58())?.voteWeight, "19");

    const nullifiers = await dataSource
      .getRepository(VoteNullifierEntity)
      .find();
    const nullifierByProposal = new Map(
      nullifiers.map((nullifier) => [nullifier.proposalPublicKey, nullifier]),
    );
    assert.equal(nullifiers.length, 2);
    assert.equal(
      nullifierByProposal.get(proposalA.toBase58())?.voteWeight,
      "7",
    );
    assert.equal(
      nullifierByProposal.get(proposalB.toBase58())?.voteWeight,
      "19",
    );

    const finalTallyA = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneByOrFail({
        proposalPublicKey: proposalA.toBase58(),
        blockHeight: 102,
      });
    const finalTallyB = await dataSource
      .getRepository(VoteTallyEntity)
      .findOneByOrFail({
        proposalPublicKey: proposalB.toBase58(),
        blockHeight: 202,
      });
    assert.deepEqual(
      {
        yayWeight: finalTallyA.yayWeight,
        totalParticipatingVotes: finalTallyA.totalParticipatingVotes,
        voteResult: finalTallyA.voteResult,
      },
      { yayWeight: "7", totalParticipatingVotes: "7", voteResult: "approved" },
    );
    assert.deepEqual(
      {
        yayWeight: finalTallyB.yayWeight,
        totalParticipatingVotes: finalTallyB.totalParticipatingVotes,
        voteResult: finalTallyB.voteResult,
      },
      {
        yayWeight: "19",
        totalParticipatingVotes: "19",
        voteResult: "approved",
      },
    );

    const executions = await dataSource
      .getRepository(ProposalExecutionEntity)
      .find();
    const executionByProposal = new Map(
      executions.map((execution) => [execution.proposalPublicKey, execution]),
    );
    assert.equal(executions.length, 2);
    assert.deepEqual(
      {
        lifecycleId: executionByProposal.get(proposalA.toBase58())?.lifecycleId,
        paidOutAmount: executionByProposal.get(proposalA.toBase58())
          ?.paidOutAmount,
        remainingAmount: executionByProposal.get(proposalA.toBase58())
          ?.remainingAmount,
      },
      { lifecycleId: 11, paidOutAmount: "50", remainingAmount: "60" },
    );
    assert.deepEqual(
      {
        lifecycleId: executionByProposal.get(proposalB.toBase58())?.lifecycleId,
        paidOutAmount: executionByProposal.get(proposalB.toBase58())
          ?.paidOutAmount,
        remainingAmount: executionByProposal.get(proposalB.toBase58())
          ?.remainingAmount,
      },
      { lifecycleId: 22, paidOutAmount: "90", remainingAmount: "130" },
    );

    assert.deepEqual(harness.lookupLog.treasuryAccountLifecycleIds, [
      "11",
      "22",
    ]);
    assert.deepEqual(harness.lookupLog.stakingLifecycleIds, [
      "11",
      "22",
      "22",
      "11",
    ]);
    assert.deepEqual(harness.lookupLog.votingLifecycleIds, []);
  });

  it("rolls back a vote when the local staking root differs from its proposal snapshot", async () => {
    const lifecycleId = "31";
    const snapshotRoot = Field(313_131).toString();
    const proposal = PrivateKey.random().toPublicKey();
    const voter = PrivateKey.random().toPublicKey();
    const harness = createHandlerHarness({
      rootsByLifecycle: new Map([[lifecycleId, snapshotRoot]]),
      balancesByLifecycle: new Map([[lifecycleId, "10000"]]),
      voteWeightsByLifecycle: new Map([
        [lifecycleId, new Map([[voter.toBase58(), 23n]])],
      ]),
    });
    const create = proposalCreatedEvent({
      id: "101",
      proposalPublicKey: proposal,
      lifecycleId: Number(lifecycleId),
      amount: 100,
      recipient: PrivateKey.random().toPublicKey(),
      stakingRoot: snapshotRoot,
      stakingTotal: 50,
      senderPublicKey: PrivateKey.random().toPublicKey(),
      blockHeight: 300,
    });
    assert.equal(await handle(dataSource, harness.created, create), true);
    harness.rootsByLifecycle.set(lifecycleId, Field(999_999).toString());
    let rollbackCalls = 0;
    const createQueryRunner = dataSource.createQueryRunner.bind(dataSource);
    dataSource.createQueryRunner = (mode) => {
      const queryRunner = createQueryRunner(mode);
      const rollbackTransaction =
        queryRunner.rollbackTransaction.bind(queryRunner);
      queryRunner.rollbackTransaction = async () => {
        rollbackCalls += 1;
        await rollbackTransaction();
      };
      return queryRunner;
    };

    const hostileVote = proposalVoteEvent({
      id: "102",
      proposalPublicKey: proposal,
      voterPublicKey: voter,
      blockHeight: 301,
    });
    await assert.rejects(
      handle(dataSource, harness.voted, hostileVote),
      /staking ledger root mismatch.*lifecycleId=31.*expected=313131 actual=999999/,
    );

    assert.equal(rollbackCalls, 1);
    assert.equal(await dataSource.getRepository(VoteEntity).count(), 0);
    assert.equal(
      await dataSource.getRepository(VoteNullifierEntity).count(),
      0,
    );
    assert.equal(await dataSource.getRepository(VoteTallyEntity).count(), 0);
    assert.equal(await dataSource.getRepository(ProposalEntity).count(), 1);
    assert.deepEqual(harness.lookupLog.stakingLifecycleIds, ["31", "31"]);
    assert.deepEqual(harness.lookupLog.votingLifecycleIds, []);
  });

  it("derives weights from the matching staking ledger and ignores an injected voting ledger", async () => {
    const lifecycleId = "32";
    const snapshotRoot = Field(323_232).toString();
    const proposal = PrivateKey.random().toPublicKey();
    const voter = PrivateKey.random().toPublicKey();
    const stakingVoteWeight = 23n;
    const injectedVotingWeight = 999n;
    const harness = createHandlerHarness({
      rootsByLifecycle: new Map([[lifecycleId, snapshotRoot]]),
      balancesByLifecycle: new Map([[lifecycleId, "10000"]]),
      voteWeightsByLifecycle: new Map([
        [lifecycleId, new Map([[voter.toBase58(), stakingVoteWeight]])],
      ]),
      injectedVotingWeightsByLifecycle: new Map([
        [lifecycleId, new Map([[voter.toBase58(), injectedVotingWeight]])],
      ]),
    });
    const create = proposalCreatedEvent({
      id: "201",
      proposalPublicKey: proposal,
      lifecycleId: Number(lifecycleId),
      amount: 100,
      recipient: PrivateKey.random().toPublicKey(),
      stakingRoot: snapshotRoot,
      stakingTotal: 50,
      senderPublicKey: PrivateKey.random().toPublicKey(),
      blockHeight: 400,
    });
    assert.equal(await handle(dataSource, harness.created, create), true);

    const vote = proposalVoteEvent({
      id: "202",
      proposalPublicKey: proposal,
      voterPublicKey: voter,
      blockHeight: 401,
    });
    assert.equal(await handle(dataSource, harness.voted, vote), true);

    const storedVote = await dataSource
      .getRepository(VoteEntity)
      .findOneByOrFail({ archiveEventId: vote.id });
    assert.equal(storedVote.voteWeight, stakingVoteWeight.toString());
    assert.deepEqual(harness.lookupLog.stakingLifecycleIds, ["32", "32"]);
    assert.deepEqual(harness.lookupLog.votingLifecycleIds, []);
  });
});
