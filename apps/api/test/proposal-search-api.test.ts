import assert from "node:assert/strict";
import { createServer } from "node:net";
import { afterEach, describe, it } from "node:test";
import { EventsApiServer, EventsRepository } from "@repo/indexer";
import type { DataSource } from "typeorm";
import {
  createProposalSearchRoutes,
  PROPOSAL_SEARCH_QUERY_REQUIRED_ERROR,
} from "../src/proposal-search-routes.js";
import { ProposalExecutionEntity } from "../src/processors/proposals/proposal-execution-entity.js";
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

describe("proposal search endpoint", () => {
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

  it("qualifies search queries with the configured database schema", async () => {
    const statements: string[] = [];
    const fakeDataSource = {
      options: { schema: "public" },
      query: async (statement: string) => {
        statements.push(statement);
        return [];
      },
    } as unknown as DataSource;
    let searchHandler:
      | ((request: unknown, response: unknown) => Promise<void>)
      | undefined;
    const app = {
      get: (path: string, handler: typeof searchHandler) => {
        if (path === "/proposals/search") {
          searchHandler = handler;
        }
      },
    };
    createProposalSearchRoutes({
      dataSource: fakeDataSource,
      databaseSchema: "tenant_api",
    })(app as never);
    let payload: unknown;
    await searchHandler?.(
      { query: { q: "treasury" } },
      {
        json: (value: unknown) => {
          payload = value;
        },
      },
    );

    assert.deepEqual(payload, {
      query: "treasury",
      limit: 20,
      offset: 0,
      items: [],
      nextOffset: null,
    });
    assert.equal(statements.length, 1);
    assert.match(
      statements[0] ?? "",
      /FROM "tenant_api"\."processor_proposals" p/,
    );
  });

  it("orders fallback search results by exact bigint ID", async () => {
    const now = new Date(Date.UTC(2026, 0, 1));
    const rows = ["9007199254740992", "9007199254740993"].map((id) => ({
      id,
      proposal_public_key: `proposal-${id}`,
      lifecycle_id: 1,
      amount: "1",
      recipient: "recipient-bigint-order",
      sender_public_key: null,
      zkapp_uri_hash: `hash-${id}`,
      staking_epoch_data_ledger_hash: null,
      staking_epoch_data_ledger_total_currency: null,
      required_participation_bp: null,
      required_approval_bp: null,
      required_participation: null,
      status: "canonical",
      contract_status: "unknown",
      contract_status_finality: "canonical",
      contract_status_source_event_id: null,
      contract_status_block_height: null,
      creation_observation_status: "canonical",
      is_paused: false,
      paid_out_amount: "0",
      contents: "Bigint order",
      created_at_block_height: 20,
      created_at_block_timestamp: null,
      created_at: now,
      updated_at: now,
    }));
    let queryCount = 0;
    const fakeDataSource = {
      options: { schema: "public" },
      query: async () => {
        queryCount += 1;
        if (queryCount === 1) {
          throw new Error("to_tsvector is not supported");
        }
        return queryCount === 2 ? rows : [];
      },
    } as unknown as DataSource;
    let searchHandler:
      | ((request: unknown, response: unknown) => Promise<void>)
      | undefined;
    createProposalSearchRoutes({ dataSource: fakeDataSource })({
      get: (path: string, handler: typeof searchHandler) => {
        if (path === "/proposals/search") {
          searchHandler = handler;
        }
      },
    } as never);
    let payload: { items: Array<{ id: string }> } | undefined;
    await searchHandler?.(
      { query: { q: "recipient-bigint-order" } },
      {
        json: (value: typeof payload) => {
          payload = value;
        },
      },
    );

    assert.deepEqual(
      payload?.items.map((item) => item.id),
      ["9007199254740993", "9007199254740992"],
    );
  });

  it("searches proposal contents and structured fields", async () => {
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
        proposalPublicKey: "proposal-ecosystem-alpha",
        lifecycleId: 7,
        amount: "1000",
        recipient: "recipient-alpha",
        zkAppUriHash: "hash-alpha",
        status: "pending",
        creationObservationStatus: "pending",
        contractStatus: "unknown",
        contractStatusFinality: "pending",
        isPaused: false,
        paidOutAmount: "0",
        contents: "# Ecosystem Grant\n\nFunds wallet tooling and docs.",
        createdAtBlockHeight: 101,
        createdAtBlockTimestamp: new Date(Date.UTC(2026, 0, 1)),
      },
      {
        proposalPublicKey: "proposal-beta",
        lifecycleId: 8,
        amount: "2500",
        recipient: "recipient-beta-target",
        zkAppUriHash: "hash-beta",
        status: "canonical",
        creationObservationStatus: "canonical",
        contractStatus: "paused",
        contractStatusFinality: "canonical",
        contractStatusSourceEventId: "pause-beta",
        contractStatusBlockHeight: 122,
        isPaused: true,
        paidOutAmount: "1000",
        contents: "Expands validator infra capacity.",
        createdAtBlockHeight: 102,
        createdAtBlockTimestamp: new Date(Date.UTC(2026, 0, 2)),
      },
      {
        proposalPublicKey: "proposal-gamma",
        lifecycleId: 9,
        amount: "3000",
        recipient: "recipient-gamma",
        zkAppUriHash: "hash-gamma",
        status: "canonical",
        creationObservationStatus: "canonical",
        contractStatus: "rejected",
        contractStatusFinality: "canonical",
        isPaused: false,
        paidOutAmount: "0",
        contents: "Community translation effort.",
        createdAtBlockHeight: 103,
        createdAtBlockTimestamp: new Date(Date.UTC(2026, 0, 3)),
      },
    ]);
    await dataSource.getRepository(VoteTallyEntity).insert([
      {
        archiveEventId: "vote-beta",
        proposalPublicKey: "proposal-beta",
        blockHeight: 120,
        blockEventIndex: 0,
        sourceStatus: "canonical",
        yayWeight: "8",
        nayWeight: "4",
        abstainWeight: "1",
        voteResult: "rejected",
        createdByEventType: "proposalVoteDispatched",
      },
      {
        archiveEventId: "tally-beta",
        proposalPublicKey: "proposal-beta",
        blockHeight: 121,
        blockEventIndex: 0,
        sourceStatus: "canonical",
        yayWeight: "9",
        nayWeight: "4",
        abstainWeight: "1",
        voteResult: "approved",
        createdByEventType: "proposalVotesTallied",
        requiredParticipationBp: "2000",
        requiredApprovalBp: "5100",
        requiredParticipation: "14",
        totalParticipatingVotes: "14",
        approvalBp: "6428",
      },
    ]);

    server = new EventsApiServer(repository, {
      port,
      pageLimitDefault: 2,
      pageLimitMax: 5,
      registerRoutes: createProposalSearchRoutes({
        dataSource,
        pageLimitDefault: 2,
        pageLimitMax: 5,
      }),
    });
    await server.start();

    const contentResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/search?q=${encodeURIComponent("ecosystem")}`,
    );
    assert.equal(contentResponse.status, 200);
    const contentPayload = (await contentResponse.json()) as {
      items: Array<{
        proposalPublicKey: string;
        contents: string | null;
        searchRank: number;
      }>;
      nextOffset: number | null;
    };
    assert.equal(contentPayload.items.length, 1);
    assert.equal(
      contentPayload.items[0]?.proposalPublicKey,
      "proposal-ecosystem-alpha",
    );
    assert.match(contentPayload.items[0]?.contents ?? "", /Ecosystem Grant/);
    assert.equal(typeof contentPayload.items[0]?.searchRank, "number");
    assert.equal(contentPayload.nextOffset, null);

    const fieldResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/search?q=${encodeURIComponent("recipient-beta-target")}`,
    );
    assert.equal(fieldResponse.status, 200);
    const fieldPayload = (await fieldResponse.json()) as {
      items: Array<{
        proposalPublicKey: string;
        recipient: string;
        amount: string;
        isPaused: boolean;
        contractStatus: string;
        contractStatusFinality: string;
        totalPayoutAmount: string;
        remainingPayoutAmount: string;
        finalVoteTally: unknown;
        historicalFinalVoteTally: {
          blockHeight: number;
          sourceStatus: string;
        } | null;
        latestVoteTally: {
          blockHeight: number;
          voteResult: string | null;
          createdByEventType: string | null;
        } | null;
      }>;
    };
    assert.equal(fieldPayload.items.length, 1);
    assert.equal(fieldPayload.items[0]?.proposalPublicKey, "proposal-beta");
    assert.equal(fieldPayload.items[0]?.recipient, "recipient-beta-target");
    assert.equal(fieldPayload.items[0]?.isPaused, true);
    assert.equal(fieldPayload.items[0]?.contractStatus, "paused");
    assert.equal(fieldPayload.items[0]?.contractStatusFinality, "canonical");
    assert.equal(fieldPayload.items[0]?.totalPayoutAmount, "2750");
    assert.equal(fieldPayload.items[0]?.remainingPayoutAmount, "1750");
    assert.equal(fieldPayload.items[0]?.finalVoteTally, null);
    assert.equal(
      fieldPayload.items[0]?.historicalFinalVoteTally?.blockHeight,
      121,
    );
    assert.equal(
      fieldPayload.items[0]?.historicalFinalVoteTally?.sourceStatus,
      "canonical",
    );
    assert.deepEqual(fieldPayload.items[0]?.latestVoteTally, {
      blockHeight: 121,
      yayWeight: "9",
      nayWeight: "4",
      abstainWeight: "1",
      createdByEventType: "proposalVotesTallied",
      requiredParticipationBp: "2000",
      requiredApprovalBp: "5100",
      requiredParticipation: "14",
      totalParticipatingVotes: "14",
      approvalBp: "6428",
      voteResult: "approved",
    });

    const numericFieldResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/search?q=${encodeURIComponent("2500")}`,
    );
    assert.equal(numericFieldResponse.status, 200);
    const numericFieldPayload = (await numericFieldResponse.json()) as {
      items: Array<{ proposalPublicKey: string; amount: string }>;
    };
    assert.equal(numericFieldPayload.items.length, 1);
    assert.equal(
      numericFieldPayload.items[0]?.proposalPublicKey,
      "proposal-beta",
    );
    assert.equal(numericFieldPayload.items[0]?.amount, "2500");
  });

  it("paginates results and validates query params", async () => {
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
        proposalPublicKey: "proposal-search-a",
        lifecycleId: 1,
        amount: "100",
        recipient: "recipient-search",
        zkAppUriHash: "hash-search-a",
        status: "pending",
        isPaused: false,
        paidOutAmount: "0",
        contents: "Search result A",
        createdAtBlockHeight: 11,
        createdAtBlockTimestamp: new Date(Date.UTC(2026, 0, 1)),
      },
      {
        proposalPublicKey: "proposal-search-b",
        lifecycleId: 1,
        amount: "200",
        recipient: "recipient-search",
        zkAppUriHash: "hash-search-b",
        status: "pending",
        isPaused: false,
        paidOutAmount: "0",
        contents: "Search result B",
        createdAtBlockHeight: 12,
        createdAtBlockTimestamp: new Date(Date.UTC(2026, 0, 2)),
      },
      {
        proposalPublicKey: "proposal-search-c",
        lifecycleId: 1,
        amount: "300",
        recipient: "recipient-search",
        zkAppUriHash: "hash-search-c",
        status: "pending",
        isPaused: false,
        paidOutAmount: "0",
        contents: "Search result C",
        createdAtBlockHeight: 13,
        createdAtBlockTimestamp: new Date(Date.UTC(2026, 0, 3)),
      },
    ]);

    server = new EventsApiServer(repository, {
      port,
      pageLimitDefault: 2,
      pageLimitMax: 3,
      registerRoutes: createProposalSearchRoutes({
        dataSource,
        pageLimitDefault: 2,
        pageLimitMax: 3,
      }),
    });
    await server.start();

    const pagedResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/search?q=${encodeURIComponent("recipient-search")}&limit=2`,
    );
    assert.equal(pagedResponse.status, 200);
    const pagedPayload = (await pagedResponse.json()) as {
      limit: number;
      offset: number;
      nextOffset: number | null;
      items: Array<{ proposalPublicKey: string }>;
    };
    assert.equal(pagedPayload.limit, 2);
    assert.equal(pagedPayload.offset, 0);
    assert.equal(pagedPayload.items.length, 2);
    assert.equal(pagedPayload.nextOffset, 2);
    assert.deepEqual(
      pagedPayload.items.map((item) => item.proposalPublicKey),
      ["proposal-search-c", "proposal-search-b"],
    );

    const secondPageResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/search?q=${encodeURIComponent("recipient-search")}&limit=2&offset=2`,
    );
    assert.equal(secondPageResponse.status, 200);
    const secondPagePayload = (await secondPageResponse.json()) as {
      items: Array<{ proposalPublicKey: string }>;
      nextOffset: number | null;
    };
    assert.deepEqual(
      secondPagePayload.items.map((item) => item.proposalPublicKey),
      ["proposal-search-a"],
    );
    assert.equal(secondPagePayload.nextOffset, null);

    const missingQueryResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/search`,
    );
    assert.equal(missingQueryResponse.status, 400);
    assert.deepEqual(await missingQueryResponse.json(), {
      error: PROPOSAL_SEARCH_QUERY_REQUIRED_ERROR,
    });

    const invalidOffsetResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/search?q=${encodeURIComponent("search")}&offset=-1`,
    );
    assert.equal(invalidOffsetResponse.status, 400);
    assert.deepEqual(await invalidOffsetResponse.json(), {
      error: "offset must be a non-negative integer",
    });

    const partialLimitResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/search?q=search&limit=2rows`,
    );
    assert.equal(partialLimitResponse.status, 400);
    assert.deepEqual(await partialLimitResponse.json(), {
      error: "limit must be a positive integer",
    });
  });
});
