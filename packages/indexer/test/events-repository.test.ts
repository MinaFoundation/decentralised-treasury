import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { DataSource } from "typeorm";
import type { ArchiveEventOutput } from "../src/index.js";
import { ArchiveEventEntity, EventsRepository } from "../src/index.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";

function buildArchiveEventOutput(height: number): ArchiveEventOutput {
  return {
    blockInfo: {
      height,
    },
    eventData: [
      {
        accountUpdateId: "1",
        data: Array.from({ length: 7 }, (_, index) => `created-${height}-${index}`),
        transactionInfo: {
          hash: `tx-${height}`,
          zkappAccountUpdateIds: [1, 2],
        },
      },
      {
        accountUpdateId: "2",
        data: Array.from({ length: 3 }, (_, index) => `vote-${height}-${index}`),
        transactionInfo: {
          hash: `tx-${height}`,
          zkappAccountUpdateIds: [1, 2],
        },
      },
    ],
  };
}

describe("EventsRepository", () => {
  let dataSource: DataSource;
  let repository: EventsRepository;

  beforeEach(async () => {
    dataSource = createInMemoryDataSource();
    repository = new EventsRepository(dataSource, "public", {
      knownEventTypes: ["proposalCreated"],
    });
    await repository.initialize();
    await dataSource.synchronize();
  });

  afterEach(async () => {
    await repository.close();
  });

  it("upserts raw events by composite event identity", async () => {
    const archiveEvents = [buildArchiveEventOutput(10)];

    const upsertedFirst = await repository.insertRawEvents(archiveEvents, "pending");
    const upsertedSecond = await repository.insertRawEvents(archiveEvents, "pending");

    assert.equal(upsertedFirst, 2);
    assert.equal(upsertedSecond, 2);

    const rows = await dataSource.getRepository(ArchiveEventEntity).find({
      order: {
        accountUpdateIndex: "ASC",
      },
    });

    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, "pending");
    assert.equal(rows[0].pendingSeenAtHeight, 10);
    assert.equal(rows[0].txHash, "tx-10");
    assert.equal(rows[0].eventType, "proposalCreated");
    assert.equal(rows[1].eventType, "proposalCreated");
    assert.deepEqual(rows[0].rawEventData, archiveEvents[0].eventData?.[0]);
  });

  it("throws when event type cannot be resolved at ingest", async () => {
    const strictDataSource = createInMemoryDataSource();
    const strictRepository = new EventsRepository(strictDataSource, "public", {
      knownEventTypes: [],
    });
    await strictRepository.initialize();
    await strictDataSource.synchronize();

    try {
      await assert.rejects(
        strictRepository.insertRawEvents([buildArchiveEventOutput(99)], "pending"),
        /Unable to resolve event type/,
      );
    } finally {
      await strictRepository.close();
    }
  });

  it("infers event type from encoded payload for multi-type contracts", async () => {
    const customDataSource = createInMemoryDataSource();
    const customRepository = new EventsRepository(customDataSource, "public", {
      knownEventTypes: ["proposalVoteDispatched", "proposalCreated"],
    });
    await customRepository.initialize();
    await customDataSource.synchronize();

    try {
      await customRepository.insertRawEvents(
        [
          {
            blockInfo: { height: 100 },
            eventData: [
              {
                accountUpdateId: "7",
                data: ["0", "111", "222"],
                transactionInfo: {
                  hash: "tx-multi-typed",
                  zkappAccountUpdateIds: [7],
                },
              },
            ],
          },
        ],
        "pending",
      );

      const row = await customDataSource
        .getRepository(ArchiveEventEntity)
        .findOneByOrFail({
          txHash: "tx-multi-typed",
          accountUpdateId: "7",
        });
      assert.equal(row.eventType, "proposalCreated");
    } finally {
      await customRepository.close();
    }
  });

  it("uses the only configured event type for single-type contracts", async () => {
    const customDataSource = createInMemoryDataSource();
    const customRepository = new EventsRepository(customDataSource, "public", {
      knownEventTypes: ["proposalCreated"],
    });
    await customRepository.initialize();
    await customDataSource.synchronize();

    try {
      await customRepository.insertRawEvents(
        [
          {
            blockInfo: { height: 101 },
            eventData: [
              {
                accountUpdateId: "8",
                data: [
                  // Mimics regular event payload with no leading type index.
                  "289304293042930493209",
                  "333",
                  "444",
                ],
                transactionInfo: {
                  hash: "tx-single-typed",
                  zkappAccountUpdateIds: [8],
                },
              },
            ],
          },
        ],
        "pending",
      );

      const row = await customDataSource
        .getRepository(ArchiveEventEntity)
        .findOneByOrFail({
          txHash: "tx-single-typed",
          accountUpdateId: "8",
        });
      assert.equal(row.eventType, "proposalCreated");
    } finally {
      await customRepository.close();
    }
  });

  it("preserves canonical status when pending is re-seen", async () => {
    const archiveEvents = [buildArchiveEventOutput(11)];

    await repository.insertRawEvents(archiveEvents, "pending");
    await repository.insertRawEvents(archiveEvents, "canonical");
    await repository.insertRawEvents(archiveEvents, "pending");

    const rows = await dataSource.getRepository(ArchiveEventEntity).find({
      order: {
        accountUpdateIndex: "ASC",
      },
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, "canonical");
    assert.equal(rows[1].status, "canonical");
  });

  it("marks old pending rows as orphaned using canonical cutoff", async () => {
    await repository.insertRawEvents([buildArchiveEventOutput(10)], "pending");
    await repository.insertRawEvents([buildArchiveEventOutput(45)], "pending");

    const orphaned = await repository.markPendingAsOrphaned(50, 30);
    assert.equal(orphaned, 2);

    const rows = await dataSource.getRepository(ArchiveEventEntity).find({
      order: {
        txHash: "ASC",
        accountUpdateIndex: "ASC",
      },
    });
    assert.equal(rows[0].status, "orphaned");
    assert.equal(rows[1].status, "orphaned");
    assert.equal(rows[2].status, "pending");
    assert.equal(rows[3].status, "pending");
  });

  it("persists and updates cursors", async () => {
    const cursorName = "events";

    const initial = await repository.getCursor(cursorName);
    assert.equal(initial, null);

    await repository.setCursor(cursorName, 25);
    const first = await repository.getCursor(cursorName);
    assert.equal(first, 25);

    await repository.setCursor(cursorName, 42);
    const second = await repository.getCursor(cursorName);
    assert.equal(second, 42);
  });
});
