import assert from "node:assert/strict";
import { createServer } from "node:net";
import { afterEach, describe, it } from "node:test";
import { EventsApiServer, EventsRepository } from "@repo/indexer";
import type { DataSource } from "typeorm";
import { createProcessorCrudRoutes } from "../src/processor-crud-routes.js";
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

describe("processor CRUD routes on main API", () => {
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

  it("serves projection rows under /processor with joins", async () => {
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
      proposalPublicKey: "B62qproposal-1",
      lifecycleId: 7,
      amount: "840000",
      recipient: "B62qrecipient-1",
      senderPublicKey: "B62qsender-1",
      zkAppUriHash: "hash-1",
      status: "pending",
      isPaused: false,
      paidOutAmount: "0",
      contents: "# Proposal",
      createdAtBlockHeight: 500,
      createdAtBlockTimestamp: new Date("2026-04-08T10:00:00.000Z"),
    });
    await dataSource.getRepository(VoteTallyEntity).insert({
      proposalPublicKey: "B62qproposal-1",
      blockHeight: 501,
      yayWeight: "10",
      nayWeight: "2",
      abstainWeight: "1",
      requiredParticipationBp: "3000",
      requiredApprovalBp: "5000",
      requiredParticipation: "9",
      totalParticipatingVotes: "13",
      approvalBp: "8333",
      voteResult: "approved",
      createdByEventType: "proposalVotesTallied",
    });
    await dataSource.getRepository(VoteEntity).insert({
      archiveEventId: "archive-vote-1",
      proposalPublicKey: "B62qproposal-1",
      voterPublicKey: "B62qvoter-1",
      vote: "yay",
      voteWeight: "10",
      blockHeight: 501,
      isNullified: false,
      status: "canonical",
    });
    await dataSource.getRepository(VoteNullifierEntity).insert({
      sourceEventId: "archive-nullifier-1",
      proposalPublicKey: "B62qproposal-1",
      voterPublicKey: "B62qvoter-2",
      vote: "nay",
      voteWeight: "2",
      blockHeight: 501,
    });
    await dataSource.getRepository(ProposalExecutionEntity).insert({
      archiveEventId: "archive-execution-1",
      proposalPublicKey: "B62qproposal-1",
      lifecycleId: 7,
      recipient: "B62qrecipient-1",
      amountToPayOut: "840000",
      proposalAmount: "840000",
      bondAmount: "0",
      senderPublicKey: "B62qsender-1",
      paidOutAmount: "840000",
      remainingAmount: "0",
      blockHeight: 520,
      status: "canonical",
    });

    server = new EventsApiServer(repository, {
      port,
      pageLimitDefault: 50,
      pageLimitMax: 200,
      registerRoutes: createProcessorCrudRoutes({
        dataSource,
      }),
    });
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${port}/proposals?join=voteTallies&join=voteTallies.votes&join=voteTallies.nullifiers&join=executions&sort=proposalPublicKey,ASC&limit=10`,
    );
    assert.equal(response.status, 200);

    const payload = (await response.json()) as {
      data: Array<{
        proposalPublicKey: string;
        voteTallies: Array<{
          blockHeight: number;
          votes: Array<{ voterPublicKey: string }>;
          nullifiers: Array<{ voterPublicKey: string }>;
        }>;
        executions: Array<{ remainingAmount: string }>;
      }>;
      count: number;
      total: number;
      page: number;
      pageCount: number;
    };

    assert.equal(payload.count, 1);
    assert.equal(payload.total, 1);
    assert.equal(payload.page, 1);
    assert.equal(payload.pageCount, 1);
    assert.equal(payload.data[0]?.proposalPublicKey, "B62qproposal-1");
    assert.equal(payload.data[0]?.voteTallies.length, 1);
    assert.equal(payload.data[0]?.voteTallies[0]?.blockHeight, 501);
    assert.equal(payload.data[0]?.voteTallies[0]?.votes[0]?.voterPublicKey, "B62qvoter-1");
    assert.equal(
      payload.data[0]?.voteTallies[0]?.nullifiers[0]?.voterPublicKey,
      "B62qvoter-2",
    );
    assert.equal(payload.data[0]?.executions[0]?.remainingAmount, "0");

    const healthzResponse = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(healthzResponse.status, 200);
    assert.deepEqual(await healthzResponse.json(), { ok: true });
  });
});
