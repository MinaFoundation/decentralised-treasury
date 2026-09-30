import assert from "node:assert/strict";
import { createServer } from "node:net";
import { after, before, describe, it } from "node:test";
import { ArchiveClient } from "../../indexer/src/archive/client.js";
import { TokenId, UInt32 } from "../src/o1js.js";
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
  let runtime: LocalBlockchainRuntime;
  const address = "B62qarchive-range-fixture";
  const tokenId = TokenId.toBase58(TokenId.default);
  before(async () => {
    runtime = await LocalBlockchainRuntime.create({
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

  it("provides the canonical anchor required by ArchiveClient before any transaction", async () => {
    const client = new ArchiveClient(url, {
      treasuryOwnerContractAddress: address,
      archiveRequestTimeoutMs: 5_000,
    });
    const anchor = runtime.getBestChain(1)[0]!;
    assert.deepEqual(await client.fetchPendingSnapshot(10), {
      height: runtime.getCurrentBlockHeight(),
      events: [],
      ancestry: [
        {
          blockHeight: runtime.getCurrentBlockHeight(),
          stateHash: anchor.stateHash,
          parentHash: anchor.protocolState.previousStateHash,
        },
      ],
      ambiguous: false,
    });
  });

  it("returns linked eventless blocks with Archive range, limit, and canonical filters", async () => {
    const originalHeight = runtime.getCurrentBlockHeight();
    runtime.blockchain.setBlockchainLength(UInt32.from(3));
    try {
      const fetchBlocks = async (
        query: Record<string, unknown>,
        limit = 1000,
      ) => {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query:
              "query Blocks($query: BlockQueryInput!, $limit: Int!) { blocks(query: $query, limit: $limit, sortBy: BLOCKHEIGHT_ASC) { blockHeight stateHash parentHash } }",
            variables: { query, limit },
          }),
          signal: AbortSignal.timeout(5_000),
        });
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.errors, undefined);
        return payload.data.blocks as Array<{
          blockHeight: number;
          stateHash: string;
          parentHash: string;
        }>;
      };
      const blocks = await fetchBlocks({
        blockHeight_gte: 0,
        blockHeight_lt: 4,
        inBestChain: true,
        canonical: true,
      });
      assert.deepEqual(
        blocks.map((block) => block.blockHeight),
        [0, 1, 2, 3],
      );
      for (let index = 1; index < blocks.length; index++) {
        assert.equal(blocks[index]!.parentHash, blocks[index - 1]!.stateHash);
      }
      assert.deepEqual(
        await fetchBlocks({ blockHeight_gte: 1, blockHeight_lt: 3 }, 1),
        blocks.slice(1, 2),
      );
      assert.deepEqual(
        await fetchBlocks({ blockHeight_gte: 3, blockHeight_lt: 3 }),
        [],
      );
      assert.deepEqual(await fetchBlocks({ canonical: false }), []);
      assert.deepEqual(await fetchBlocks({ inBestChain: false }), []);
      const client = new ArchiveClient(url, {
        treasuryOwnerContractAddress: address,
        archiveRequestTimeoutMs: 5_000,
      });
      assert.deepEqual(await client.fetchPendingSnapshot(10), {
        height: 3,
        events: [],
        ancestry: [blocks[3]],
        ambiguous: false,
      });
    } finally {
      runtime.blockchain.setBlockchainLength(UInt32.from(originalHeight));
    }
  });
});
