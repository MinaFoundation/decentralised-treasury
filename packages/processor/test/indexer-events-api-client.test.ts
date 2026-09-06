import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { afterEach, describe, it } from "node:test";
import { IndexerEventsApiClient, IndexerEventsApiError } from "../src/index.js";

function validEvent(changeSequence = "1"): Record<string, unknown> {
  return {
    id: "10",
    changeSequence,
    status: "pending",
    pendingSeenAtHeight: 20,
    blockHeight: 20,
    blockTimestamp: "2026-01-01T00:00:00.000Z",
    globalSlotSinceGenesis: 100,
    stateHash: "3Nstate",
    parentHash: "3Nparent",
    chainStatus: "pending",
    eventType: "testProjectionCreated",
    txHash: "tx-10",
    accountUpdateId: "10",
    accountUpdateIndex: 0,
    eventIndex: 0,
    blockEventIndex: 4,
    rawEventData: {
      accountUpdateId: "10",
      data: ["key", "payload"],
      transactionInfo: {
        hash: "tx-10",
        sequenceNumber: 7,
        zkappAccountUpdateIds: [10],
      },
    },
    indexedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
  };
}

describe("IndexerEventsApiClient", () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      const activeServer = server;
      server = null;
      await new Promise<void>((resolve, reject) => {
        activeServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  async function startServer(payload: unknown): Promise<{
    client: IndexerEventsApiClient;
    requestedUrl: () => URL | null;
  }> {
    let lastUrl: URL | null = null;
    server = createServer((request, response) => {
      lastUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(payload));
    });
    await new Promise<void>((resolve, reject) => {
      server?.once("error", reject);
      server?.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return {
      client: new IndexerEventsApiClient({
        indexerApiUrl: `http://127.0.0.1:${address.port}`,
      }),
      requestedUrl: () => lastUrl,
    };
  }

  it("requests and maps a complete change-sequence page", async () => {
    const event = validEvent("8");
    event.id = 10;
    const { client, requestedUrl } = await startServer({
      items: [event],
      nextCursor: { changeSequenceAfter: "8" },
    });

    const page = await client.fetchEventsPage({
      handledEventTypes: ["testProjectionCreated"],
      changeSequenceAfter: "7",
      limit: 25,
    });

    assert.equal(page.items[0]?.changeSequence, "8");
    assert.equal(page.items[0]?.id, "10");
    assert.equal(
      page.items[0]?.blockTimestamp?.toISOString(),
      "2026-01-01T00:00:00.000Z",
    );
    assert.equal(page.items[0]?.globalSlotSinceGenesis, 100);
    assert.equal(page.items[0]?.stateHash, "3Nstate");
    assert.equal(page.items[0]?.parentHash, "3Nparent");
    assert.equal(page.items[0]?.chainStatus, "pending");
    assert.equal(page.nextCursor?.changeSequenceAfter, "8");
    assert.equal(requestedUrl()?.searchParams.get("changeSequenceAfter"), "7");
    assert.equal(requestedUrl()?.searchParams.has("updatedAfter"), false);
  });

  it("rejects an incomplete event response", async () => {
    const incompleteEvent = validEvent();
    delete incompleteEvent.rawEventData;
    const { client } = await startServer({
      items: [incompleteEvent],
      nextCursor: { changeSequenceAfter: "1" },
    });

    await assert.rejects(
      client.fetchEventsPage({
        handledEventTypes: [],
        changeSequenceAfter: "0",
        limit: 1,
      }),
      (error: unknown) =>
        error instanceof IndexerEventsApiError &&
        error.code === "INDEXER_RESPONSE_CONTRACT_INVALID",
    );
  });

  it("accepts null Archive block identity fields", async () => {
    const event = validEvent();
    event.globalSlotSinceGenesis = null;
    event.stateHash = null;
    event.parentHash = null;
    event.chainStatus = null;
    const { client } = await startServer({
      items: [event],
      nextCursor: { changeSequenceAfter: "1" },
    });

    const page = await client.fetchEventsPage({
      handledEventTypes: [],
      changeSequenceAfter: "0",
      limit: 1,
    });

    assert.equal(page.items[0]?.globalSlotSinceGenesis, null);
    assert.equal(page.items[0]?.stateHash, null);
    assert.equal(page.items[0]?.parentHash, null);
    assert.equal(page.items[0]?.chainStatus, null);
  });

  for (const invalidSequenceNumber of [
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    "7",
  ]) {
    it(`rejects invalid transaction sequence ${String(invalidSequenceNumber)}`, async () => {
      const event = validEvent();
      (
        event.rawEventData as {
          transactionInfo: { sequenceNumber: unknown };
        }
      ).transactionInfo.sequenceNumber = invalidSequenceNumber;
      const { client } = await startServer({
        items: [event],
        nextCursor: { changeSequenceAfter: "1" },
      });

      await assert.rejects(
        client.fetchEventsPage({
          handledEventTypes: [],
          changeSequenceAfter: "0",
          limit: 1,
        }),
        (error: unknown) =>
          error instanceof IndexerEventsApiError &&
          error.code === "INDEXER_RESPONSE_CONTRACT_INVALID" &&
          error.message.includes("transactionInfo.sequenceNumber"),
      );
    });
  }

  for (const [field, invalidValue] of [
    ["globalSlotSinceGenesis", -1],
    ["stateHash", ""],
    ["parentHash", " parent"],
    ["chainStatus", 1],
  ] as const) {
    it(`rejects an invalid ${field}`, async () => {
      const event = validEvent();
      event[field] = invalidValue;
      const { client } = await startServer({
        items: [event],
        nextCursor: { changeSequenceAfter: "1" },
      });

      await assert.rejects(
        client.fetchEventsPage({
          handledEventTypes: [],
          changeSequenceAfter: "0",
          limit: 1,
        }),
        (error: unknown) =>
          error instanceof IndexerEventsApiError &&
          error.code === "INDEXER_RESPONSE_CONTRACT_INVALID" &&
          error.message.includes(field),
      );
    });
  }

  for (const [label, field, invalidValue] of [
    ["fractional global slot", "globalSlotSinceGenesis", 1.5],
    [
      "unsafe global slot",
      "globalSlotSinceGenesis",
      Number.MAX_SAFE_INTEGER + 1,
    ],
    ["whitespace state hash", "stateHash", "3Nstate "],
    ["empty parent hash", "parentHash", ""],
    ["invalid block timestamp", "blockTimestamp", "not-a-date"],
    ["invalid indexed timestamp", "indexedAt", "not-a-date"],
  ] as const) {
    it(`rejects ${label}`, async () => {
      const event = validEvent();
      event[field] = invalidValue;
      const { client } = await startServer({
        items: [event],
        nextCursor: { changeSequenceAfter: "1" },
      });

      await assert.rejects(
        client.fetchEventsPage({
          handledEventTypes: [],
          changeSequenceAfter: "0",
          limit: 1,
        }),
        (error: unknown) =>
          error instanceof IndexerEventsApiError &&
          error.code === "INDEXER_RESPONSE_CONTRACT_INVALID" &&
          error.message.includes(field),
      );
    });
  }

  for (const status of ["canonical", "orphaned"] as const) {
    it(`accepts the exact ${status} event status`, async () => {
      const event = validEvent();
      event.status = status;
      const { client } = await startServer({
        items: [event],
        nextCursor: { changeSequenceAfter: "1" },
      });

      const page = await client.fetchEventsPage({
        handledEventTypes: [],
        changeSequenceAfter: "0",
        limit: 1,
      });

      assert.equal(page.items[0]?.status, status);
    });
  }

  for (const status of ["finalized", "", null, 1, undefined]) {
    it(`rejects the invalid event status ${String(status)}`, async () => {
      const event = validEvent();
      event.status = status;
      const { client } = await startServer({
        items: [event],
        nextCursor: { changeSequenceAfter: "1" },
      });

      await assert.rejects(
        client.fetchEventsPage({
          handledEventTypes: [],
          changeSequenceAfter: "0",
          limit: 1,
        }),
        (error: unknown) =>
          error instanceof IndexerEventsApiError &&
          error.code === "INDEXER_RESPONSE_CONTRACT_INVALID" &&
          error.message.includes(
            "items[0].status must be one of: pending, canonical, orphaned",
          ),
      );
    });
  }

  it("rejects non-increasing change sequences", async () => {
    const { client } = await startServer({
      items: [validEvent("3"), validEvent("2")],
      nextCursor: { changeSequenceAfter: "2" },
    });

    await assert.rejects(
      client.fetchEventsPage({
        handledEventTypes: [],
        changeSequenceAfter: "1",
        limit: 2,
      }),
      /strictly increasing/,
    );
  });

  for (const [label, payload, expectedMessage] of [
    [
      "malformed next cursor",
      {
        items: [validEvent("1")],
        nextCursor: { changeSequenceAfter: "01" },
      },
      "nextCursor must be null or contain a nonnegative bigint",
    ],
    [
      "next cursor that differs from the last item",
      {
        items: [validEvent("1")],
        nextCursor: { changeSequenceAfter: "2" },
      },
      "nextCursor must equal the last item changeSequence",
    ],
    [
      "cursor on an empty page",
      {
        items: [],
        nextCursor: { changeSequenceAfter: "1" },
      },
      "nextCursor must be null for an empty page",
    ],
  ] as const) {
    it(`rejects ${label}`, async () => {
      const { client } = await startServer(payload);

      await assert.rejects(
        client.fetchEventsPage({
          handledEventTypes: [],
          changeSequenceAfter: "0",
          limit: 1,
        }),
        (error: unknown) =>
          error instanceof IndexerEventsApiError &&
          error.code === "INDEXER_RESPONSE_CONTRACT_INVALID" &&
          error.message.includes(expectedMessage),
      );
    });
  }
});
