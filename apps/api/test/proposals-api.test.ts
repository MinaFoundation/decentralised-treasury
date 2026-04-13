import assert from "node:assert/strict";
import { createServer } from "node:net";
import { afterEach, describe, it } from "node:test";
import { EventsApiServer, EventsRepository } from "@repo/indexer";
import type { DataSource } from "typeorm";
import { createProposalListRoutes } from "../src/proposal-list-routes.js";
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
        status: "pending",
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
        status: "approved",
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
        isPaused: true,
        contents: "# Paused proposal\n\nSecond row for pagination.",
        createdAtBlockHeight: 499,
        createdAtBlockTimestamp: new Date("2026-04-05T12:00:00.000Z"),
      },
    ]);
    await dataSource.getRepository(VoteTallyEntity).insert([
      {
        proposalPublicKey: "B62qproposal-current",
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
        proposalPublicKey: "B62qproposal-current",
        blockHeight: 509,
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
        proposalPublicKey: string;
        lifecycleId: number;
        amount: string;
        isPaused: boolean;
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
    assert.equal(payload.items[0]?.latestVoteTally?.blockHeight, 510);
    assert.equal(payload.items[0]?.latestVoteTally?.voteResult, "approved");
    assert.equal(payload.items[0]?.latestVoteTally?.approvalBp, "7142");
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

    await dataSource.getRepository(VoteTallyEntity).insert({
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
    });

    await dataSource.getRepository(VoteEntity).insert([
      {
        archiveEventId: "vote-1",
        proposalPublicKey: "B62qproposal-votes",
        voterPublicKey: "B62qvoter-1",
        vote: "yay",
        voteWeight: "300000",
        blockHeight: 510,
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
        isNullified: false,
        status: "orphaned",
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
      `http://127.0.0.1:${port}/proposals/B62qproposal-votes/votes`,
    );
    assert.equal(response.status, 200);

    const payload = (await response.json()) as {
      proposalPublicKey: string;
      items: Array<{
        id: string;
        proposalPublicKey: string;
        voterPublicKey: string;
        vote: string;
        voteWeight: string;
        blockHeight: number | null;
        isNullified: boolean;
        status: string;
        createdAt: string | null;
      }>;
    };

    assert.equal(payload.proposalPublicKey, "B62qproposal-votes");
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0]?.proposalPublicKey, "B62qproposal-votes");
    assert.equal(payload.items[0]?.voterPublicKey, "B62qvoter-1");
    assert.equal(payload.items[0]?.vote, "yay");
    assert.equal(payload.items[0]?.voteWeight, "300000");
    assert.equal(payload.items[0]?.blockHeight, 510);
    assert.equal(payload.items[0]?.isNullified, false);
    assert.equal(payload.items[0]?.status, "canonical");
    assert.equal(typeof payload.items[0]?.id, "string");
    assert.equal(typeof payload.items[0]?.createdAt, "string");
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
        status: "orphaned",
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
      `http://127.0.0.1:${port}/proposals/B62qproposal-executions/executions`,
    );
    assert.equal(response.status, 200);

    const payload = (await response.json()) as {
      proposalPublicKey: string;
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
        status: string;
        createdAt: string | null;
      }>;
    };

    assert.equal(payload.proposalPublicKey, "B62qproposal-executions");
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0]?.proposalPublicKey, "B62qproposal-executions");
    assert.equal(payload.items[0]?.recipient, "B62qrecipient-executions");
    assert.equal(payload.items[0]?.amountToPayOut, "5000000000");
    assert.equal(payload.items[0]?.bondAmount, "840000000");
    assert.equal(payload.items[0]?.senderPublicKey, "B62qexecutor-1");
    assert.equal(payload.items[0]?.paidOutAmount, "5000000000");
    assert.equal(payload.items[0]?.remainingAmount, "3400000000");
    assert.equal(payload.items[0]?.blockHeight, 600);
    assert.equal(payload.items[0]?.status, "canonical");
    assert.equal(typeof payload.items[0]?.id, "string");
    assert.equal(typeof payload.items[0]?.createdAt, "string");
  });
});
