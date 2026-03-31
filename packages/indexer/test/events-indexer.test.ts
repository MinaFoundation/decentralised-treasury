import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { DataSource } from "typeorm";
import {
  ArchiveEventEntity,
  type ArchiveEventOutput,
  type ArchiveMaxHeights,
  EventsIndexer,
  EventsRepository,
  type FetchEventsOptions,
} from "../src/index.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";

class FakeArchiveSource {
  public pendingHead = 0;
  public canonicalHead = 0;
  public fetchCalls: FetchEventsOptions[] = [];

  public async getMaxBlockHeights(): Promise<ArchiveMaxHeights> {
    return {
      canonicalMaxBlockHeight: this.canonicalHead,
      pendingMaxBlockHeight: this.pendingHead,
    };
  }

  public async fetchEvents(options: FetchEventsOptions): Promise<ArchiveEventOutput[]> {
    this.fetchCalls.push(options);
    const rows: ArchiveEventOutput[] = [];
    for (let height = options.from; height <= options.to; height += 1) {
      rows.push({
        blockInfo: {
          height,
        },
        eventData: [
          {
            accountUpdateId: String(height),
            data: Array.from({ length: 7 }, (_, index) => `f-${height}-${index}`),
            transactionInfo: {
              hash: `tx-${height}`,
              zkappAccountUpdateIds: [height],
            },
          },
        ],
      });
    }
    return rows;
  }
}

describe("EventsIndexer", () => {
  let dataSource: DataSource;
  let repository: EventsRepository;
  let archive: FakeArchiveSource;

  beforeEach(async () => {
    dataSource = createInMemoryDataSource();
    repository = new EventsRepository(dataSource, "public", {
      knownEventTypes: ["proposalCreated"],
    });
    await repository.initialize();
    await dataSource.synchronize();
    archive = new FakeArchiveSource();
  });

  afterEach(async () => {
    await repository.close();
  });

  it("syncs from cursor in 10-block batches until archive head", async () => {
    const indexer = new EventsIndexer(archive, repository, {
      pollPendingIntervalMs: 60_000,
      pollCanonicalIntervalMs: 60_000,
      blockBatchSize: 10,
      canonicalOverlapBlocks: 5,
      orphanDepthBlocks: 30,
    });

    archive.pendingHead = 24;
    await indexer.syncPendingOnce();

    assert.deepEqual(
      archive.fetchCalls.map(({ status, from, to }) => [status, from, to]),
      [
        ["PENDING", 0, 9],
        ["PENDING", 10, 19],
        ["PENDING", 20, 24],
      ],
    );
    assert.equal(await repository.getCursor(EventsIndexer.PENDING_CURSOR), 24);

    archive.fetchCalls = [];
    archive.pendingHead = 27;
    await indexer.syncPendingOnce();

    assert.deepEqual(
      archive.fetchCalls.map(({ status, from, to }) => [status, from, to]),
      [["PENDING", 25, 27]],
    );
    assert.equal(await repository.getCursor(EventsIndexer.PENDING_CURSOR), 27);
  });

  it("writes synced event rows through repository", async () => {
    const indexer = new EventsIndexer(archive, repository, {
      pollPendingIntervalMs: 60_000,
      pollCanonicalIntervalMs: 60_000,
      blockBatchSize: 10,
      canonicalOverlapBlocks: 5,
      orphanDepthBlocks: 30,
    });

    archive.pendingHead = 2;
    await indexer.syncPendingOnce();

    const count = await dataSource.getRepository(ArchiveEventEntity).count();
    assert.equal(count, 3);
  });

  it("re-scans canonical overlap window below cursor", async () => {
    const indexer = new EventsIndexer(archive, repository, {
      pollPendingIntervalMs: 60_000,
      pollCanonicalIntervalMs: 60_000,
      blockBatchSize: 10,
      canonicalOverlapBlocks: 5,
      orphanDepthBlocks: 30,
    });

    archive.canonicalHead = 12;
    await indexer.syncCanonicalOnce();
    assert.equal(await repository.getCursor(EventsIndexer.CANONICAL_CURSOR), 12);

    archive.fetchCalls = [];
    archive.canonicalHead = 14;
    await indexer.syncCanonicalOnce();

    assert.deepEqual(
      archive.fetchCalls.map(({ status, from, to }) => [status, from, to]),
      [["CANONICAL", 8, 14]],
    );
    assert.equal(await repository.getCursor(EventsIndexer.CANONICAL_CURSOR), 14);
  });

  it("marks old pending events as orphaned using canonical cursor", async () => {
    const indexer = new EventsIndexer(archive, repository, {
      pollPendingIntervalMs: 60_000,
      pollCanonicalIntervalMs: 60_000,
      blockBatchSize: 10,
      canonicalOverlapBlocks: 5,
      orphanDepthBlocks: 30,
    });

    await repository.insertRawEvents(
      [
        {
          blockInfo: { height: 5 },
          eventData: [
            {
              accountUpdateId: "999",
              data: Array.from({ length: 7 }, (_, index) => `orphan-${index}`),
              transactionInfo: {
                hash: "tx-orphan-candidate",
                zkappAccountUpdateIds: [999],
              },
            },
          ],
        },
      ],
      "pending",
    );
    archive.canonicalHead = 50;
    await indexer.syncCanonicalOnce();

    const orphanedRows = await indexer.sweepOrphanedPendingEvents();
    assert.equal(orphanedRows, 1);
  });
});
