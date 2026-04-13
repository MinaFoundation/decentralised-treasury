import assert from "node:assert/strict";
import { createServer } from "node:net";
import { afterEach, describe, it } from "node:test";
import { EventsApiServer, EventsIndexer, EventsRepository } from "@repo/indexer";
import { ProcessorOffsetEntity } from "@repo/processor";
import type { DataSource } from "typeorm";
import { createIndexerStatusRoutes } from "../src/indexer-status-routes.js";
import { HttpApiServer } from "../src/http-api-server.js";
import { createProcessorStatusRoutes } from "../src/processor-status-routes.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";

interface ArchiveHeightsStubOptions {
  canonicalMaxBlockHeight: number;
  pendingMaxBlockHeight: number;
}

class ArchiveHeightsStub {
  public constructor(private readonly options: ArchiveHeightsStubOptions) {}

  public async getMaxBlockHeights(): Promise<ArchiveHeightsStubOptions> {
    return this.options;
  }
}

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

describe("indexer and processor status endpoints", () => {
  let dataSource: DataSource | null = null;
  let repository: EventsRepository | null = null;
  let indexerServer: EventsApiServer | null = null;
  let processorServer: HttpApiServer | null = null;

  afterEach(async () => {
    if (indexerServer) {
      await indexerServer.stop();
      indexerServer = null;
    }
    if (processorServer) {
      await processorServer.stop();
      processorServer = null;
    }
    if (repository) {
      await repository.close().catch(() => null);
      repository = null;
    }
    if (dataSource?.isInitialized) {
      await dataSource.destroy().catch(() => null);
    }
    dataSource = null;
  });

  it("returns indexer stats and processor stats from separate endpoints", async () => {
    const indexerPort = await getAvailablePort();
    const processorPort = await getAvailablePort();
    dataSource = createInMemoryDataSource("public");
    repository = new EventsRepository(dataSource, "public", {
      knownEventTypes: ["proposalCreated"],
    });
    await repository.initialize();
    await dataSource.synchronize();

    await repository.setCursor(EventsIndexer.PENDING_CURSOR, 120);
    await repository.setCursor(EventsIndexer.CANONICAL_CURSOR, 100);
    await repository.insertRawEvents(
      [
        {
          blockInfo: { height: 121 },
          eventData: [
            {
              accountUpdateId: "1",
              data: ["0", "11", "22"],
              transactionInfo: {
                hash: "tx-status-test",
                zkappAccountUpdateIds: [1],
              },
            },
          ],
        },
      ],
      "pending",
    );
    await dataSource.getRepository(ProcessorOffsetEntity).upsert(
      {
        processorName: "proposal-processor",
        lastSeenUpdatedAt: new Date(0),
        lastSeenEventId: "0",
      },
      ["processorName"],
    );

    indexerServer = new EventsApiServer(repository, {
      port: indexerPort,
      pageLimitDefault: 50,
      pageLimitMax: 200,
      registerRoutes: createIndexerStatusRoutes({
        repository,
        archive: new ArchiveHeightsStub({
          canonicalMaxBlockHeight: 140,
          pendingMaxBlockHeight: 180,
        }),
      }),
    });
    processorServer = new HttpApiServer({
      name: "processor-api-test",
      port: processorPort,
      registerRoutes: createProcessorStatusRoutes({
        dataSource,
        processorName: "proposal-processor",
      }),
    });
    await indexerServer.start();
    await processorServer.start();

    const indexerResponse = await fetch(`http://127.0.0.1:${indexerPort}/status`);
    assert.equal(indexerResponse.status, 200);
    const indexerPayload = (await indexerResponse.json()) as {
      ok: boolean;
      archive: {
        canonicalMaxBlockHeight: number;
        pendingMaxBlockHeight: number;
      };
      pendingCursor: number | null;
      canonicalCursor: number | null;
      remainingPendingBlocks: number;
      remainingCanonicalBlocks: number;
    };
    const processorResponse = await fetch(`http://127.0.0.1:${processorPort}/status`);
    assert.equal(processorResponse.status, 200);
    const processorPayload = (await processorResponse.json()) as {
      ok: boolean;
      processorName: string;
      offset: {
        lastSeenUpdatedAt: string;
        lastSeenEventId: string;
        updatedAt: string;
      } | null;
      remainingEvents: number;
    };

    assert.equal(indexerPayload.ok, true);
    assert.deepEqual(indexerPayload.archive, {
      canonicalMaxBlockHeight: 140,
      pendingMaxBlockHeight: 180,
    });
    assert.equal(indexerPayload.pendingCursor, 120);
    assert.equal(indexerPayload.canonicalCursor, 100);
    assert.equal(indexerPayload.remainingPendingBlocks, 60);
    assert.equal(indexerPayload.remainingCanonicalBlocks, 40);

    assert.equal(processorPayload.ok, true);
    assert.equal(processorPayload.processorName, "proposal-processor");
    assert.equal(processorPayload.offset?.lastSeenEventId, "0");
    assert.equal(processorPayload.remainingEvents, 1);
  });
});
