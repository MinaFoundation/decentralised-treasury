import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, describe, it } from "node:test";
import { ArchiveClient } from "../src/archive/client.js";

const ARCHIVE_DEFAULT_TOKEN_ID =
  "wSHV2S4qX9jFsLjQo8r1BsMLH2ZRKsZx6EJd1sbozGPieEC4Jf";

describe("ArchiveClient", () => {
  let server: ReturnType<typeof createServer> | null = null;
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (!server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    server = null;
  });

  it("validates constructor and range options", async () => {
    assert.throws(
      () =>
        new ArchiveClient("not a URL", {
          treasuryOwnerContractAddress: "B62qtest",
          archiveRequestTimeoutMs: 1,
        }),
      /valid absolute URL/,
    );
    assert.throws(
      () =>
        new ArchiveClient("file:///tmp/archive", {
          treasuryOwnerContractAddress: "B62qtest",
          archiveRequestTimeoutMs: 1,
        }),
      /http or https/,
    );
    assert.throws(
      () =>
        new ArchiveClient("https://archive.example", {
          treasuryOwnerContractAddress: " bad ",
          archiveRequestTimeoutMs: 1,
        }),
      /treasuryOwnerContractAddress/,
    );
    assert.throws(
      () =>
        new ArchiveClient("https://archive.example", {
          treasuryOwnerContractAddress: "B62qtest",
          archiveRequestTimeoutMs: 0,
        }),
      /archiveRequestTimeoutMs/,
    );

    const client = new ArchiveClient("https://archive.example", {
      treasuryOwnerContractAddress: "B62qtest",
      archiveRequestTimeoutMs: 100,
    });
    await assert.rejects(
      client.fetchEvents({ status: "OTHER" as "PENDING", from: 0, to: 1 }),
      /status must/,
    );
    await assert.rejects(
      client.fetchEvents({ status: "PENDING", from: -1, to: 1 }),
      /from must/,
    );
    await assert.rejects(
      client.fetchEvents({ status: "PENDING", from: 2, to: 1 }),
      /to must/,
    );
  });

  it("validates archive response envelopes and heights", async () => {
    const client = new ArchiveClient("https://archive.example", {
      treasuryOwnerContractAddress: "B62qtest",
      archiveRequestTimeoutMs: 100,
    });
    const payloads: Array<{ status?: number; body: unknown }> = [
      { status: 503, body: {} },
      { body: { errors: [{ message: "first" }, { message: "second" }] } },
      { body: { errors: [{}] } },
      { body: {} },
      {
        body: {
          data: {
            networkState: {
              maxBlockHeight: {
                canonicalMaxBlockHeight: 12,
                pendingMaxBlockHeight: 13,
              },
            },
          },
        },
      },
      {
        body: {
          data: {
            networkState: {
              maxBlockHeight: {
                canonicalMaxBlockHeight: -1,
                pendingMaxBlockHeight: 2,
              },
            },
          },
        },
      },
    ];
    globalThis.fetch = async () => {
      const next = payloads.shift()!;
      return new Response(JSON.stringify(next.body), {
        status: next.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    };

    await assert.rejects(client.getMaxBlockHeights(), /503/);
    await assert.rejects(client.getMaxBlockHeights(), /first; second/);
    await assert.rejects(client.getMaxBlockHeights(), /unknown GraphQL error/);
    await assert.rejects(client.getMaxBlockHeights(), /did not include data/);
    assert.deepEqual(await client.getMaxBlockHeights(), {
      canonicalMaxBlockHeight: 12,
      pendingMaxBlockHeight: 13,
    });
    await assert.rejects(client.getMaxBlockHeights(), /missing canonical/);
  });

  it("falls back when timestamp is unsupported and validates event arrays", async () => {
    const client = new ArchiveClient("https://archive.example", {
      treasuryOwnerContractAddress: "B62qtest",
      archiveRequestTimeoutMs: 100,
    });
    const queries: string[] = [];
    const bodies = [
      { errors: [{ message: 'Cannot query field "timestamp"' }] },
      { data: { events: [{ blockInfo: { height: 1 }, eventData: [] }] } },
      { data: { events: [] } },
      { data: { events: null } },
      { data: { events: "bad" } },
    ];
    globalThis.fetch = async (_url, init) => {
      queries.push(JSON.parse(String(init?.body)).query as string);
      return new Response(JSON.stringify(bodies.shift()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const events = await client.fetchEvents({
      status: "CANONICAL",
      from: 1,
      to: 1,
    });
    assert.equal(events.length, 1);
    assert.match(queries[0], /timestamp/);
    assert.match(queries[0], /globalSlotSinceGenesis/);
    assert.match(queries[0], /stateHash/);
    assert.match(queries[0], /parentHash/);
    assert.match(queries[0], /chainStatus/);
    assert.match(queries[0], /sequenceNumber/);
    assert.doesNotMatch(queries[1], /timestamp/);
    assert.match(queries[1], /globalSlotSinceGenesis/);
    assert.match(queries[1], /stateHash/);
    assert.match(queries[1], /sequenceNumber/);
    assert.deepEqual(
      await client.fetchEvents({ status: "CANONICAL", from: 2, to: 2 }),
      [],
    );
    await assert.rejects(
      client.fetchEvents({ status: "CANONICAL", from: 3, to: 3 }),
      /must include an events array/,
    );
    await assert.rejects(
      client.fetchEvents({ status: "CANONICAL", from: 4, to: 4 }),
      /must include an events array/,
    );
  });

  it("uses Mina's default token id in archive base58 form", async () => {
    let capturedTokenId: string | null = null;
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk.toString();
      });
      request.on("end", () => {
        const payload = JSON.parse(body) as {
          variables?: { input?: { tokenId?: string } };
        };
        capturedTokenId = payload.variables?.input?.tokenId ?? null;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: { events: [] } }));
      });
    });
    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected HTTP server to bind to an ephemeral port");
    }

    const client = new ArchiveClient(`http://127.0.0.1:${address.port}`, {
      treasuryOwnerContractAddress: "B62qtest",
      archiveRequestTimeoutMs: 5_000,
    });

    await client.fetchEvents({
      status: "PENDING",
      from: 0,
      to: 1,
    });

    assert.equal(capturedTokenId, ARCHIVE_DEFAULT_TOKEN_ID);
  });
  it("converts the inclusive upper bound to the archive's exclusive one", async () => {
    let capturedRange: { from?: number; to?: number } = {};
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk.toString();
      });
      request.on("end", () => {
        const payload = JSON.parse(body) as {
          variables?: { input?: { from?: number; to?: number } };
        };
        capturedRange = {
          from: payload.variables?.input?.from,
          to: payload.variables?.input?.to,
        };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: { events: [] } }));
      });
    });
    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected HTTP server to bind to an ephemeral port");
    }

    const client = new ArchiveClient(`http://127.0.0.1:${address.port}`, {
      treasuryOwnerContractAddress: "B62qtest",
      archiveRequestTimeoutMs: 5_000,
    });

    await client.fetchEvents({
      status: "PENDING",
      from: 546343,
      to: 546352,
    });

    // The archive excludes `to`. Sending 546352 verbatim dropped every event in
    // that block while the cursor still advanced past it.
    assert.deepEqual(capturedRange, { from: 546343, to: 546353 });
  });
});
