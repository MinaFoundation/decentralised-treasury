import assert from "node:assert/strict";
import { createServer } from "node:net";
import { afterEach, describe, it } from "node:test";
import { EventsApiServer, EventsRepository } from "@repo/indexer";
import type { DataSource } from "typeorm";
import {
  createProposalContentRoutes,
  PROPOSAL_CONTENT_EXPLICIT_LANGUAGE_ERROR,
  PROPOSAL_CONTENT_PROPOSAL_NOT_FOUND_ERROR,
  PROPOSAL_CONTENT_REQUIRED_ERROR,
  PROPOSAL_CONTENT_TOO_LARGE_ERROR,
} from "../src/proposal-content-routes.js";
import { ProposalContentEntity } from "../src/processors/proposals/proposal-content-entity.js";
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

describe("proposal content endpoint", () => {
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

  it("qualifies both atomic content tables with the configured schema", async () => {
    type ProposalContentRow = { proposal_public_key: string };
    const statements: string[] = [];
    const fakeDataSource = {
      options: { schema: "public" },
      transaction: async (
        callback: (manager: {
          query: (statement: string) => Promise<ProposalContentRow[]>;
        }) => Promise<unknown>,
      ) =>
        await callback({
          query: async (statement: string) => {
            statements.push(statement);
            if (statement.includes("SELECT") || statement.includes("UPDATE")) {
              return [{ proposal_public_key: "proposal-key" }];
            }
            return [];
          },
        }),
    } as unknown as DataSource;
    let contentHandler:
      | ((request: unknown, response: unknown) => Promise<void>)
      | undefined;
    const app = {
      post: (path: string, handler: typeof contentHandler) => {
        if (path === "/proposals/:id/content") {
          contentHandler = handler;
        }
      },
    };
    createProposalContentRoutes({
      dataSource: fakeDataSource,
      databaseSchema: "tenant_api",
      containsExplicitLanguage: () => false,
      hashMarkdownToProposalZkAppUriHash: async () => ({
        zkAppUri: "urn:test",
        zkAppUriHash: "content-hash",
      }),
    })(app as never);
    let statusCode = 200;
    let payload: unknown;
    await contentHandler?.(
      { params: { id: "proposal-key" }, body: { contents: "# Proposal" } },
      {
        status: (value: number) => {
          statusCode = value;
          return {
            json: (body: unknown) => {
              payload = body;
            },
          };
        },
        json: (body: unknown) => {
          payload = body;
        },
      },
    );

    assert.equal(statusCode, 200);
    assert.deepEqual(payload, {
      ok: true,
      contentChars: 10,
      proposalPublicKey: "proposal-key",
      zkAppUri: "urn:test",
      zkAppUriHash: "content-hash",
    });
    assert.equal(statements.length, 3);
    assert.match(
      statements[0] ?? "",
      /FROM "tenant_api"\."processor_proposals"/,
    );
    assert.match(
      statements[1] ?? "",
      /INSERT INTO "tenant_api"\."processor_proposal_contents"/,
    );
    assert.match(
      statements[2] ?? "",
      /UPDATE "tenant_api"\."processor_proposals"/,
    );
  });

  it("verifies markdown profanity with the same submission rules", async () => {
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
      pageLimitDefault: 50,
      pageLimitMax: 200,
      registerRoutes: createProposalContentRoutes({
        dataSource,
        maxProposalContentsChars: 8,
        hashMarkdownToProposalZkAppUriHash: async () => {
          throw new Error(
            "hashing should not run for profanity verify endpoint",
          );
        },
      }),
    });
    await server.start();

    const validResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/content/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: "clean" }),
      },
    );
    assert.equal(validResponse.status, 200);
    assert.deepEqual(await validResponse.json(), {
      ok: true,
      passesSubmissionChecks: true,
      containsExplicitLanguage: false,
      contentChars: 5,
      maxProposalContentsChars: 8,
    });

    const explicitResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/content/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: "fuck" }),
      },
    );
    assert.equal(explicitResponse.status, 400);
    assert.deepEqual(await explicitResponse.json(), {
      error: PROPOSAL_CONTENT_EXPLICIT_LANGUAGE_ERROR,
    });

    const tooLargeResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/content/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: "abcdefghi" }),
      },
    );
    assert.equal(tooLargeResponse.status, 400);
    assert.deepEqual(await tooLargeResponse.json(), {
      error: PROPOSAL_CONTENT_TOO_LARGE_ERROR,
      maxProposalContentsChars: 8,
      contentChars: 9,
    });
  });

  it("stores hash-bound markdown content atomically with the current projection", async () => {
    const port = await getAvailablePort();
    const proposalPublicKey = "proposal-public-key-1";
    const zkAppUriHash = "123456789";
    const contents = "# Proposal title\n\nThis is a detailed markdown body.";

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
      proposalPublicKey,
      lifecycleId: 2,
      amount: "1000",
      recipient: "recipient-public-key",
      zkAppUriHash,
      status: "pending",
      isPaused: false,
      contents: null,
      createdAtBlockHeight: 100,
      createdAtBlockTimestamp: new Date(Date.UTC(2026, 0, 1)),
    });

    server = new EventsApiServer(repository, {
      port,
      pageLimitDefault: 50,
      pageLimitMax: 200,
      registerRoutes: createProposalContentRoutes({
        dataSource,
        hashMarkdownToProposalZkAppUriHash: async () => ({
          zkAppUri: "urn:proposal-content:markdown:sha256:test-digest",
          zkAppUriHash,
        }),
      }),
    });
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${port}/proposals/${encodeURIComponent(proposalPublicKey)}/content`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ contents }),
      },
    );

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      ok: boolean;
      proposalPublicKey: string;
      zkAppUriHash: string;
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.zkAppUriHash, zkAppUriHash);
    assert.equal(payload.proposalPublicKey, proposalPublicKey);
    const updatedProposal = await dataSource
      .getRepository(ProposalEntity)
      .findOneBy({
        proposalPublicKey,
      });
    assert.equal(updatedProposal?.contents, contents);
    const storedContent = await dataSource
      .getRepository(ProposalContentEntity)
      .findOneBy({ proposalPublicKey, zkAppUriHash });
    assert.equal(storedContent?.contents, contents);

    await dataSource
      .getRepository(ProposalEntity)
      .update({ proposalPublicKey }, { contents: null });
    await dataSource.query(`DROP TABLE "processor_proposal_contents"`);

    const unavailableResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/${encodeURIComponent(proposalPublicKey)}/content`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ contents }),
      },
    );
    assert.equal(unavailableResponse.status, 503);
    assert.equal(
      (
        await dataSource
          .getRepository(ProposalEntity)
          .findOneByOrFail({ proposalPublicKey })
      ).contents,
      null,
    );
  });

  it("returns 400 when contents is invalid or too large", async () => {
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
      pageLimitDefault: 50,
      pageLimitMax: 200,
      registerRoutes: createProposalContentRoutes({
        dataSource,
        maxProposalContentsChars: 8,
        hashMarkdownToProposalZkAppUriHash: async () => ({
          zkAppUri: "urn:proposal-content:markdown:sha256:test-digest",
          zkAppUriHash: "123",
        }),
      }),
    });
    await server.start();

    const invalidResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/test-proposal-public-key/content`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: 123 }),
      },
    );
    assert.equal(invalidResponse.status, 400);
    assert.deepEqual(await invalidResponse.json(), {
      error: PROPOSAL_CONTENT_REQUIRED_ERROR,
    });

    const tooLargeResponse = await fetch(
      `http://127.0.0.1:${port}/proposals/test-proposal-public-key/content`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: "abcdefghi" }),
      },
    );
    assert.equal(tooLargeResponse.status, 400);
    const tooLargePayload = (await tooLargeResponse.json()) as {
      error?: string;
      maxProposalContentsChars?: number;
      contentChars?: number;
    };
    assert.equal(tooLargePayload.error, PROPOSAL_CONTENT_TOO_LARGE_ERROR);
    assert.equal(tooLargePayload.maxProposalContentsChars, 8);
    assert.equal(tooLargePayload.contentChars, 9);
  });

  it("returns 404 when no proposal matches submitted contents hash", async () => {
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
      pageLimitDefault: 50,
      pageLimitMax: 200,
      registerRoutes: createProposalContentRoutes({
        dataSource,
        hashMarkdownToProposalZkAppUriHash: async () => ({
          zkAppUri: "urn:proposal-content:markdown:sha256:test-digest",
          zkAppUriHash: "non-existent-hash",
        }),
      }),
    });
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${port}/proposals/missing-proposal-public-key/content`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: "# Hello" }),
      },
    );

    assert.equal(response.status, 404);
    const payload = (await response.json()) as { error?: string };
    assert.equal(payload.error, PROPOSAL_CONTENT_PROPOSAL_NOT_FOUND_ERROR);
    assert.equal(
      await dataSource.getRepository(ProposalContentEntity).count(),
      0,
    );
  });

  it("returns 400 when contents contains explicit language", async () => {
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
      pageLimitDefault: 50,
      pageLimitMax: 200,
      registerRoutes: createProposalContentRoutes({
        dataSource,
        hashMarkdownToProposalZkAppUriHash: async () => {
          throw new Error(
            "hashing should not run for blocked explicit content",
          );
        },
      }),
    });
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${port}/proposals/test-proposal-public-key/content`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: "This proposal says fuck." }),
      },
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: PROPOSAL_CONTENT_EXPLICIT_LANGUAGE_ERROR,
    });
  });
});
