import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { DataSource } from "typeorm";
import type { ArchiveEventOutput } from "../src/index.js";
import {
  ArchiveEventEntity,
  ArchiveEventRejectionEntity,
  EventsRepository,
  IndexerRuntimeStatusEntity,
} from "../src/index.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";

function buildArchiveEventOutput(height: number): ArchiveEventOutput {
  return {
    blockInfo: {
      height,
    },
    eventData: [
      {
        accountUpdateId: "1",
        data: Array.from(
          { length: 7 },
          (_, index) => `created-${height}-${index}`,
        ),
        transactionInfo: {
          hash: `tx-${height}`,
          zkappAccountUpdateIds: [1, 2],
        },
      },
      {
        accountUpdateId: "2",
        data: Array.from(
          { length: 3 },
          (_, index) => `vote-${height}-${index}`,
        ),
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

    const upsertedFirst = await repository.insertRawEvents(
      archiveEvents,
      "pending",
    );
    const upsertedSecond = await repository.insertRawEvents(
      archiveEvents,
      "pending",
    );

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

  it("quarantines an unresolved event type", async () => {
    const strictDataSource = createInMemoryDataSource();
    const strictRepository = new EventsRepository(strictDataSource, "public", {
      knownEventTypes: [],
    });
    await strictRepository.initialize();
    await strictDataSource.synchronize();

    try {
      const accepted = await strictRepository.insertRawEvents(
        [buildArchiveEventOutput(99)],
        "pending",
      );
      assert.equal(accepted, 0);
      assert.equal(
        await strictDataSource.getRepository(ArchiveEventEntity).count(),
        0,
      );
      const rejections = await strictDataSource
        .getRepository(ArchiveEventRejectionEntity)
        .find();
      assert.equal(rejections.length, 2);
      assert.equal(rejections[0].reasonCode, "UNRESOLVED_EVENT_TYPE");
    } finally {
      await strictRepository.close();
    }
  });

  it("uses lexical o1js discriminators and preserves the archive payload", async () => {
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
                  hash: "tx-multi-typed-created",
                  zkappAccountUpdateIds: [7],
                },
              },
              {
                accountUpdateId: "8",
                data: ["1", "333", "444"],
                transactionInfo: {
                  hash: "tx-multi-typed-vote",
                  zkappAccountUpdateIds: [8],
                },
              },
            ],
          },
        ],
        "pending",
      );

      const createdRow = await customDataSource
        .getRepository(ArchiveEventEntity)
        .findOneByOrFail({
          txHash: "tx-multi-typed-created",
          accountUpdateId: "7",
        });
      assert.equal(createdRow.eventType, "proposalCreated");
      assert.deepEqual(createdRow.rawEventData.data, ["0", "111", "222"]);

      const voteRow = await customDataSource
        .getRepository(ArchiveEventEntity)
        .findOneByOrFail({
          txHash: "tx-multi-typed-vote",
          accountUpdateId: "8",
        });
      assert.equal(voteRow.eventType, "proposalVoteDispatched");
      assert.deepEqual(voteRow.rawEventData.data, ["1", "333", "444"]);
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

  it("preserves all canonical payload fields when pending is re-seen", async () => {
    const canonical = [buildArchiveEventOutput(12)];
    canonical[0].blockInfo.timestamp = "2026-01-01T00:00:00.000Z";
    await repository.insertRawEvents(canonical, "canonical");
    const before = await dataSource
      .getRepository(ArchiveEventEntity)
      .findOneByOrFail({
        txHash: "tx-12",
        accountUpdateId: "1",
      });

    const pending = structuredClone(canonical);
    pending[0].blockInfo.height = 99;
    pending[0].blockInfo.timestamp = "2027-01-01T00:00:00.000Z";
    pending[0].eventData![0]!.data = ["different"];
    await repository.insertRawEvents(pending, "pending");

    const after = await dataSource
      .getRepository(ArchiveEventEntity)
      .findOneByOrFail({
        txHash: "tx-12",
        accountUpdateId: "1",
      });
    assert.equal(after.status, "canonical");
    assert.equal(after.blockHeight, 12);
    assert.equal(
      after.blockTimestamp?.toISOString(),
      "2026-01-01T00:00:00.000Z",
    );
    assert.deepEqual(after.rawEventData, before.rawEventData);
    assert.equal(after.changeSequence, before.changeSequence);
  });

  it("assigns block indexes and pages by bigint change sequence strings", async () => {
    await repository.insertRawEvents([buildArchiveEventOutput(15)], "pending");
    const rows = await dataSource.getRepository(ArchiveEventEntity).find({
      order: { changeSequence: "ASC" },
    });
    assert.deepEqual(
      rows.map((row) => row.blockEventIndex),
      [0, 1],
    );
    assert.equal(typeof rows[0].changeSequence, "string");

    const page = await repository.getEventsPage({
      eventTypes: ["proposalCreated"],
      includeUnknown: false,
      changeSequenceAfter: rows[0].changeSequence,
      limit: 10,
    });
    assert.deepEqual(
      page.map((row) => row.id),
      [rows[1].id],
    );
  });

  it("commits accepted rows, rejection records, and cursor together", async () => {
    const output = [buildArchiveEventOutput(20)];
    output[0].eventData!.splice(1, 0, {
      accountUpdateId: "404",
      data: ["bad"],
      transactionInfo: {
        hash: "tx-bad",
        zkappAccountUpdateIds: [1],
      },
    });

    const result = await repository.ingestRawEventsAndAdvanceCursor(
      output,
      "pending",
      "events:test",
      20,
    );
    assert.deepEqual(result, { acceptedRows: 2, rejectedRows: 1 });
    assert.equal(await repository.getCursor("events:test"), 20);
    assert.equal(await dataSource.getRepository(ArchiveEventEntity).count(), 2);
    const rejection = await dataSource
      .getRepository(ArchiveEventRejectionEntity)
      .findOneByOrFail({ reasonCode: "UNRESOLVED_ACCOUNT_UPDATE" });
    assert.equal(rejection.blockEventIndex, 1);
  });

  it("rolls back event rows when the atomic cursor batch fails", async () => {
    await repository.insertRawEvents([buildArchiveEventOutput(30)], "pending");
    await repository.setCursor("events:atomic", 30);
    await dataSource.query(
      "ALTER SEQUENCE archive_event_change_sequence_seq RESTART WITH 1",
    );

    await assert.rejects(
      repository.ingestRawEventsAndAdvanceCursor(
        [buildArchiveEventOutput(31)],
        "pending",
        "events:atomic",
        31,
      ),
    );
    assert.equal(await repository.getCursor("events:atomic"), 30);
    assert.equal(await dataSource.getRepository(ArchiveEventEntity).count(), 2);
  });

  it("records operation runtime status", async () => {
    const emptyOperational = await repository.getOperationalStatus();
    assert.deepEqual(emptyOperational.runtimeOperations, []);

    await repository.recordRuntimeStarted("events:test");
    await repository.recordRuntimeFailed(
      "events:test",
      new Error("archive down"),
    );
    let status = await dataSource
      .getRepository(IndexerRuntimeStatusEntity)
      .findOneByOrFail({ operationName: "events:test" });
    assert.equal(status.state, "failed");
    assert.equal(status.lastError, "archive down");
    assert.ok(status.lastFailedAt instanceof Date);
    let operational = await repository.getOperationalStatus();
    assert.equal(operational.unresolvedRejectionCount, 0);
    assert.equal(operational.failedRuntimeOperations.length, 1);
    assert.equal(
      operational.failedRuntimeOperations[0].operationName,
      "events:test",
    );
    assert.equal(operational.runtimeOperations.length, 1);
    assert.equal(operational.runtimeOperations[0].operationName, "events:test");
    assert.equal(operational.runtimeOperations[0].state, "failed");
    assert.ok(operational.runtimeOperations[0].updatedAt instanceof Date);
    assert.ok(operational.runtimeOperations[0].lastStartedAt instanceof Date);
    assert.equal(operational.runtimeOperations[0].lastSucceededAt, null);
    assert.ok(operational.runtimeOperations[0].lastFailedAt instanceof Date);
    assert.equal(operational.runtimeOperations[0].lastError, "archive down");

    await repository.recordRuntimeStarted("events:test");
    await dataSource.query(
      `UPDATE indexer_runtime_status
       SET updated_at = '2000-01-01T00:00:00.000Z'
       WHERE operation_name = 'events:test'`,
    );
    await repository.recordRuntimeHeartbeat("events:test");
    status = await dataSource
      .getRepository(IndexerRuntimeStatusEntity)
      .findOneByOrFail({ operationName: "events:test" });
    assert.equal(status.state, "running");
    assert.ok(status.updatedAt.getUTCFullYear() > 2000);

    await repository.recordRuntimeSucceeded("events:test");
    status = await dataSource
      .getRepository(IndexerRuntimeStatusEntity)
      .findOneByOrFail({ operationName: "events:test" });
    assert.equal(status.state, "succeeded");
    assert.equal(status.lastError, null);
    assert.ok(status.lastSucceededAt instanceof Date);
    operational = await repository.getOperationalStatus();
    assert.deepEqual(operational.failedRuntimeOperations, []);
    assert.equal(operational.runtimeOperations[0].state, "succeeded");
    assert.ok(operational.runtimeOperations[0].lastSucceededAt instanceof Date);
  });

  it("returns runtime timestamps that permit readiness freshness checks", async () => {
    await repository.recordRuntimeStarted("events:canonical");
    await repository.recordRuntimeSucceeded("events:canonical");
    await dataSource.query(
      `UPDATE indexer_runtime_status
       SET updated_at = '2000-01-01T00:00:00.000Z'
       WHERE operation_name = 'events:canonical'`,
    );

    const operational = await repository.getOperationalStatus();
    assert.equal(operational.runtimeOperations.length, 1);
    assert.equal(
      operational.runtimeOperations[0].updatedAt.toISOString(),
      "2000-01-01T00:00:00.000Z",
    );
    assert.equal(operational.runtimeOperations[0].state, "succeeded");
  });

  it("reopens a resolved rejection when the observation appears again", async () => {
    const malformed = [buildArchiveEventOutput(40)];
    malformed[0].eventData![0]!.transactionInfo!.zkappAccountUpdateIds = [];
    await repository.insertRawEvents(malformed, "pending");
    const rejections = dataSource.getRepository(ArchiveEventRejectionEntity);
    let rejection = await rejections.findOneByOrFail({
      reasonCode: "UNRESOLVED_ACCOUNT_UPDATE",
    });
    assert.equal(await repository.resolveRejection(String(rejection.id)), true);
    assert.equal(
      await repository.resolveRejection(String(rejection.id)),
      false,
    );

    await repository.insertRawEvents(malformed, "pending");
    rejection = await rejections.findOneByOrFail({ id: rejection.id });
    assert.ok(Number(rejection.occurrenceCount) > 1);
    assert.equal(rejection.resolutionStatus, "unresolved");
    assert.equal(rejection.resolvedAt, null);
    assert.equal(
      (await repository.getOperationalStatus()).unresolvedRejectionCount,
      1,
    );
    await assert.rejects(repository.resolveRejection("0"), /positive decimal/);
  });

  it("rejects invalid repository inputs", async () => {
    await assert.rejects(
      repository.insertRawEvents([], "other"),
      /status must/,
    );
    await assert.rejects(repository.setCursor(" events", 1), /cursorName/);
    await assert.rejects(
      repository.getEventsPage({
        eventTypes: [],
        includeUnknown: true,
        changeSequenceAfter: "-1",
        limit: 10,
      }),
      /changeSequenceAfter/,
    );
    await assert.rejects(
      repository.getEventsPage({
        eventTypes: [],
        includeUnknown: true,
        changeSequenceAfter: "0",
        updatedAfter: new Date(0),
        eventIdAfter: "0",
        limit: 10,
      }),
      /cannot be combined/,
    );
    assert.throws(
      () =>
        new EventsRepository(dataSource, "bad-schema", {
          knownEventTypes: ["proposalCreated"],
        }),
      /SQL identifier/,
    );
    assert.throws(
      () =>
        new EventsRepository(dataSource, "public", {
          knownEventTypes: ["duplicate", "duplicate"],
        }),
      /duplicate/,
    );
  });

  it("quarantines malformed observations without rejecting valid siblings", async () => {
    const valid = buildArchiveEventOutput(50).eventData![0]!;
    const malformed = [
      { blockInfo: { height: -1 }, eventData: null },
      { blockInfo: { height: 50 }, eventData: "bad" },
      { blockInfo: { height: 50 }, eventData: [null] },
      {
        blockInfo: { height: 50, timestamp: "not-a-time" },
        eventData: [valid],
      },
      {
        blockInfo: { height: 50 },
        eventData: [
          { ...valid, accountUpdateId: "" },
          {
            ...valid,
            accountUpdateId: "9007199254740993",
            transactionInfo: {
              ...valid.transactionInfo,
              zkappAccountUpdateIds: [1],
            },
          },
          { ...valid, transactionInfo: { zkappAccountUpdateIds: [1] } },
          {
            ...valid,
            transactionInfo: {
              hash: "tx-bad-ids",
              zkappAccountUpdateIds: ["1"],
            },
          },
          { ...valid, data: [1] },
          valid,
        ],
      },
    ] as unknown as ArchiveEventOutput[];

    const result = await repository.ingestRawEventsAndAdvanceCursor(
      malformed,
      "pending",
      "events:malformed",
      50,
    );
    assert.equal(result.acceptedRows, 1);
    assert.equal(result.rejectedRows, 9);
    assert.equal(await repository.getCursor("events:malformed"), 50);
    const codes = await dataSource
      .getRepository(ArchiveEventRejectionEntity)
      .find({ order: { id: "ASC" } });
    assert.deepEqual(
      new Set(codes.map((row) => row.reasonCode)),
      new Set([
        "INVALID_BLOCK_HEIGHT",
        "INVALID_EVENT_LIST",
        "INVALID_EVENT",
        "INVALID_BLOCK_TIMESTAMP",
        "INVALID_ACCOUNT_UPDATE_ID",
        "INVALID_TRANSACTION_HASH",
        "INVALID_ACCOUNT_UPDATE_IDS",
        "INVALID_EVENT_DATA",
      ]),
    );
  });

  it("quarantines invalid multi-event discriminators", async () => {
    const typedDataSource = createInMemoryDataSource();
    const typedRepository = new EventsRepository(typedDataSource, "public", {
      knownEventTypes: ["zEvent", "aEvent"],
    });
    await typedRepository.initialize();
    await typedDataSource.synchronize();
    try {
      const template = buildArchiveEventOutput(60).eventData![0]!;
      const result = await typedRepository.ingestRawEventsAndAdvanceCursor(
        [
          {
            blockInfo: { height: 60 },
            eventData: [
              { ...template, data: ["-1"] },
              {
                ...template,
                accountUpdateId: "2",
                data: ["2"],
                transactionInfo: {
                  hash: "tx-out-of-range",
                  zkappAccountUpdateIds: [2],
                },
              },
            ],
          },
        ],
        "canonical",
        "events:typed",
        60,
      );
      assert.deepEqual(result, { acceptedRows: 0, rejectedRows: 2 });
    } finally {
      await typedRepository.close();
    }
  });

  it("supports legacy page filters during cursor transition", async () => {
    await repository.insertRawEvents([buildArchiveEventOutput(70)], "pending");
    assert.deepEqual(
      await repository.getEventsPage({
        eventTypes: [],
        includeUnknown: false,
        updatedAfter: new Date(0),
        eventIdAfter: "0",
        limit: 10,
      }),
      [],
    );
    const page = await repository.getEventsPage({
      eventTypes: ["proposalCreated"],
      includeUnknown: true,
      updatedAfter: new Date(0),
      eventIdAfter: "0",
      limit: 10,
    });
    assert.equal(page.length, 2);
    assert.equal(await repository.markPendingAsOrphaned(5, 10), 0);
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

  it("reserves an event index for a malformed sibling", async () => {
    const template = buildArchiveEventOutput(80).eventData![0]!;
    const validSecond = {
      ...structuredClone(template),
      data: ["valid-second-event"],
    };
    const firstObservation = {
      blockInfo: { height: 80 },
      eventData: [{ ...structuredClone(template), data: [1] }, validSecond],
    } as unknown as ArchiveEventOutput;

    const firstResult = await repository.ingestRawEventsAndAdvanceCursor(
      [firstObservation],
      "pending",
      "events:event-index",
      80,
      { from: 80, to: 80 },
    );
    assert.deepEqual(firstResult, { acceptedRows: 1, rejectedRows: 1 });
    const firstStored = await dataSource
      .getRepository(ArchiveEventEntity)
      .findOneByOrFail({ txHash: "tx-80" });
    assert.equal(firstStored.eventIndex, 1);
    assert.equal(firstStored.blockEventIndex, 1);

    const correctedObservation = {
      blockInfo: { height: 80 },
      eventData: [
        { ...structuredClone(template), data: ["corrected-first-event"] },
        validSecond,
      ],
    } as ArchiveEventOutput;
    const correctedResult = await repository.ingestRawEventsAndAdvanceCursor(
      [correctedObservation],
      "pending",
      "events:event-index",
      80,
      { from: 80, to: 80 },
    );
    assert.deepEqual(correctedResult, { acceptedRows: 2, rejectedRows: 0 });
    const correctedRows = await dataSource
      .getRepository(ArchiveEventEntity)
      .find({ order: { eventIndex: "ASC" } });
    assert.deepEqual(
      correctedRows.map((row) => row.eventIndex),
      [0, 1],
    );
    assert.deepEqual(correctedRows[1].rawEventData.data, [
      "valid-second-event",
    ]);
  });

  it("quarantines an immutable event payload conflict", async () => {
    const original = buildArchiveEventOutput(81);
    await repository.insertRawEvents([original], "pending");
    const conflicting = structuredClone(original);
    conflicting.eventData![0]!.data = ["changed-contract-event"];

    const accepted = await repository.insertRawEvents(
      [conflicting],
      "canonical",
    );
    assert.equal(accepted, 1);
    const protectedRow = await dataSource
      .getRepository(ArchiveEventEntity)
      .findOneByOrFail({
        txHash: "tx-81",
        accountUpdateId: "1",
        eventIndex: 0,
      });
    assert.equal(protectedRow.status, "pending");
    assert.deepEqual(protectedRow.rawEventData, original.eventData![0]);
    const rejection = await dataSource
      .getRepository(ArchiveEventRejectionEntity)
      .findOneByOrFail({ reasonCode: "IMMUTABLE_EVENT_CONFLICT" });
    assert.equal(rejection.archiveStatus, "canonical");
  });

  it("reserves an immutable conflict position in authoritative block order", async () => {
    const orderedEvent = (
      hash: string,
      sequenceNumber: number,
      accountUpdateId: string,
      data: string,
    ) => ({
      accountUpdateId,
      data: [data],
      transactionInfo: {
        hash,
        sequenceNumber,
        zkappAccountUpdateIds: [Number(accountUpdateId)],
      },
    });
    const original: ArchiveEventOutput[] = [
      {
        blockInfo: { height: 83 },
        eventData: [orderedEvent("tx-a", 1, "11", "a")],
      },
      {
        blockInfo: { height: 83 },
        eventData: [orderedEvent("tx-b", 2, "12", "b")],
      },
      {
        blockInfo: { height: 83 },
        eventData: [orderedEvent("tx-c", 3, "13", "c")],
      },
    ];
    await repository.insertRawEvents(original, "pending");

    const conflicting = structuredClone(original);
    conflicting[1]!.eventData![0]!.data = ["changed-b"];
    await repository.insertRawEvents(conflicting, "canonical");

    const rows = await dataSource.getRepository(ArchiveEventEntity).find({
      order: { blockEventIndex: "ASC" },
    });
    assert.deepEqual(
      rows.map((row) => [row.txHash, row.blockEventIndex, row.status]),
      [
        ["tx-a", 0, "canonical"],
        ["tx-b", 1, "pending"],
        ["tx-c", 2, "canonical"],
      ],
    );
    assert.equal(
      await dataSource
        .getRepository(ArchiveEventRejectionEntity)
        .countBy({ reasonCode: "IMMUTABLE_EVENT_CONFLICT" }),
      1,
    );
  });

  it("quarantines an immutable event type conflict", async () => {
    const typedDataSource = createInMemoryDataSource();
    const typedRepository = new EventsRepository(typedDataSource, "public", {
      knownEventTypes: ["zEvent", "aEvent"],
    });
    await typedRepository.initialize();
    await typedDataSource.synchronize();
    try {
      const original = buildArchiveEventOutput(82);
      original.eventData = original.eventData!.slice(0, 1);
      original.eventData[0]!.data = ["0", "contract-payload"];
      await typedRepository.insertRawEvents([original], "pending");

      const conflicting = structuredClone(original);
      conflicting.eventData![0]!.data = ["1", "contract-payload"];
      const accepted = await typedRepository.insertRawEvents(
        [conflicting],
        "canonical",
      );

      assert.equal(accepted, 0);
      const protectedRow = await typedDataSource
        .getRepository(ArchiveEventEntity)
        .findOneByOrFail({ txHash: "tx-82" });
      assert.equal(protectedRow.eventType, "aEvent");
      assert.equal(protectedRow.status, "pending");
      assert.equal(
        await typedDataSource
          .getRepository(ArchiveEventRejectionEntity)
          .countBy({ reasonCode: "IMMUTABLE_EVENT_CONFLICT" }),
        1,
      );
    } finally {
      await typedRepository.close();
    }
  });

  it("keeps a range cursor monotonic when an older writer finishes later", async () => {
    await repository.ingestRawEventsAndAdvanceCursor(
      [buildArchiveEventOutput(90)],
      "pending",
      "events:concurrent",
      90,
    );
    await repository.ingestRawEventsAndAdvanceCursor(
      [buildArchiveEventOutput(89)],
      "pending",
      "events:concurrent",
      89,
    );
    assert.equal(await repository.getCursor("events:concurrent"), 90);

    await repository.setCursor("events:manual", 90);
    await repository.setCursor("events:manual", 89);
    assert.equal(await repository.getCursor("events:manual"), 90);
  });

  it("stores Archive block identity without treating it as event order", async () => {
    const output = buildArchiveEventOutput(91);
    output.blockInfo = {
      height: 91,
      timestamp: "2026-09-04T12:00:00.000Z",
      globalSlotSinceGenesis: 1234,
      stateHash: "3Nstate-hash",
      parentHash: "3Nparent-hash",
      chainStatus: "canonical",
    };
    await repository.insertRawEvents([output], "canonical");
    const row = await dataSource
      .getRepository(ArchiveEventEntity)
      .findOneByOrFail({ txHash: "tx-91", accountUpdateId: "1" });
    assert.equal(row.globalSlotSinceGenesis, 1234);
    assert.equal(row.stateHash, "3Nstate-hash");
    assert.equal(row.parentHash, "3Nparent-hash");
    assert.equal(row.chainStatus, "canonical");
  });

  it("accepts the full UInt32 global-slot range", async () => {
    for (const [index, globalSlotSinceGenesis] of [
      2_147_483_648, 4_294_967_295,
    ].entries()) {
      const output = buildArchiveEventOutput(94 + index);
      output.blockInfo = {
        height: 94 + index,
        globalSlotSinceGenesis,
      };
      assert.equal(await repository.insertRawEvents([output], "canonical"), 2);
    }

    const rows = await dataSource.getRepository(ArchiveEventEntity).find({
      order: { globalSlotSinceGenesis: "ASC" },
    });
    assert.deepEqual(
      rows.map((row) => row.globalSlotSinceGenesis),
      [2_147_483_648, 2_147_483_648, 4_294_967_295, 4_294_967_295],
    );
  });

  it("quarantines a global slot above the UInt32 maximum", async () => {
    const output = buildArchiveEventOutput(93);
    output.blockInfo = {
      height: 93,
      globalSlotSinceGenesis: 4_294_967_296,
    };

    assert.equal(await repository.insertRawEvents([output], "canonical"), 0);
    const rejections = await dataSource
      .getRepository(ArchiveEventRejectionEntity)
      .find();
    assert.equal(rejections.length, 2);
    assert.equal(rejections[0].reasonCode, "INVALID_BLOCK_IDENTITY");
    assert.match(rejections[0].reason, /must be in the UInt32 range/);
  });

  it("orders a block by transaction, account update, and event", async () => {
    const event = (
      hash: string,
      sequenceNumber: number,
      accountUpdateId: string,
      zkappAccountUpdateIds: number[],
      data: string,
    ) => ({
      accountUpdateId,
      data: [data],
      transactionInfo: {
        hash,
        sequenceNumber,
        zkappAccountUpdateIds,
      },
    });
    const lateTransaction: ArchiveEventOutput = {
      blockInfo: { height: 92 },
      eventData: [event("tx-late", 9, "31", [31], "late")],
    };
    const earlySecondUpdate: ArchiveEventOutput = {
      blockInfo: { height: 92 },
      eventData: [
        event("tx-early", 2, "12", [11, 12], "second-update-first-event"),
        event("tx-early", 2, "12", [11, 12], "second-update-second-event"),
      ],
    };
    const earlyFirstUpdate: ArchiveEventOutput = {
      blockInfo: { height: 92 },
      eventData: [event("tx-early", 2, "11", [11, 12], "first-update")],
    };

    await repository.insertRawEvents(
      [lateTransaction, earlySecondUpdate, earlyFirstUpdate],
      "pending",
    );
    let rows = await dataSource.getRepository(ArchiveEventEntity).find({
      order: { blockEventIndex: "ASC" },
    });
    assert.deepEqual(
      rows.map((row) => [row.txHash, row.accountUpdateId, row.eventIndex]),
      [
        ["tx-early", "11", 0],
        ["tx-early", "12", 0],
        ["tx-early", "12", 1],
        ["tx-late", "31", 0],
      ],
    );

    await repository.insertRawEvents(
      [earlyFirstUpdate, earlySecondUpdate, lateTransaction],
      "canonical",
    );
    rows = await dataSource.getRepository(ArchiveEventEntity).find({
      order: { blockEventIndex: "ASC" },
    });
    assert.deepEqual(
      rows.map((row) => [row.txHash, row.accountUpdateId, row.eventIndex]),
      [
        ["tx-early", "11", 0],
        ["tx-early", "12", 0],
        ["tx-early", "12", 1],
        ["tx-late", "31", 0],
      ],
    );
  });

  it("uses response order when a legacy block omits transaction sequence", async () => {
    const first = buildArchiveEventOutput(92);
    first.eventData = first.eventData!.slice(0, 1);
    const second = structuredClone(first);
    second.eventData![0]!.transactionInfo!.hash = "tx-92-second";
    second.eventData![0]!.accountUpdateId = "2";

    await repository.insertRawEvents([first, second], "pending");
    const initial = await dataSource.getRepository(ArchiveEventEntity).find({
      order: { blockEventIndex: "ASC" },
    });
    assert.deepEqual(
      initial.map((row) => row.txHash),
      ["tx-92", "tx-92-second"],
    );

    await repository.insertRawEvents([second, first], "canonical");
    const reordered = await dataSource.getRepository(ArchiveEventEntity).find({
      order: { blockEventIndex: "ASC" },
    });
    assert.deepEqual(
      reordered.map((row) => row.txHash),
      ["tx-92-second", "tx-92"],
    );
  });

  it("enriches legacy rows with transaction order without an immutable conflict", async () => {
    const first = buildArchiveEventOutput(92);
    first.eventData = first.eventData!.slice(0, 1);
    const second = structuredClone(first);
    second.eventData![0]!.transactionInfo!.hash = "tx-92-second";
    second.eventData![0]!.accountUpdateId = "2";

    await repository.insertRawEvents([first, second], "pending");
    const initial = await dataSource.getRepository(ArchiveEventEntity).find({
      order: { blockEventIndex: "ASC" },
    });
    assert.deepEqual(
      initial.map((row) => [row.txHash, row.blockEventIndex]),
      [
        ["tx-92", 0],
        ["tx-92-second", 1],
      ],
    );

    first.eventData![0]!.transactionInfo!.sequenceNumber = 7;
    second.eventData![0]!.transactionInfo!.sequenceNumber = 3;
    assert.equal(
      await repository.insertRawEvents([first, second], "pending"),
      2,
    );

    const enriched = await dataSource.getRepository(ArchiveEventEntity).find({
      order: { blockEventIndex: "ASC" },
    });
    assert.deepEqual(
      enriched.map((row) => [
        row.txHash,
        row.blockEventIndex,
        row.rawEventData.transactionInfo?.sequenceNumber,
      ]),
      [
        ["tx-92-second", 0, 3],
        ["tx-92", 1, 7],
      ],
    );
    assert.equal(
      await dataSource
        .getRepository(ArchiveEventRejectionEntity)
        .countBy({ reasonCode: "IMMUTABLE_EVENT_CONFLICT" }),
      0,
    );
  });

  it("quarantines an invalid transaction sequence", async () => {
    const output = buildArchiveEventOutput(92);
    output.eventData = output.eventData!.slice(0, 1);
    output.eventData[0]!.transactionInfo!.sequenceNumber = -1;

    assert.equal(await repository.insertRawEvents([output], "pending"), 0);
    const rejection = await dataSource
      .getRepository(ArchiveEventRejectionEntity)
      .findOneByOrFail({ reasonCode: "INVALID_TRANSACTION_SEQUENCE" });
    assert.match(rejection.reason, /nonnegative safe integer/);
  });

  it("quarantines a block with partial transaction sequence metadata", async () => {
    const output = buildArchiveEventOutput(92);
    output.eventData![0]!.transactionInfo!.sequenceNumber = 1;

    assert.equal(await repository.insertRawEvents([output], "pending"), 0);
    assert.equal(
      await dataSource.getRepository(ArchiveEventEntity).countBy({
        blockHeight: 92,
      }),
      0,
    );
    assert.equal(
      await dataSource
        .getRepository(ArchiveEventRejectionEntity)
        .countBy({ reasonCode: "INCOMPLETE_TRANSACTION_SEQUENCE" }),
      2,
    );
  });

  it("retires a missing pending identity from a complete refreshed range", async () => {
    const forkA = buildArchiveEventOutput(93);
    const forkB = structuredClone(forkA);
    forkB.eventData![0]!.transactionInfo!.hash = "tx-93-fork-b";
    forkB.eventData = forkB.eventData!.slice(0, 1);
    forkA.eventData = forkA.eventData!.slice(0, 1);

    await repository.ingestRawEventsAndAdvanceCursor(
      [forkA],
      "pending",
      "events:fork-refresh",
      93,
      { from: 93, to: 93 },
    );
    await repository.ingestRawEventsAndAdvanceCursor(
      [forkB],
      "pending",
      "events:fork-refresh",
      93,
      { from: 93, to: 93 },
    );

    const rows = await dataSource.getRepository(ArchiveEventEntity).find({
      order: { txHash: "ASC" },
    });
    assert.deepEqual(
      rows.map((row) => [row.txHash, row.status]),
      [
        ["tx-93", "orphaned"],
        ["tx-93-fork-b", "pending"],
      ],
    );
  });

  it("does not retire pending rows from a range with a rejected observation", async () => {
    const existing = buildArchiveEventOutput(94);
    existing.eventData = existing.eventData!.slice(0, 1);
    await repository.ingestRawEventsAndAdvanceCursor(
      [existing],
      "pending",
      "events:failed-refresh",
      94,
      { from: 94, to: 94 },
    );

    const malformed = structuredClone(existing);
    malformed.eventData![0]!.data = [1] as unknown as string[];
    malformed.eventData![0]!.transactionInfo!.hash = "tx-94-other";
    const result = await repository.ingestRawEventsAndAdvanceCursor(
      [malformed],
      "pending",
      "events:failed-refresh",
      94,
      { from: 94, to: 94 },
    );
    assert.deepEqual(result, { acceptedRows: 0, rejectedRows: 1 });
    const priorRow = await dataSource
      .getRepository(ArchiveEventEntity)
      .findOneByOrFail({ txHash: "tx-94" });
    assert.equal(priorRow.status, "pending");
  });

  it("does not retire pending rows when Archive returns an out-of-range event", async () => {
    const existing = buildArchiveEventOutput(95);
    existing.eventData = existing.eventData!.slice(0, 1);
    await repository.ingestRawEventsAndAdvanceCursor(
      [existing],
      "pending",
      "events:out-of-range-refresh",
      95,
      { from: 95, to: 95 },
    );

    const foreign = buildArchiveEventOutput(96);
    foreign.eventData = foreign.eventData!.slice(0, 1);
    const result = await repository.ingestRawEventsAndAdvanceCursor(
      [foreign],
      "pending",
      "events:out-of-range-refresh",
      95,
      { from: 95, to: 95 },
    );

    assert.deepEqual(result, { acceptedRows: 0, rejectedRows: 1 });
    assert.equal(
      (
        await dataSource
          .getRepository(ArchiveEventEntity)
          .findOneByOrFail({ txHash: "tx-95" })
      ).status,
      "pending",
    );
    assert.equal(
      await dataSource
        .getRepository(ArchiveEventEntity)
        .countBy({ txHash: "tx-96" }),
      0,
    );
    assert.equal(
      await dataSource
        .getRepository(ArchiveEventRejectionEntity)
        .countBy({ reasonCode: "EVENT_OUTSIDE_COMPLETE_RANGE" }),
      1,
    );
  });
});
