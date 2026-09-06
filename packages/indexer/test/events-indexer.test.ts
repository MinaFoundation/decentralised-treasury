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

  public async fetchEvents(
    options: FetchEventsOptions,
  ): Promise<ArchiveEventOutput[]> {
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
            data: Array.from(
              { length: 7 },
              (_, index) => `f-${height}-${index}`,
            ),
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
    let heartbeatCount = 0;
    const recordRuntimeHeartbeat =
      repository.recordRuntimeHeartbeat.bind(repository);
    repository.recordRuntimeHeartbeat = async (operationName: string) => {
      heartbeatCount += 1;
      await recordRuntimeHeartbeat(operationName);
    };
    const indexer = new EventsIndexer(archive, repository, {
      pollPendingIntervalMs: 60_000,
      pollCanonicalIntervalMs: 60_000,
      blockBatchSize: 10,
      startHeight: 0,
      pendingOverlapBlocks: 20,
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
    assert.equal(heartbeatCount, 6);

    archive.fetchCalls = [];
    archive.pendingHead = 27;
    await indexer.syncPendingOnce();

    assert.deepEqual(
      archive.fetchCalls.map(({ status, from, to }) => [status, from, to]),
      [
        ["PENDING", 5, 14],
        ["PENDING", 15, 24],
        ["PENDING", 25, 27],
      ],
    );
    assert.equal(await repository.getCursor(EventsIndexer.PENDING_CURSOR), 27);
    assert.equal(heartbeatCount, 12);
  });

  it("writes synced event rows through repository", async () => {
    const indexer = new EventsIndexer(archive, repository, {
      pollPendingIntervalMs: 60_000,
      pollCanonicalIntervalMs: 60_000,
      blockBatchSize: 10,
      startHeight: 0,
      pendingOverlapBlocks: 20,
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
      startHeight: 0,
      pendingOverlapBlocks: 20,
      canonicalOverlapBlocks: 5,
      orphanDepthBlocks: 30,
    });

    archive.canonicalHead = 12;
    await indexer.syncCanonicalOnce();
    assert.equal(
      await repository.getCursor(EventsIndexer.CANONICAL_CURSOR),
      12,
    );

    archive.fetchCalls = [];
    archive.canonicalHead = 14;
    await indexer.syncCanonicalOnce();

    assert.deepEqual(
      archive.fetchCalls.map(({ status, from, to }) => [status, from, to]),
      [["CANONICAL", 8, 14]],
    );
    assert.equal(
      await repository.getCursor(EventsIndexer.CANONICAL_CURSOR),
      14,
    );
  });

  it("marks old pending events as orphaned using canonical cursor", async () => {
    const indexer = new EventsIndexer(archive, repository, {
      pollPendingIntervalMs: 60_000,
      pollCanonicalIntervalMs: 60_000,
      blockBatchSize: 10,
      startHeight: 0,
      pendingOverlapBlocks: 20,
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

  it("starts polling without waiting for the initial catch-up", async () => {
    // A slow archive stands in for a cold start against a long chain, where the
    // canonical pass takes many minutes. start() used to await that pass before
    // installing the timers, so pending indexing did not begin until it finished.
    let releaseArchive: (() => void) | undefined;
    const archiveGate = new Promise<void>((resolve) => {
      releaseArchive = resolve;
    });
    const slowArchive = {
      getMaxBlockHeights: async () => {
        await archiveGate;
        return { canonicalMaxBlockHeight: 0, pendingMaxBlockHeight: 0 };
      },
      fetchEvents: async () => [],
    };

    const indexer = new EventsIndexer(slowArchive, repository, {
      pollPendingIntervalMs: 60_000,
      pollCanonicalIntervalMs: 60_000,
      blockBatchSize: 10,
      startHeight: 0,
      pendingOverlapBlocks: 0,
      canonicalOverlapBlocks: 0,
      orphanDepthBlocks: 30,
    });

    try {
      await Promise.race([
        indexer.start(),
        new Promise((_resolve, reject) =>
          setTimeout(
            () => reject(new Error("start() blocked on the initial catch-up")),
            1_000,
          ).unref(),
        ),
      ]);
    } finally {
      releaseArchive?.();
      await indexer.stop();
    }
  });

  it("passes the persisted canonical cursor and configured depth to the orphan sweep", async () => {
    const calls: Array<unknown[]> = [];
    const repositoryStub = {
      async getCursor(cursorName: string) {
        calls.push(["getCursor", cursorName]);
        return 75;
      },
      async markPendingAsOrphaned(
        canonicalCursor: number,
        orphanDepthBlocks: number,
      ) {
        calls.push([
          "markPendingAsOrphaned",
          canonicalCursor,
          orphanDepthBlocks,
        ]);
        return 2;
      },
      async recordRuntimeStarted(operationName: string) {
        calls.push(["recordRuntimeStarted", operationName]);
      },
      async recordRuntimeSucceeded(operationName: string) {
        calls.push(["recordRuntimeSucceeded", operationName]);
      },
      async recordRuntimeFailed() {
        assert.fail("the orphan sweep must not fail");
      },
    } as unknown as EventsRepository;
    const indexer = new EventsIndexer(archive, repositoryStub, {
      pollPendingIntervalMs: 60_000,
      pollCanonicalIntervalMs: 60_000,
      blockBatchSize: 10,
      startHeight: 0,
      pendingOverlapBlocks: 0,
      canonicalOverlapBlocks: 0,
      orphanDepthBlocks: 30,
    });

    assert.equal(await indexer.sweepOrphanedPendingEvents(), 2);
    assert.deepEqual(calls, [
      ["recordRuntimeStarted", "events:orphan-sweep"],
      ["getCursor", EventsIndexer.CANONICAL_CURSOR],
      ["markPendingAsOrphaned", 75, 30],
      ["recordRuntimeSucceeded", "events:orphan-sweep"],
    ]);
  });

  it("passes one fetched batch unchanged into the atomic ingest boundary", async () => {
    const fetchedRows: ArchiveEventOutput[] = [
      {
        blockInfo: { height: 4 },
        eventData: [
          {
            accountUpdateId: "4",
            data: Array.from({ length: 7 }, (_, index) => `batch-${index}`),
            transactionInfo: {
              hash: "tx-batch-4",
              zkappAccountUpdateIds: [4],
            },
          },
        ],
      },
    ];
    const calls: Array<unknown[]> = [];
    const archiveStub = {
      async getMaxBlockHeights() {
        calls.push(["getMaxBlockHeights"]);
        return {
          canonicalMaxBlockHeight: 0,
          pendingMaxBlockHeight: 4,
        };
      },
      async fetchEvents(options: FetchEventsOptions) {
        calls.push(["fetchEvents", options]);
        return fetchedRows;
      },
    };
    const repositoryStub = {
      async getCursor(cursorName: string) {
        calls.push(["getCursor", cursorName]);
        return null;
      },
      async ingestRawEventsAndAdvanceCursor(
        rows: ArchiveEventOutput[],
        status: string,
        cursorName: string,
        blockHeight: number,
        completeRange: { from: number; to: number },
      ) {
        calls.push([
          "ingestRawEventsAndAdvanceCursor",
          rows,
          status,
          cursorName,
          blockHeight,
          completeRange,
        ]);
        return { acceptedRows: 1, rejectedRows: 0 };
      },
      async recordRuntimeStarted(operationName: string) {
        calls.push(["recordRuntimeStarted", operationName]);
      },
      async recordRuntimeHeartbeat(operationName: string) {
        calls.push(["recordRuntimeHeartbeat", operationName]);
      },
      async recordRuntimeSucceeded(operationName: string) {
        calls.push(["recordRuntimeSucceeded", operationName]);
      },
      async recordRuntimeFailed() {
        assert.fail("the pending sync must not fail");
      },
    } as unknown as EventsRepository;
    const indexer = new EventsIndexer(archiveStub, repositoryStub, {
      pollPendingIntervalMs: 60_000,
      pollCanonicalIntervalMs: 60_000,
      blockBatchSize: 10,
      startHeight: 0,
      pendingOverlapBlocks: 0,
      canonicalOverlapBlocks: 0,
      orphanDepthBlocks: 0,
    });

    await indexer.syncPendingOnce();

    assert.deepEqual(calls, [
      ["recordRuntimeStarted", EventsIndexer.PENDING_CURSOR],
      ["getMaxBlockHeights"],
      ["getCursor", EventsIndexer.PENDING_CURSOR],
      ["recordRuntimeHeartbeat", EventsIndexer.PENDING_CURSOR],
      ["fetchEvents", { status: "PENDING", from: 0, to: 4 }],
      [
        "ingestRawEventsAndAdvanceCursor",
        fetchedRows,
        "pending",
        EventsIndexer.PENDING_CURSOR,
        4,
        { from: 0, to: 4 },
      ],
      ["recordRuntimeHeartbeat", EventsIndexer.PENDING_CURSOR],
      ["recordRuntimeSucceeded", EventsIndexer.PENDING_CURSOR],
    ]);
  });

  it("records an initial archive failure without blocking startup", async () => {
    archive.getMaxBlockHeights = async () => {
      throw new Error("archive unavailable");
    };
    const indexer = new EventsIndexer(archive, repository, {
      pollPendingIntervalMs: 60_000,
      pollCanonicalIntervalMs: 60_000,
      blockBatchSize: 10,
      startHeight: 0,
      pendingOverlapBlocks: 20,
      canonicalOverlapBlocks: 5,
      orphanDepthBlocks: 30,
    });

    await indexer.start();
    await Promise.all([
      indexer.syncPendingOnce(),
      indexer.syncCanonicalOnce(),
      indexer.sweepOrphanedPendingEvents(),
    ]);
    const operational = await repository.getOperationalStatus();
    assert.equal(operational.failedRuntimeOperations.length, 2);
    assert.equal(dataSource.isInitialized, true);
    await indexer.stop();
  });

  it("waits for tracked in-flight work before closing the repository", async () => {
    let releaseIngest!: () => void;
    const ingestBlocked = new Promise<void>((resolve) => {
      releaseIngest = resolve;
    });
    let ingestStarted!: () => void;
    const startedIngest = new Promise<void>((resolve) => {
      ingestStarted = resolve;
    });
    let closed = false;
    const repositoryStub = {
      async initialize() {},
      async close() {
        closed = true;
      },
      async getCursor() {
        return null;
      },
      async ingestRawEventsAndAdvanceCursor() {
        ingestStarted();
        await ingestBlocked;
        return { acceptedRows: 0, rejectedRows: 0 };
      },
      async recordRuntimeStarted() {},
      async recordRuntimeHeartbeat() {},
      async recordRuntimeSucceeded() {},
      async recordRuntimeFailed() {},
    } as unknown as EventsRepository;
    archive.pendingHead = 0;
    const indexer = new EventsIndexer(archive, repositoryStub, {
      pollPendingIntervalMs: 60_000,
      pollCanonicalIntervalMs: 60_000,
      blockBatchSize: 10,
      startHeight: 0,
      pendingOverlapBlocks: 0,
      canonicalOverlapBlocks: 0,
      orphanDepthBlocks: 0,
    });

    const sync = indexer.syncPendingOnce();
    await startedIngest;
    const stop = indexer.stop();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closed, false);
    releaseIngest();
    await Promise.all([sync, stop]);
    assert.equal(closed, true);
  });

  it("rejects unsafe polling options", () => {
    const base = {
      pollPendingIntervalMs: 60_000,
      pollCanonicalIntervalMs: 60_000,
      blockBatchSize: 10,
      startHeight: 0,
      pendingOverlapBlocks: 20,
      canonicalOverlapBlocks: 5,
      orphanDepthBlocks: 30,
    };
    for (const options of [
      { ...base, pollPendingIntervalMs: 0 },
      { ...base, pollCanonicalIntervalMs: 0 },
      { ...base, blockBatchSize: 0 },
      { ...base, startHeight: -1 },
      { ...base, pendingOverlapBlocks: -1 },
      { ...base, canonicalOverlapBlocks: -1 },
      { ...base, orphanDepthBlocks: -1 },
    ]) {
      assert.throws(() => new EventsIndexer(archive, repository, options));
    }
  });

  it("starts once, records initial operations, and stops once", async () => {
    const indexer = new EventsIndexer(archive, repository, {
      pollPendingIntervalMs: 60_000,
      pollCanonicalIntervalMs: 60_000,
      blockBatchSize: 10,
      startHeight: 0,
      pendingOverlapBlocks: 0,
      canonicalOverlapBlocks: 0,
      orphanDepthBlocks: 0,
    });
    await Promise.all([indexer.start(), indexer.start()]);
    await Promise.all([
      indexer.syncPendingOnce(),
      indexer.syncCanonicalOnce(),
      indexer.sweepOrphanedPendingEvents(),
    ]);
    assert.equal(archive.fetchCalls.length, 2);
    await Promise.all([indexer.stop(), indexer.stop()]);
    assert.equal(dataSource.isInitialized, false);
  });

  it("keeps periodic-style sync failures observable without rejecting", async () => {
    const indexer = new EventsIndexer(archive, repository, {
      pollPendingIntervalMs: 60_000,
      pollCanonicalIntervalMs: 60_000,
      blockBatchSize: 10,
      startHeight: 0,
      pendingOverlapBlocks: 0,
      canonicalOverlapBlocks: 0,
      orphanDepthBlocks: 0,
    });
    archive.getMaxBlockHeights = async () => {
      throw new Error("temporary archive failure");
    };
    await indexer.syncPendingOnce();
    const operational = await repository.getOperationalStatus();
    assert.equal(operational.failedRuntimeOperations.length, 1);
  });

  it("constructs from a validated complete config", () => {
    assert.ok(
      EventsIndexer.fromConfig({
        archiveNodeUrl: "https://archive.example",
        treasuryOwnerContractAddress: "B62qtest",
        knownEventTypes: ["proposalCreated"],
        archiveRequestTimeoutMs: 1_000,
        databaseUrl: "postgres://user:pass@localhost/db",
        databaseSchema: "public",
        pollPendingIntervalMs: 1_000,
        pollCanonicalIntervalMs: 2_000,
        eventsBlockBatchSize: 10,
        eventsStartHeight: 0,
        pendingOverlapBlocks: 1,
        canonicalOverlapBlocks: 1,
        orphanDepthBlocks: 2,
      }) instanceof EventsIndexer,
    );
  });
});
