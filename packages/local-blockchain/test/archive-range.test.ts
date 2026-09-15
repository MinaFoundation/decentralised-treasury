import assert from "node:assert/strict";
import { createServer } from "node:net";
import { after, before, describe, it } from "node:test";
import { ArchiveClient } from "../../indexer/src/archive/client.js";
import { TokenId } from "../src/o1js.js";
import { proofsEnabled } from "./proof-mode.js";
import {
  createArchiveHttpServer,
  type ArchiveHttpServer,
} from "../src/archive/archive-http-server.js";
import {
  LocalBlockchainRuntime,
  type RuntimeArchiveEvent,
} from "../src/runtime/local-blockchain-runtime.js";

describe("public Archive endpoint uses an inclusive from and exclusive to", () => {
  let server: ArchiveHttpServer;
  let url: string;
  const address = "B62qarchive-range-fixture";
  const tokenId = TokenId.toBase58(TokenId.default);
  before(async () => {
    const runtime = await LocalBlockchainRuntime.create({
      proofsEnabled,
    });
    // Supporting protocol test: only the archived rows are synthetic. Requests
    // use the real HTTP handler and runtime filter; no contract/proof claim.
    const rows = (
      runtime as unknown as { archiveEvents: RuntimeArchiveEvent[] }
    ).archiveEvents;
    for (const height of [8, 9, 10, 11])
      rows.push({
        address,
        tokenId,
        status: "CANONICAL",
        blockInfo: { height, timestamp: "2026-01-01T00:00:00.000Z" },
        eventData: {
          accountUpdateId: String(height),
          data: [String(height)],
          transactionInfo: {
            hash: `range-event-${height}`,
            zkappAccountUpdateIds: [height],
          },
        },
      });
    const port = await new Promise<number>((resolve, reject) => {
      const reservation = createServer();
      reservation.once("error", reject);
      reservation.listen(0, "127.0.0.1", () => {
        const bound = reservation.address();
        if (!bound || typeof bound === "string")
          return reject(new Error("Missing test port"));
        reservation.close((error) =>
          error ? reject(error) : resolve(bound.port),
        );
      });
    });
    server = createArchiveHttpServer({ runtime, port });
    await server.start();
    url = `http://127.0.0.1:${port}/graphql`;
  });
  after(async () => {
    if (server) await server.stop();
  });

  for (const scenario of [
    {
      name: "keeps from and to-minus-one but excludes adjacent outside heights",
      input: { from: 9, to: 11 },
      expected: [9, 10],
    },
    {
      name: "excludes the exact upper boundary",
      input: { from: 0, to: 10 },
      expected: [8, 9],
    },
    {
      name: "includes the exact lower boundary",
      input: { from: 10, to: 12 },
      expected: [10, 11],
    },
    {
      name: "returns an empty range when from equals to",
      input: { from: 10, to: 10 },
      expected: [],
    },
    {
      name: "preserves an explicit zero upper bound",
      input: { to: 0 },
      expected: [],
    },
    {
      name: "permits an omitted upper bound",
      input: { from: 10 },
      expected: [10, 11],
    },
    {
      name: "permits both bounds to be omitted",
      input: {},
      expected: [8, 9, 10, 11],
    },
    {
      name: "returns no events above the last stored height",
      input: { from: 12 },
      expected: [],
    },
  ]) {
    it(scenario.name, async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query:
            "query Events($input: EventFilterOptionsInput!) { events(input: $input) { blockInfo { height } } }",
          variables: {
            input: { address, tokenId, status: "CANONICAL", ...scenario.input },
          },
        }),
        signal: AbortSignal.timeout(5_000),
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.errors, undefined);
      assert.deepEqual(
        payload.data.events.map(
          (event: { blockInfo: { height: number } }) => event.blockInfo.height,
        ),
        scenario.expected,
      );
    });
  }

  it("keeps ArchiveClient's inclusive batch from leaking the next block", async () => {
    const client = new ArchiveClient(url, {
      treasuryOwnerContractAddress: address,
      archiveRequestTimeoutMs: 5_000,
    });
    const events = await client.fetchEvents({
      status: "CANONICAL",
      from: 8,
      to: 9,
    });
    assert.deepEqual(
      events.map((event) => event.blockInfo.height),
      [8, 9],
    );
  });
});
