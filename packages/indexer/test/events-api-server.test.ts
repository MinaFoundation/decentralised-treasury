import assert from "node:assert/strict";
import { createServer } from "node:net";
import { afterEach, describe, it } from "node:test";
import { EventsApiServer } from "../src/events-api-server.js";
import type { ArchiveEventEntity, EventsPageQuery, EventsRepository } from "../src/index.js";

interface RepositoryStubOptions {
  events?: ArchiveEventEntity[];
  throwOnGet?: boolean;
}

function createRepositoryStub(
  options: RepositoryStubOptions = {},
): EventsRepository {
  return {
    async initialize(): Promise<void> {},
    async close(): Promise<void> {},
    async getEventsPage(_query: EventsPageQuery): Promise<ArchiveEventEntity[]> {
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

  it("returns 400 for invalid query input", async () => {
    const port = await getAvailablePort();
    server = new EventsApiServer(createRepositoryStub(), {
      port,
      pageLimitDefault: 50,
      pageLimitMax: 200,
    });
    await server.start();

    const response = await fetch(
      `http://127.0.0.1:${port}/v1/indexer/events?updatedAfter=not-a-date`,
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

    const response = await fetch(`http://127.0.0.1:${port}/v1/indexer/events`);
    const payload = (await response.json()) as { error?: string };

    assert.equal(response.status, 500);
    assert.equal(payload.error, "Internal server error");
  });
});
