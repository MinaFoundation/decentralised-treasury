import assert from "node:assert/strict";
import { createServer } from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  type ArchiveEventOutput,
  ArchiveEventEntity,
  EventsApiServer,
  EventsRepository,
} from "@repo/indexer";
import type { DataSource } from "typeorm";
import {
  EventProcessorRouter,
  EventsProcessor,
  IndexerEventsApiClient,
  ProcessorOffsetEntity,
} from "../src/index.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";
import { TestProjectionEventHandler } from "./support/test-event-handler.js";
import { TestProjectionEntity } from "./support/test-projection-entity.js";

interface ProjectionFixture {
  archiveEvent: ArchiveEventOutput;
  projection: {
    eventKey: string;
    payload: string;
  };
}

function buildProjectionFixture(height: number): ProjectionFixture {
  const eventKey = `projection-${height}`;
  const payload = `payload-${height}`;

  return {
    archiveEvent: {
      blockInfo: {
        height,
      },
      eventData: [
        {
          accountUpdateId: String(height),
          data: [eventKey, payload],
          transactionInfo: {
            hash: `tx-${height}`,
            zkappAccountUpdateIds: [height],
          },
        },
      ],
    },
    projection: {
      eventKey,
      payload,
    },
  };
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

describe("EventsProcessor", () => {
  let dataSource: DataSource;
  let repository: EventsRepository;
  let eventsApiServer: EventsApiServer;
  let processor: EventsProcessor;

  beforeEach(async () => {
    dataSource = createInMemoryDataSource("public", [TestProjectionEntity]);
    repository = new EventsRepository(dataSource, "public", {
      knownEventTypes: ["testProjectionCreated"],
    });
    await repository.initialize();
    await dataSource.synchronize();
    const port = await getAvailablePort();
    eventsApiServer = new EventsApiServer(repository, {
      port,
      pageLimitDefault: 50,
      pageLimitMax: 200,
    });
    await eventsApiServer.start();
    processor = new EventsProcessor(
      dataSource,
      new EventProcessorRouter([new TestProjectionEventHandler()]),
      {
        processorName: "test-projection-processor",
        pollIntervalMs: 60_000,
        batchSize: 2,
      },
      new IndexerEventsApiClient({
        indexerApiUrl: `http://127.0.0.1:${port}`,
      }),
    );
  });

  afterEach(async () => {
    await processor.stop();
    await eventsApiServer.stop();
    await repository.close();
  });

  it("catches up from archive_events using updated_at cursor", async () => {
    const fixture = buildProjectionFixture(10);
    await repository.insertRawEvents([fixture.archiveEvent], "pending");

    const processedFirst = await processor.processOnce();
    const processedSecond = await processor.processOnce();

    assert.equal(processedFirst, 1);
    assert.equal(processedSecond, 0);

    const projection = await dataSource.getRepository(TestProjectionEntity).findOneBy({
      eventKey: fixture.projection.eventKey,
    });
    assert.ok(projection);
    assert.equal(projection?.payload, fixture.projection.payload);
    assert.equal(projection?.status, "pending");

    const event = await dataSource.getRepository(ArchiveEventEntity).findOneBy({
      txHash: "tx-10",
      accountUpdateId: "10",
    });
    assert.equal(event?.eventType, "testProjectionCreated");

    const offset = await dataSource.getRepository(ProcessorOffsetEntity).findOne({
      where: { processorName: "test-projection-processor" },
    });
    assert.ok(offset);
    assert.equal(offset?.lastSeenEventId !== "0", true);
  });

  it("processes live updates and reacts to orphaning", async () => {
    const fixture = buildProjectionFixture(12);
    await repository.insertRawEvents([fixture.archiveEvent], "pending");
    assert.equal(await processor.processOnce(), 1);
    assert.equal(
      await dataSource.getRepository(TestProjectionEntity).countBy({
        eventKey: fixture.projection.eventKey,
      }),
      1,
    );

    await new Promise((resolve) => setTimeout(resolve, 2));
    await repository.markPendingAsOrphaned(100, 30);

    const processedOrphanUpdate = await processor.processOnce();
    assert.equal(processedOrphanUpdate, 1);
    assert.equal(
      await dataSource.getRepository(TestProjectionEntity).countBy({
        eventKey: fixture.projection.eventKey,
      }),
      0,
    );
  });

  it("updates projection status when the source event becomes canonical", async () => {
    const fixture = buildProjectionFixture(18);
    await repository.insertRawEvents([fixture.archiveEvent], "pending");
    assert.equal(await processor.processOnce(), 1);

    const projectionRepository = dataSource.getRepository(TestProjectionEntity);
    const pendingProjection = await projectionRepository.findOneBy({
      eventKey: fixture.projection.eventKey,
    });
    assert.equal(pendingProjection?.status, "pending");

    await new Promise((resolve) => setTimeout(resolve, 2));
    await repository.insertRawEvents([fixture.archiveEvent], "canonical");
    assert.equal(await processor.processOnce(), 1);

    const canonicalProjection = await projectionRepository.findOneBy({
      eventKey: fixture.projection.eventKey,
    });
    assert.equal(canonicalProjection?.status, "canonical");
  });

  it("does not re-dispatch unchanged overlap rows", async () => {
    const fixture = buildProjectionFixture(19);
    await repository.insertRawEvents([fixture.archiveEvent], "pending");
    assert.equal(await processor.processOnce(), 1);

    await new Promise((resolve) => setTimeout(resolve, 2));
    await repository.insertRawEvents([fixture.archiveEvent], "pending");
    assert.equal(await processor.processOnce(), 0);

    const projectionCount = await dataSource.getRepository(TestProjectionEntity).countBy({
      eventKey: fixture.projection.eventKey,
    });
    assert.equal(projectionCount, 1);
  });

  it("continues catch-up in batches with persistent offset", async () => {
    await repository.insertRawEvents([buildProjectionFixture(20).archiveEvent], "pending");
    await repository.insertRawEvents([buildProjectionFixture(21).archiveEvent], "pending");
    await repository.insertRawEvents([buildProjectionFixture(22).archiveEvent], "pending");

    assert.equal(await processor.processOnce(), 2);
    assert.equal(await processor.processOnce(), 1);
    assert.equal(await processor.processOnce(), 0);
    assert.equal(await dataSource.getRepository(TestProjectionEntity).count(), 3);
  });
});
