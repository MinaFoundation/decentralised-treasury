import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { submitProposalContents } from "../src/commands/proposal-content-api.js";

describe("submitProposalContents", () => {
  const servers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((close) => close()));
  });

  it("retries proposal content submission until the proposal is indexed", async () => {
    let attemptCount = 0;
    const server = createServer(async (_request, response) => {
      attemptCount += 1;
      if (attemptCount === 1) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: "proposal for submitted contents was not found",
          }),
        );
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          contentChars: 19,
          proposalPublicKey: "B62qproposal",
          zkAppUri: "urn:proposal-content:markdown:sha256:test-digest",
          zkAppUriHash: "123456789",
        }),
      );
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    servers.push(
      () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    );
    const { port } = server.address() as AddressInfo;

    const result = await submitProposalContents({
      apiUrl: `http://127.0.0.1:${port}`,
      proposalPublicKey: "B62qproposal",
      contents: "# Proposal\n\nBody.",
      timeoutMs: 2_000,
      retryDelayMs: 10,
    });

    assert.equal(attemptCount, 2);
    assert.equal(result.ok, true);
    assert.equal(result.proposalPublicKey, "B62qproposal");
  });
});
