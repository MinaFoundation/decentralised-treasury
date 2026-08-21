import assert from "node:assert/strict";
import { createServer } from "node:http";
import { afterEach, describe, it } from "node:test";
import { ArchiveClient } from "../src/archive/client.js";

const ARCHIVE_DEFAULT_TOKEN_ID = "wSHV2S4qX9jFsLjQo8r1BsMLH2ZRKsZx6EJd1sbozGPieEC4Jf";

describe("ArchiveClient", () => {
  let server: ReturnType<typeof createServer> | null = null;

  afterEach(async () => {
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
