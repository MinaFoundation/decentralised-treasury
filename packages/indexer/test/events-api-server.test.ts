import assert from "node:assert/strict";
import { createServer } from "node:net";
import { afterEach, describe, it } from "node:test";
import { EventsApiServer } from "../src/events-api-server.js";
import type {
  ArchiveEventEntity,
  EventsPageQuery,
  EventsRepository,
} from "../src/index.js";

interface RepositoryStubOptions {
  events?: ArchiveEventEntity[];
  throwOnGet?: boolean;
  onGet?: (query: EventsPageQuery) => void;
  onClose?: () => void;
}

function createRepositoryStub(
  options: RepositoryStubOptions = {},
): EventsRepository {
  return {
    async initialize(): Promise<void> {},
    async close(): Promise<void> {
      options.onClose?.();
    },
    async getEventsPage(query: EventsPageQuery): Promise<ArchiveEventEntity[]> {
      options.onGet?.(query);
      if (options.throwOnGet) {
        throw new Error("repository failure");
      }
      return options.events ?? [];
    },
  } as unknown as EventsRepository;
}

function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => {
          reject(new Error("Unable to resolve ephemeral port"));
        });
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

describe("EventsApiServer", () => {
  let server: EventsApiServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it("validates server options", () => {
    const repository = createRepositoryStub();
    assert.throws(
      () =>
        new EventsApiServer(repository, {
          port: -1,
          pageLimitDefault: 1,
          pageLimitMax: 1,
        }),
      /port/,
    );
    assert.throws(
      () =>
        new EventsApiServer(repository, {
          port: 1,
          pageLimitDefault: 0,
          pageLimitMax: 1,
        }),
      /page limits/,
    );
    assert.throws(
      () =>
        new EventsApiServer(repository, {
          port: 1,
          pageLimitDefault: 2,
          pageLimitMax: 1,
        }),
      /greater than/,
    );
    assert.throws(
      () =>
        new EventsApiServer(repository, {
          port: 1,
          pageLimitDefault: 1,
          pageLimitMax: 1,
          corsAllowedOrigins: [" bad "],
        }),
      /corsAllowedOrigins/,
    );
  });

  it("returns 400 for invalid query input", async () => {
    const port = await getAvailablePort();
    server = new EventsApiServer(createRepositoryStub(), {
      port,
      pageLimitDefault: 50,
      pageLimitMax: 200,
    });
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${port}/events?updatedAfter=not-a-date&eventIdAfter=0`,
    );
    const payload = (await response.json()) as { error?: string };

    assert.equal(response.status, 400);
    assert.equal(payload.error, "updatedAfter must be a valid ISO timestamp");
  });

  it("returns 500 when repository access fails", async () => {
    const port = await getAvailablePort();
    server = new EventsApiServer(
      createRepositoryStub({
        throwOnGet: true,
      }),
      {
        port,
        pageLimitDefault: 50,
        pageLimitMax: 200,
      },
    );
    await server.start();

    const response = await fetch(`http://127.0.0.1:${port}/events`);
    const payload = (await response.json()) as { error?: string };

    assert.equal(response.status, 500);
    assert.equal(payload.error, "Internal server error");
  });

  it("uses change-sequence pagination and returns bigint values as strings", async () => {
    const port = await getAvailablePort();
    let receivedQuery: EventsPageQuery | null = null;
    const event = {
      id: 9 as unknown as string,
      changeSequence: "9007199254740993",
      status: "canonical",
      pendingSeenAtHeight: 10,
      blockHeight: 12,
      blockTimestamp: new Date("2026-01-01T00:00:00.000Z"),
      globalSlotSinceGenesis: 100,
      stateHash: "3Nstate",
      parentHash: "3Nparent",
      chainStatus: "canonical",
      eventType: "proposalCreated",
      txHash: "tx-1",
      accountUpdateId: "1",
      accountUpdateIndex: 0,
      eventIndex: 0,
      blockEventIndex: 3,
      rawEventData: { data: ["field"] },
      indexedAt: new Date("2026-01-01T00:00:01.000Z"),
      updatedAt: new Date("2026-01-01T00:00:02.000Z"),
    } as ArchiveEventEntity;
    server = new EventsApiServer(
      createRepositoryStub({
        events: [event],
        onGet: (query) => {
          receivedQuery = query;
        },
      }),
      { port, pageLimitDefault: 50, pageLimitMax: 200 },
    );
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${port}/events?changeSequenceAfter=42`,
    );
    const payload = (await response.json()) as {
      items: Array<{
        id: string;
        changeSequence: string;
        blockEventIndex: number;
        globalSlotSinceGenesis: number;
        stateHash: string;
        parentHash: string;
        chainStatus: string;
      }>;
      nextCursor: { changeSequenceAfter: string };
    };
    assert.equal(response.status, 200);
    assert.equal(receivedQuery!.changeSequenceAfter, "42");
    assert.equal(receivedQuery!.updatedAfter, undefined);
    assert.equal(payload.items[0].id, "9");
    assert.equal(payload.items[0].changeSequence, "9007199254740993");
    assert.equal(payload.items[0].blockEventIndex, 3);
    assert.equal(payload.items[0].globalSlotSinceGenesis, 100);
    assert.equal(payload.items[0].stateHash, "3Nstate");
    assert.equal(payload.items[0].parentHash, "3Nparent");
    assert.equal(payload.items[0].chainStatus, "canonical");
    assert.deepEqual(payload.nextCursor, {
      changeSequenceAfter: "9007199254740993",
    });
  });

  it("rejects mixed, partial, and non-integer cursors", async () => {
    const port = await getAvailablePort();
    server = new EventsApiServer(createRepositoryStub(), {
      port,
      pageLimitDefault: 50,
      pageLimitMax: 200,
    });
    await server.start();

    const paths = [
      "/events?changeSequenceAfter=1&eventIdAfter=2",
      "/events?updatedAfter=2026-01-01T00%3A00%3A00Z",
      "/events?eventIdAfter=nope&updatedAfter=2026-01-01T00%3A00%3A00Z",
      "/events?limit=1.5",
      "/events?includeUnknown=yes",
      "/events?changeSequenceAfter=-1",
      "/events?eventTypes=",
      "/events?eventTypes=proposalCreated,,proposalExecuted",
      "/events?limit=1&limit=2",
    ];
    for (const path of paths) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(response.status, 400, path);
    }
  });

  it("keeps liveness and legacy pagination compatible with CORS", async () => {
    const port = await getAvailablePort();
    let receivedQuery: EventsPageQuery | null = null;
    const event = {
      id: "7",
      changeSequence: "8",
      status: "pending",
      pendingSeenAtHeight: 3,
      blockHeight: 3,
      blockTimestamp: null,
      globalSlotSinceGenesis: null,
      stateHash: null,
      parentHash: null,
      chainStatus: null,
      eventType: "proposalCreated",
      txHash: "tx-legacy",
      accountUpdateId: "1",
      accountUpdateIndex: 0,
      eventIndex: 0,
      blockEventIndex: 0,
      rawEventData: { data: ["field"] },
      indexedAt: new Date("2026-01-01T00:00:01.000Z"),
      updatedAt: new Date("2026-01-01T00:00:02.000Z"),
    } as ArchiveEventEntity;
    server = new EventsApiServer(
      createRepositoryStub({
        events: [event],
        onGet: (query) => (receivedQuery = query),
      }),
      {
        port,
        pageLimitDefault: 50,
        pageLimitMax: 100,
        corsAllowedOrigins: ["https://allowed.example"],
        indexerPrefix: "/indexer/",
      },
    );
    await Promise.all([server.start(), server.start()]);

    assert.equal(
      (await fetch(`http://127.0.0.1:${port}/indexer/healthz`)).status,
      200,
    );
    assert.equal(
      (
        await fetch(`http://127.0.0.1:${port}/indexer/healthz`, {
          headers: { origin: "https://denied.example" },
        })
      ).status,
      403,
    );
    const preflight = await fetch(`http://127.0.0.1:${port}/indexer/events`, {
      method: "OPTIONS",
      headers: { origin: "https://allowed.example" },
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get("access-control-allow-origin"),
      "https://allowed.example",
    );

    const response = await fetch(
      `http://127.0.0.1:${port}/indexer/events?updatedAfter=2026-01-01T00%3A00%3A00Z&eventIdAfter=6&eventTypes=proposalCreated,proposalCreated&includeUnknown=false&limit=999`,
    );
    const payload = (await response.json()) as {
      nextCursor: { updatedAfter: string; eventIdAfter: string };
    };
    assert.equal(response.status, 200);
    assert.deepEqual(receivedQuery!.eventTypes, ["proposalCreated"]);
    assert.equal(receivedQuery!.includeUnknown, false);
    assert.equal(receivedQuery!.limit, 100);
    assert.equal(receivedQuery!.changeSequenceAfter, undefined);
    assert.deepEqual(payload.nextCursor, {
      updatedAfter: "2026-01-01T00:00:02.000Z",
      eventIdAfter: "7",
    });
  });

  it("propagates startup failures and performs cleanup once", async () => {
    let closeCalls = 0;
    let onStopCalls = 0;
    server = new EventsApiServer(
      createRepositoryStub({ onClose: () => (closeCalls += 1) }),
      {
        port: 1,
        pageLimitDefault: 50,
        pageLimitMax: 200,
        registerTopLevelRoutes: async () => {
          throw new Error("route setup failed");
        },
        onStop: () => {
          onStopCalls += 1;
        },
      },
    );
    await assert.rejects(server.start(), /route setup failed/);
    await Promise.all([server.stop(), server.stop()]);
    assert.equal(closeCalls, 1);
    assert.equal(onStopCalls, 1);
  });
});
