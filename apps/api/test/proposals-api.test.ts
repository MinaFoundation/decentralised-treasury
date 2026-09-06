import assert from "node:assert/strict";
import { createServer } from "node:net";
import { afterEach, describe, it } from "node:test";
import {
  ArchiveEventEntity,
  EventsApiServer,
  EventsRepository,
} from "@repo/indexer";
import { PrivateKey } from "o1js";
import type { DataSource } from "typeorm";
import { createProposalListRoutes } from "../src/proposal-list-routes.js";
import { ProposalExecutedEventHandler } from "../src/processors/proposals/proposal-executed-event-handler.js";
import { ProposalExecutionEntity } from "../src/processors/proposals/proposal-execution-entity.js";
import { ProposalEventFactEntity } from "../src/processors/proposals/proposal-event-fact-entity.js";
import { ProposalEntity } from "../src/processors/proposals/proposal-entity.js";
import { VoteEntity } from "../src/processors/proposals/vote-entity.js";
import { VoteNullifierEntity } from "../src/processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "../src/processors/proposals/vote-tally-entity.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";

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

describe("proposal list endpoint", () => {
  let dataSource: DataSource | null = null;
  let repository: EventsRepository | null = null;
  let server: EventsApiServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    if (repository) {
      await repository.close().catch(() => null);
      repository = null;
    }
    if (dataSource?.isInitialized) {
      await dataSource.destroy().catch(() => null);
      dataSource = null;
    }
  });

  it("qualifies list queries with the configured database schema", async () => {
    const statements: string[] = [];
    const fakeDataSource = {
      options: { schema: "public" },
      query: async (statement: string) => {
        statements.push(statement);
        return statement.includes("COUNT(*)") ? [{ count: 0 }] : [];
      },
    } as unknown as DataSource;
    let listHandler:
      | ((request: unknown, response: unknown) => Promise<void>)
      | undefined;
    const app = {
      get: (path: string, handler: typeof listHandler) => {
        if (path === "/proposals") {
          listHandler = handler;
        }
      },
    };
    createProposalListRoutes({
      dataSource: fakeDataSource,
      databaseSchema: "tenant_api",
    })(app as never);
    let payload: unknown;
    await listHandler?.(
      { query: {} },
      {
        json: (value: unknown) => {
          payload = value;
        },
      },
    );

    assert.deepEqual(payload, {
      lifecycleId: null,
      limit: 20,
      offset: 0,
      total: 0,
      items: [],
      nextOffset: null,
    });
    assert.equal(statements.length, 2);
    assert.ok(
      statements.every((statement) =>
        statement.includes('FROM "tenant_api"."processor_proposals"'),
      ),
    );
  });

  it("lists proposals scoped to a lifecycle with the latest tally", async () => {
    const port = await getAvailablePort();
    dataSource = createInMemoryDataSource("public", [
      ProposalEntity,
      ProposalExecutionEntity,
      VoteEntity,
      VoteNullifierEntity,
      VoteTallyEntity,
    ]);
    repository = new EventsRepository(dataSource, "public", {
      knownEventTypes: ["proposalCreated"],
    });
    await repository.initialize();
    await dataSource.synchronize();

    await dataSource.getRepository(ProposalEntity).insert([
      {
        proposalPublicKey: "B62qproposal-current",
        lifecycleId: 7,
        amount: "840000",
        recipient: "B62qrecipient-current",
        zkAppUriHash: "hash-current",
        status: "canonical",
        creationObservationStatus: "canonical",
        contractStatus: "approved",
        contractStatusFinality: "canonical",
        contractStatusSourceEventId: "tally-current",
        contractStatusBlockHeight: 510,
        isPaused: false,
        contents: "# Fund regional grants\n\nLifecycle-scoped proposal.",
        createdAtBlockHeight: 501,
        createdAtBlockTimestamp: new Date("2026-04-06T10:15:00.000Z"),
      },
      {
        proposalPublicKey: "B62qproposal-historical",
        lifecycleId: 6,
        amount: "420000",
        recipient: "B62qrecipient-historical",
        zkAppUriHash: "hash-historical",
        status: "canonical",
        creationObservationStatus: "canonical",
        contractStatus: "approved",
        contractStatusFinality: "canonical",
        isPaused: false,
        contents: "# Historical proposal\n\nEarlier lifecycle.",
        createdAtBlockHeight: 450,
        createdAtBlockTimestamp: new Date("2026-04-05T10:15:00.000Z"),
      },
      {
        proposalPublicKey: "B62qproposal-current-older",
        lifecycleId: 7,
        amount: "123000",
        recipient: "B62qrecipient-current-older",
        zkAppUriHash: "hash-current-older",
        status: "pending",
        creationObservationStatus: "pending",
        contractStatus: "unknown",
        contractStatusFinality: "pending",
        isPaused: true,
        contents: "# Paused proposal\n\nSecond row for pagination.",
        createdAtBlockHeight: 499,
        createdAtBlockTimestamp: new Date("2026-04-05T12:00:00.000Z"),
      },
    ]);
    await dataSource.getRepository(VoteTallyEntity).insert([
      {
        archiveEventId: "tally-current",
        proposalPublicKey: "B62qproposal-current",
        blockHeight: 510,
        blockEventIndex: 1,
        sourceStatus: "canonical",
        yayWeight: "300000",
        nayWeight: "120000",
        abstainWeight: "10000",
        requiredParticipationBp: "3000",
        requiredApprovalBp: "5000",
        requiredParticipation: "258000",
        totalParticipatingVotes: "430000",
        approvalBp: "7142",
        voteResult: "approved",
        createdByEventType: "proposalVotesTallied",
      },
      {
        archiveEventId: "vote-current",
        proposalPublicKey: "B62qproposal-current",
        blockHeight: 509,
        blockEventIndex: 0,
        sourceStatus: "canonical",
        yayWeight: "250000",
        nayWeight: "100000",
        abstainWeight: "5000",
        requiredParticipationBp: "3000",
        requiredApprovalBp: "5000",
        requiredParticipation: "258000",
        totalParticipatingVotes: "355000",
        approvalBp: "7042",
        voteResult: "approved",
        createdByEventType: "proposalVoteDispatched",
      },
      {
        archiveEventId: "tally-historical",
        proposalPublicKey: "B62qproposal-current",
        blockHeight: 508,
        blockEventIndex: 0,
        sourceStatus: "canonical",
        yayWeight: "200000",
        nayWeight: "130000",
        abstainWeight: "5000",
        requiredParticipationBp: "3000",
        requiredApprovalBp: "5000",
        requiredParticipation: "258000",
        totalParticipatingVotes: "335000",
        approvalBp: "6060",
        voteResult: "approved",
        createdByEventType: "proposalVotesTallied",
      },
    ]);

    server = new EventsApiServer(repository, {
      port,
      pageLimitDefault: 1,
      pageLimitMax: 10,
      registerRoutes: createProposalListRoutes({
        dataSource,
        pageLimitDefault: 1,
        pageLimitMax: 10,
      }),
    });
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${port}/proposals?lifecycleId=7&limit=1&offset=0`,
    );
    assert.equal(response.status, 200);

    const payload = (await response.json()) as {
      lifecycleId: number | null;
      limit: number;
      offset: number;
      total: number;
      nextOffset: number | null;
      items: Array<{
        id: string;
        proposalPublicKey: string;
        lifecycleId: number;
        amount: string;
        isPaused: boolean;
        contractStatus: string;
        contractStatusFinality: string;
        creationObservationStatus: string;
        totalPayoutAmount: string;
        remainingPayoutAmount: string;
        runningVoteTally: {
          blockHeight: number;
        } | null;
        finalVoteTally: {
          blockHeight: number;
          sourceStatus: string;
        } | null;
        historicalFinalVoteTally: { blockHeight: number } | null;
        latestVoteTally: {
          blockHeight: number;
          voteResult: string | null;
          approvalBp: string | null;
        } | null;
      }>;
    };

    assert.equal(payload.lifecycleId, 7);
    assert.equal(payload.limit, 1);
    assert.equal(payload.offset, 0);
    assert.equal(payload.total, 2);
    assert.equal(payload.nextOffset, 1);
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0]?.proposalPublicKey, "B62qproposal-current");
    assert.equal(payload.items[0]?.lifecycleId, 7);
    assert.equal(payload.items[0]?.amount, "840000");
    assert.equal(payload.items[0]?.isPaused, false);
    assert.equal(payload.items[0]?.contractStatus, "approved");
    assert.equal(payload.items[0]?.contractStatusFinality, "canonical");
    assert.equal(payload.items[0]?.creationObservationStatus, "canonical");
    assert.equal(payload.items[0]?.totalPayoutAmount, "924000");
    assert.equal(payload.items[0]?.remainingPayoutAmount, "924000");
    assert.equal(payload.items[0]?.runningVoteTally?.blockHeight, 509);
    assert.equal(payload.items[0]?.finalVoteTally?.blockHeight, 510);
    assert.equal(payload.items[0]?.finalVoteTally?.sourceStatus, "canonical");
    assert.equal(payload.items[0]?.historicalFinalVoteTally?.blockHeight, 508);
    assert.equal(payload.items[0]?.latestVoteTally?.blockHeight, 510);
    assert.equal(payload.items[0]?.latestVoteTally?.voteResult, "approved");
    assert.equal(payload.items[0]?.latestVoteTally?.approvalBp, "7142");

    const detailResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/B62qproposal-current`,
    );
    assert.equal(detailResponse.status, 200);
    const detailPayload = (await detailResponse.json()) as {
      proposalPublicKey: string;
      lifecycleId: number;
      contents: string | null;
      latestVoteTally: {
        blockHeight: number;
        voteResult: string | null;
      } | null;
    };
    assert.equal(detailPayload.proposalPublicKey, "B62qproposal-current");
    assert.equal(detailPayload.lifecycleId, 7);
    assert.equal(
      detailPayload.contents,
      "# Fund regional grants\n\nLifecycle-scoped proposal.",
    );
    assert.equal(detailPayload.latestVoteTally?.blockHeight, 510);
    assert.equal(detailPayload.latestVoteTally?.voteResult, "approved");

    const detailByIdResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/${payload.items[0]?.id}`,
    );
    assert.equal(detailByIdResponse.status, 200);
    const detailByIdPayload = (await detailByIdResponse.json()) as {
      proposalPublicKey: string;
    };
    assert.equal(detailByIdPayload.proposalPublicKey, "B62qproposal-current");

    const missingDetailResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/B62qproposal-missing`,
    );
    assert.equal(missingDetailResponse.status, 404);
    assert.deepEqual(await missingDetailResponse.json(), {
      error: "Proposal not found",
    });
  });

  it("exposes contract finality and payout integrity", async () => {
    const port = await getAvailablePort();
    dataSource = createInMemoryDataSource("public", [
      ProposalEntity,
      ProposalExecutionEntity,
      VoteEntity,
      VoteNullifierEntity,
      VoteTallyEntity,
    ]);
    repository = new EventsRepository(dataSource, "public", {
      knownEventTypes: ["proposalCreated"],
    });
    await repository.initialize();
    await dataSource.synchronize();

    await dataSource.getRepository(ProposalEntity).insert([
      {
        proposalPublicKey: "proposal-finality",
        lifecycleId: 7,
        amount: "1000",
        recipient: "recipient-finality",
        zkAppUriHash: "hash-finality",
        status: "canonical",
        creationObservationStatus: "canonical",
        contractStatus: "approved",
        contractStatusFinality: "canonical",
        contractStatusSourceEventId: "tally-current",
        contractStatusBlockHeight: 202,
        isPaused: false,
        paidOutAmount: "0",
        createdAtBlockHeight: 200,
      },
      {
        proposalPublicKey: "proposal-overflow",
        lifecycleId: 7,
        amount: "18446744073709551615",
        recipient: "recipient-overflow",
        zkAppUriHash: "hash-overflow",
        status: "pending",
        creationObservationStatus: "pending",
        contractStatus: "approved",
        contractStatusFinality: "pending",
        contractStatusSourceEventId: "tally-pending",
        contractStatusBlockHeight: 301,
        isPaused: false,
        paidOutAmount: "0",
        createdAtBlockHeight: 300,
      },
      {
        proposalPublicKey: "proposal-overpaid",
        lifecycleId: 7,
        amount: "100",
        recipient: "recipient-overpaid",
        zkAppUriHash: "hash-overpaid",
        status: "canonical",
        creationObservationStatus: "canonical",
        contractStatus: "approved",
        contractStatusFinality: "canonical",
        contractStatusSourceEventId: "tally-overpaid",
        contractStatusBlockHeight: 401,
        isPaused: false,
        paidOutAmount: "111",
        createdAtBlockHeight: 400,
      },
    ]);
    await dataSource.getRepository(VoteTallyEntity).insert([
      {
        archiveEventId: "vote-running",
        proposalPublicKey: "proposal-finality",
        blockHeight: 201,
        blockEventIndex: 0,
        sourceStatus: "canonical",
        yayWeight: "5",
        nayWeight: "2",
        abstainWeight: "1",
        voteResult: "approved",
        createdByEventType: "proposalVoteDispatched",
      },
      {
        archiveEventId: "tally-current",
        proposalPublicKey: "proposal-finality",
        blockHeight: 202,
        blockEventIndex: 1,
        sourceStatus: "canonical",
        yayWeight: "6",
        nayWeight: "2",
        abstainWeight: "1",
        voteResult: "approved",
        createdByEventType: "proposalVotesTallied",
      },
      {
        archiveEventId: "tally-historical",
        proposalPublicKey: "proposal-finality",
        blockHeight: 202,
        blockEventIndex: 0,
        sourceStatus: "canonical",
        yayWeight: "1",
        nayWeight: "8",
        abstainWeight: "0",
        voteResult: "rejected",
        createdByEventType: "proposalVotesTallied",
      },
      {
        archiveEventId: "tally-orphaned-newest",
        proposalPublicKey: "proposal-finality",
        blockHeight: 999,
        blockEventIndex: 0,
        sourceStatus: "orphaned",
        yayWeight: "0",
        nayWeight: "99",
        abstainWeight: "0",
        voteResult: "rejected",
        createdByEventType: "proposalVotesTallied",
      },
      {
        archiveEventId: "tally-pending",
        proposalPublicKey: "proposal-overflow",
        blockHeight: 301,
        blockEventIndex: 0,
        sourceStatus: "pending",
        yayWeight: "10",
        nayWeight: "0",
        abstainWeight: "0",
        voteResult: "approved",
        createdByEventType: "proposalVotesTallied",
      },
      {
        archiveEventId: "tally-overpaid",
        proposalPublicKey: "proposal-overpaid",
        blockHeight: 401,
        blockEventIndex: 0,
        sourceStatus: "canonical",
        yayWeight: "10",
        nayWeight: "0",
        abstainWeight: "0",
        voteResult: "approved",
        createdByEventType: "proposalVotesTallied",
      },
    ]);

    server = new EventsApiServer(repository, {
      port,
      pageLimitDefault: 20,
      pageLimitMax: 50,
      registerRoutes: createProposalListRoutes({ dataSource }),
    });
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${port}/proposals?lifecycleId=7`,
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      items: Array<{
        proposalPublicKey: string;
        contractStatus: string;
        contractStatusFinality: string;
        contractStatusSourceEventId: string | null;
        totalPayoutAmount: string;
        remainingPayoutAmount: string;
        payoutAmountIntegrity: boolean;
        latestVoteTally: { blockHeight: number } | null;
        runningVoteTally: {
          archiveEventId: string;
          sourceStatus: string;
          createdByEventType: string;
        } | null;
        finalVoteTally: {
          archiveEventId: string;
          sourceStatus: string;
        } | null;
        historicalFinalVoteTally: {
          archiveEventId: string;
          sourceStatus: string;
        } | null;
      }>;
    };
    const finality = payload.items.find(
      (item) => item.proposalPublicKey === "proposal-finality",
    );
    assert.ok(finality);
    assert.equal(finality.contractStatus, "approved");
    assert.equal(finality.latestVoteTally?.blockHeight, 202);
    assert.deepEqual(finality.runningVoteTally, {
      archiveEventId: "vote-running",
      blockEventIndex: 0,
      sourceStatus: "canonical",
      blockHeight: 201,
      yayWeight: "5",
      nayWeight: "2",
      abstainWeight: "1",
      createdByEventType: "proposalVoteDispatched",
      requiredParticipationBp: null,
      requiredApprovalBp: null,
      requiredParticipation: null,
      totalParticipatingVotes: null,
      approvalBp: null,
      voteResult: "approved",
    });
    assert.equal(
      finality.finalVoteTally?.archiveEventId,
      finality.contractStatusSourceEventId,
    );
    assert.equal(finality.finalVoteTally?.sourceStatus, "canonical");
    assert.equal(
      finality.historicalFinalVoteTally?.archiveEventId,
      "tally-historical",
    );
    assert.equal(finality.historicalFinalVoteTally?.sourceStatus, "canonical");
    assert.doesNotMatch(JSON.stringify(finality), /tally-orphaned-newest/);

    const overflow = payload.items.find(
      (item) => item.proposalPublicKey === "proposal-overflow",
    );
    assert.ok(overflow);
    assert.equal(overflow.contractStatus, "approved");
    assert.equal(overflow.contractStatusFinality, "pending");
    assert.equal(overflow.payoutAmountIntegrity, false);
    assert.equal(overflow.totalPayoutAmount, "20291418481080506776");
    assert.equal(overflow.remainingPayoutAmount, "0");
    assert.equal(overflow.finalVoteTally?.archiveEventId, "tally-pending");
    assert.equal(overflow.finalVoteTally?.sourceStatus, "pending");

    const overpaid = payload.items.find(
      (item) => item.proposalPublicKey === "proposal-overpaid",
    );
    assert.ok(overpaid);
    assert.equal(overpaid.payoutAmountIntegrity, false);
    assert.equal(overpaid.totalPayoutAmount, "110");
    assert.equal(overpaid.remainingPayoutAmount, "0");
  });

  it("updates and reverts API payout fields for pending and orphaned executions", async () => {
    const port = await getAvailablePort();
    dataSource = createInMemoryDataSource("public", [
      ProposalEntity,
      ProposalEventFactEntity,
      ProposalExecutionEntity,
      VoteEntity,
      VoteNullifierEntity,
      VoteTallyEntity,
    ]);
    repository = new EventsRepository(dataSource, "public", {
      knownEventTypes: ["proposalExecuted"],
    });
    await repository.initialize();
    await dataSource.synchronize();

    const proposalPublicKey = PrivateKey.random().toPublicKey().toBase58();
    const senderPublicKey = PrivateKey.random().toPublicKey().toBase58();
    await dataSource.getRepository(ProposalEntity).insert({
      proposalPublicKey,
      lifecycleId: 7,
      amount: "1000",
      recipient: "recipient-execution-transition",
      zkAppUriHash: "hash-execution-transition",
      status: "canonical",
      creationObservationStatus: "canonical",
      contractStatus: "approved",
      contractStatusFinality: "canonical",
      isPaused: false,
      paidOutAmount: "0",
      createdAtBlockHeight: 500,
    });

    server = new EventsApiServer(repository, {
      port,
      pageLimitDefault: 20,
      pageLimitMax: 50,
      registerRoutes: createProposalListRoutes({ dataSource }),
    });
    await server.start();

    const event = new ArchiveEventEntity();
    const now = new Date();
    event.id = "execution-transition";
    event.changeSequence = "1";
    event.status = "pending";
    event.pendingSeenAtHeight = 501;
    event.blockHeight = 501;
    event.blockTimestamp = now;
    event.eventType = "proposalExecuted";
    event.txHash = "tx-execution-transition";
    event.accountUpdateId = "1";
    event.accountUpdateIndex = 0;
    event.eventIndex = 0;
    event.blockEventIndex = 0;
    event.rawEventData = {
      proposalPublicKey,
      amountToPayOut: "100",
      senderPublicKey,
    } as never;
    event.indexedAt = now;
    event.updatedAt = now;

    const handler = new ProposalExecutedEventHandler();
    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );

    const fetchProposal = async () => {
      const response = await fetch(
        `http://127.0.0.1:${port}/proposals/${encodeURIComponent(proposalPublicKey)}`,
      );
      assert.equal(response.status, 200);
      return (await response.json()) as {
        paidOutAmount: string;
        totalPayoutAmount: string;
        remainingPayoutAmount: string;
        payoutAmountIntegrity: boolean;
      };
    };
    const fetchExecutions = async () => {
      const response = await fetch(
        `http://127.0.0.1:${port}/proposals/${encodeURIComponent(proposalPublicKey)}/executions`,
      );
      assert.equal(response.status, 200);
      return (await response.json()) as {
        total: number;
        items: Array<{ status: string; amountToPayOut: string }>;
      };
    };

    const pendingProposal = await fetchProposal();
    assert.equal(pendingProposal.paidOutAmount, "100");
    assert.equal(pendingProposal.totalPayoutAmount, "1100");
    assert.equal(pendingProposal.remainingPayoutAmount, "1000");
    assert.equal(pendingProposal.payoutAmountIntegrity, true);
    assert.deepEqual(await fetchExecutions(), {
      proposalPublicKey,
      limit: 20,
      offset: 0,
      total: 1,
      items: [
        {
          id: "1",
          proposalPublicKey,
          recipient: "recipient-execution-transition",
          amountToPayOut: "100",
          bondAmount: "100",
          senderPublicKey,
          paidOutAmount: "100",
          remainingAmount: "1000",
          blockHeight: 501,
          blockEventIndex: 0,
          status: "pending",
          createdAt: (
            await dataSource
              .getRepository(ProposalExecutionEntity)
              .findOneByOrFail({ archiveEventId: event.id })
          ).createdAt.toISOString(),
        },
      ],
      nextOffset: null,
    });

    event.status = "orphaned";
    event.changeSequence = "2";
    event.updatedAt = new Date(now.getTime() + 1_000);
    assert.equal(
      await dataSource.transaction(
        async (manager) => await handler.tryHandle(event, manager),
      ),
      true,
    );

    const orphanedProposal = await fetchProposal();
    assert.equal(orphanedProposal.paidOutAmount, "0");
    assert.equal(orphanedProposal.totalPayoutAmount, "1100");
    assert.equal(orphanedProposal.remainingPayoutAmount, "1100");
    assert.equal(orphanedProposal.payoutAmountIntegrity, true);
    assert.deepEqual(await fetchExecutions(), {
      proposalPublicKey,
      limit: 20,
      offset: 0,
      total: 0,
      items: [],
      nextOffset: null,
    });
  });

  it("rejects invalid lifecycle filters", async () => {
    const port = await getAvailablePort();
    dataSource = createInMemoryDataSource("public", [
      ProposalEntity,
      ProposalExecutionEntity,
      VoteEntity,
      VoteNullifierEntity,
      VoteTallyEntity,
    ]);
    repository = new EventsRepository(dataSource, "public", {
      knownEventTypes: ["proposalCreated"],
    });
    await repository.initialize();
    await dataSource.synchronize();

    server = new EventsApiServer(repository, {
      port,
      pageLimitDefault: 20,
      pageLimitMax: 50,
      registerRoutes: createProposalListRoutes({
        dataSource,
      }),
    });
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${port}/proposals?lifecycleId=current`,
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "lifecycleId must be a non-negative integer",
    });

    const partialLimitResponse = await fetch(
      `http://127.0.0.1:${port}/proposals?limit=10items`,
    );
    assert.equal(partialLimitResponse.status, 400);
    assert.deepEqual(await partialLimitResponse.json(), {
      error: "limit must be a positive integer",
    });

    const unsafeLifecycleResponse = await fetch(
      `http://127.0.0.1:${port}/proposals?lifecycleId=9007199254740992`,
    );
    assert.equal(unsafeLifecycleResponse.status, 400);
    assert.deepEqual(await unsafeLifecycleResponse.json(), {
      error: "lifecycleId must be a non-negative integer",
    });
  });

  it("supports server-side sorting for the proposal list route", async () => {
    const port = await getAvailablePort();
    dataSource = createInMemoryDataSource("public", [
      ProposalEntity,
      ProposalExecutionEntity,
      VoteEntity,
      VoteNullifierEntity,
      VoteTallyEntity,
    ]);
    repository = new EventsRepository(dataSource, "public", {
      knownEventTypes: ["proposalCreated"],
    });
    await repository.initialize();
    await dataSource.synchronize();

    await dataSource.getRepository(ProposalEntity).insert([
      {
        proposalPublicKey: "B62qproposal-zeta",
        lifecycleId: 7,
        amount: "900000",
        recipient: "B62qrecipient-zeta",
        zkAppUriHash: "hash-zeta",
        status: "pending",
        isPaused: false,
        contents: "# Zeta proposal",
      },
      {
        proposalPublicKey: "B62qproposal-alpha",
        lifecycleId: 7,
        amount: "100000",
        recipient: "B62qrecipient-alpha",
        senderPublicKey: "B62q-alpha",
        zkAppUriHash: "hash-alpha",
        status: "pending",
        isPaused: false,
        contents: "# Alpha proposal",
      },
      {
        proposalPublicKey: "B62qproposal-beta",
        lifecycleId: 7,
        amount: "500000",
        recipient: "B62qrecipient-beta",
        senderPublicKey: "B62q-beta",
        zkAppUriHash: "hash-beta",
        status: "pending",
        isPaused: false,
        contents: "# Beta proposal",
      },
    ]);

    server = new EventsApiServer(repository, {
      port,
      pageLimitDefault: 20,
      pageLimitMax: 50,
      registerRoutes: createProposalListRoutes({
        dataSource,
      }),
    });
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${port}/proposals?lifecycleId=7&sort=senderPublicKey,ASC&limit=3&offset=0`,
    );
    assert.equal(response.status, 200);

    const payload = (await response.json()) as {
      items: Array<{ proposalPublicKey: string }>;
    };

    assert.deepEqual(
      payload.items.map((item) => item.proposalPublicKey),
      ["B62qproposal-zeta", "B62qproposal-alpha", "B62qproposal-beta"],
    );
  });

  it("lists scoped vote rows for a proposal", async () => {
    const port = await getAvailablePort();
    dataSource = createInMemoryDataSource("public", [
      ProposalEntity,
      ProposalExecutionEntity,
      VoteEntity,
      VoteNullifierEntity,
      VoteTallyEntity,
    ]);
    repository = new EventsRepository(dataSource, "public", {
      knownEventTypes: ["proposalCreated"],
    });
    await repository.initialize();
    await dataSource.synchronize();

    await dataSource.getRepository(ProposalEntity).insert({
      proposalPublicKey: "B62qproposal-votes",
      lifecycleId: 7,
      amount: "840000",
      recipient: "B62qrecipient-votes",
      zkAppUriHash: "hash-votes",
      status: "pending",
      isPaused: false,
      contents: "# Votes proposal",
    });

    await dataSource.getRepository(VoteTallyEntity).insert([
      {
        proposalPublicKey: "B62qproposal-votes",
        blockHeight: 510,
        yayWeight: "300000",
        nayWeight: "120000",
        abstainWeight: "10000",
        requiredParticipationBp: "3000",
        requiredApprovalBp: "5000",
        requiredParticipation: "258000",
        totalParticipatingVotes: "430000",
        approvalBp: "7142",
        voteResult: "approved",
        createdByEventType: "proposalVotesTallied",
      },
      {
        proposalPublicKey: "B62qproposal-votes",
        blockHeight: 509,
        yayWeight: "300000",
        nayWeight: "90000",
        abstainWeight: "0",
        requiredParticipationBp: "3000",
        requiredApprovalBp: "5000",
        requiredParticipation: "258000",
        totalParticipatingVotes: "390000",
        approvalBp: "7692",
        voteResult: "approved",
        createdByEventType: "proposalVoteDispatched",
      },
    ]);

    await dataSource.getRepository(VoteEntity).insert([
      {
        archiveEventId: "vote-1",
        proposalPublicKey: "B62qproposal-votes",
        voterPublicKey: "B62qvoter-1",
        vote: "yay",
        voteWeight: "300000",
        blockHeight: 510,
        blockEventIndex: 1,
        isNullified: false,
        status: "canonical",
      },
      {
        archiveEventId: "vote-2",
        proposalPublicKey: "B62qproposal-votes",
        voterPublicKey: "B62qvoter-2",
        vote: "nay",
        voteWeight: "120000",
        blockHeight: 510,
        blockEventIndex: 2,
        isNullified: true,
        status: "canonical",
      },
      {
        archiveEventId: "vote-3",
        proposalPublicKey: "B62qproposal-votes",
        voterPublicKey: "B62qvoter-3",
        vote: "abstain",
        voteWeight: "10000",
        blockHeight: 510,
        blockEventIndex: 3,
        isNullified: false,
        status: "orphaned",
      },
      {
        archiveEventId: "vote-4",
        proposalPublicKey: "B62qproposal-votes",
        voterPublicKey: "B62qvoter-4",
        vote: "nay",
        voteWeight: "90000",
        blockHeight: 510,
        blockEventIndex: 0,
        isNullified: false,
        status: "canonical",
      },
      {
        archiveEventId: "vote-5",
        proposalPublicKey: "B62qproposal-votes",
        voterPublicKey: "B62qvoter-5",
        vote: "yay",
        voteWeight: "0",
        blockHeight: 508,
        blockEventIndex: 1,
        isNullified: true,
        status: "canonical",
      },
      {
        archiveEventId: "vote-pending",
        proposalPublicKey: "B62qproposal-votes",
        voterPublicKey: "B62qvoter-pending",
        vote: "yay",
        voteWeight: "80000",
        blockHeight: 508,
        blockEventIndex: 0,
        isNullified: false,
        status: "pending",
      },
    ]);

    server = new EventsApiServer(repository, {
      port,
      pageLimitDefault: 20,
      pageLimitMax: 50,
      registerRoutes: createProposalListRoutes({
        dataSource,
        pageLimitDefault: 1,
        pageLimitMax: 10,
      }),
    });
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${port}/proposals/B62qproposal-votes/votes?limit=1&offset=0`,
    );
    assert.equal(response.status, 200);

    const payload = (await response.json()) as {
      proposalPublicKey: string;
      limit: number;
      offset: number;
      total: number;
      nextOffset: number | null;
      items: Array<{
        id: string;
        proposalPublicKey: string;
        voterPublicKey: string;
        vote: string;
        voteWeight: string;
        blockHeight: number | null;
        blockEventIndex: number;
        isNullified: boolean;
        status: string;
        createdAt: string | null;
      }>;
    };

    assert.equal(payload.proposalPublicKey, "B62qproposal-votes");
    assert.equal(payload.limit, 1);
    assert.equal(payload.offset, 0);
    assert.equal(payload.total, 3);
    assert.equal(payload.nextOffset, 1);
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0]?.proposalPublicKey, "B62qproposal-votes");
    assert.equal(payload.items[0]?.voterPublicKey, "B62qvoter-1");
    assert.equal(payload.items[0]?.vote, "yay");
    assert.equal(payload.items[0]?.voteWeight, "300000");
    assert.equal(payload.items[0]?.blockHeight, 510);
    assert.equal(payload.items[0]?.blockEventIndex, 1);
    assert.equal(payload.items[0]?.isNullified, false);
    assert.equal(payload.items[0]?.status, "canonical");
    assert.equal(typeof payload.items[0]?.id, "string");
    assert.equal(typeof payload.items[0]?.createdAt, "string");

    const secondPageResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/B62qproposal-votes/votes?limit=1&offset=1`,
    );
    const secondPage = (await secondPageResponse.json()) as typeof payload;
    assert.equal(secondPage.items[0]?.voterPublicKey, "B62qvoter-4");
    assert.equal(secondPage.items[0]?.blockEventIndex, 0);
    assert.equal(secondPage.nextOffset, 2);

    const pendingPageResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/B62qproposal-votes/votes?limit=1&offset=2`,
    );
    const pendingPage = (await pendingPageResponse.json()) as typeof payload;
    assert.equal(pendingPage.items[0]?.voterPublicKey, "B62qvoter-pending");
    assert.equal(pendingPage.items[0]?.voteWeight, "80000");
    assert.equal(pendingPage.items[0]?.isNullified, false);
    assert.equal(pendingPage.items[0]?.status, "pending");
    assert.equal(pendingPage.nextOffset, null);

    const invalidResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/B62qproposal-votes/votes?limit=0`,
    );
    assert.equal(invalidResponse.status, 400);
  });

  it("lists scoped execution rows for a proposal", async () => {
    const port = await getAvailablePort();
    dataSource = createInMemoryDataSource("public", [
      ProposalEntity,
      ProposalExecutionEntity,
      VoteEntity,
      VoteNullifierEntity,
      VoteTallyEntity,
    ]);
    repository = new EventsRepository(dataSource, "public", {
      knownEventTypes: ["proposalCreated"],
    });
    await repository.initialize();
    await dataSource.synchronize();

    await dataSource.getRepository(ProposalEntity).insert({
      proposalPublicKey: "B62qproposal-executions",
      lifecycleId: 7,
      amount: "840000",
      recipient: "B62qrecipient-executions",
      zkAppUriHash: "hash-executions",
      status: "approved",
      isPaused: false,
      contents: "# Executions proposal",
    });

    await dataSource.getRepository(ProposalExecutionEntity).insert([
      {
        archiveEventId: "execution-1",
        proposalPublicKey: "B62qproposal-executions",
        lifecycleId: 7,
        recipient: "B62qrecipient-executions",
        amountToPayOut: "5000000000",
        proposalAmount: "8400000000",
        bondAmount: "840000000",
        senderPublicKey: "B62qexecutor-1",
        paidOutAmount: "5000000000",
        remainingAmount: "3400000000",
        blockHeight: 600,
        blockEventIndex: 1,
        status: "canonical",
      },
      {
        archiveEventId: "execution-2",
        proposalPublicKey: "B62qproposal-executions",
        lifecycleId: 7,
        recipient: "B62qrecipient-executions",
        amountToPayOut: "1000000000",
        proposalAmount: "8400000000",
        bondAmount: "840000000",
        senderPublicKey: "B62qexecutor-2",
        paidOutAmount: "6000000000",
        remainingAmount: "2400000000",
        blockHeight: 599,
        blockEventIndex: 0,
        status: "orphaned",
      },
      {
        archiveEventId: "execution-3",
        proposalPublicKey: "B62qproposal-executions",
        lifecycleId: 7,
        recipient: "B62qrecipient-executions",
        amountToPayOut: "500000000",
        proposalAmount: "8400000000",
        bondAmount: "840000000",
        senderPublicKey: "B62qexecutor-3",
        paidOutAmount: "5500000000",
        remainingAmount: "2900000000",
        blockHeight: 600,
        blockEventIndex: 0,
        status: "canonical",
      },
    ]);

    server = new EventsApiServer(repository, {
      port,
      pageLimitDefault: 20,
      pageLimitMax: 50,
      registerRoutes: createProposalListRoutes({
        dataSource,
        pageLimitDefault: 1,
        pageLimitMax: 10,
      }),
    });
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${port}/proposals/B62qproposal-executions/executions?limit=1&offset=0`,
    );
    assert.equal(response.status, 200);

    const payload = (await response.json()) as {
      proposalPublicKey: string;
      limit: number;
      offset: number;
      total: number;
      nextOffset: number | null;
      items: Array<{
        id: string;
        proposalPublicKey: string;
        recipient: string;
        amountToPayOut: string;
        bondAmount: string;
        senderPublicKey: string;
        paidOutAmount: string;
        remainingAmount: string;
        blockHeight: number | null;
        blockEventIndex: number;
        status: string;
        createdAt: string | null;
      }>;
    };

    assert.equal(payload.proposalPublicKey, "B62qproposal-executions");
    assert.equal(payload.limit, 1);
    assert.equal(payload.offset, 0);
    assert.equal(payload.total, 2);
    assert.equal(payload.nextOffset, 1);
    assert.equal(payload.items.length, 1);
    assert.equal(
      payload.items[0]?.proposalPublicKey,
      "B62qproposal-executions",
    );
    assert.equal(payload.items[0]?.recipient, "B62qrecipient-executions");
    assert.equal(payload.items[0]?.amountToPayOut, "5000000000");
    assert.equal(payload.items[0]?.bondAmount, "840000000");
    assert.equal(payload.items[0]?.senderPublicKey, "B62qexecutor-1");
    assert.equal(payload.items[0]?.paidOutAmount, "5000000000");
    assert.equal(payload.items[0]?.remainingAmount, "3400000000");
    assert.equal(payload.items[0]?.blockHeight, 600);
    assert.equal(payload.items[0]?.blockEventIndex, 1);
    assert.equal(payload.items[0]?.status, "canonical");
    assert.equal(typeof payload.items[0]?.id, "string");
    assert.equal(typeof payload.items[0]?.createdAt, "string");

    const secondPageResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/B62qproposal-executions/executions?limit=1&offset=1`,
    );
    const secondPage = (await secondPageResponse.json()) as typeof payload;
    assert.equal(secondPage.items[0]?.senderPublicKey, "B62qexecutor-3");
    assert.equal(secondPage.items[0]?.blockEventIndex, 0);
    assert.equal(secondPage.nextOffset, null);

    const invalidResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/B62qproposal-executions/executions?offset=-1`,
    );
    assert.equal(invalidResponse.status, 400);
  });
});
