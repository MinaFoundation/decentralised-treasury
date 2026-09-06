import assert from "node:assert/strict";
import { createServer } from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  type ArchiveEventOutput,
  ArchiveEventEntity,
  EventsApiServer,
  EventsRepository,
} from "@repo/indexer";
import { type DataSource, TypeORMError } from "typeorm";
import {
  EventProcessorRouter,
  EventsProcessor,
  IndexerEventsApiClient,
  IndexerEventsApiError,
  ProcessorEventFailureEntity,
  ProcessorOffsetEntity,
  ProcessorRuntimeStatusEntity,
  type SequencedArchiveEvent,
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

function buildSequencedEvent(input: {
  id: string;
  changeSequence: string;
  eventKey: string;
  payload: string;
  status?: "pending" | "canonical" | "orphaned";
}): SequencedArchiveEvent {
  return Object.assign(new ArchiveEventEntity(), {
    id: input.id,
    changeSequence: input.changeSequence,
    status: input.status ?? "pending",
    pendingSeenAtHeight: 10,
    blockHeight: 10,
    blockTimestamp: null,
    globalSlotSinceGenesis: 10,
    stateHash: "3Nstate",
    parentHash: "3Nparent",
    chainStatus: input.status ?? "pending",
    eventType: "testProjectionCreated",
    txHash: `tx-${input.id}`,
    accountUpdateId: input.id,
    accountUpdateIndex: 0,
    eventIndex: 0,
    blockEventIndex: 0,
    rawEventData: { data: [input.eventKey, input.payload] },
    indexedAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date(
      Date.UTC(2026, 0, 1, 0, 0, Number(input.changeSequence)),
    ),
  });
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

async function simulateChangeSequenceTrigger(
  dataSource: DataSource,
  txHash: string,
): Promise<void> {
  // Production migrations install the archive event update trigger. pg-mem
  // does not execute that PostgreSQL trigger during synchronized tests.
  await dataSource.query(
    `UPDATE "archive_events"
     SET "change_sequence" = nextval('archive_event_change_sequence_seq')
     WHERE "tx_hash" = $1`,
    [txHash],
  );
}

describe("EventsProcessor", () => {
  let dataSource: DataSource;
  let repository: EventsRepository;
  let eventsApiServer: EventsApiServer;
  let processor: EventsProcessor;
  let eventHandler: TestProjectionEventHandler;

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
    eventHandler = new TestProjectionEventHandler();
    processor = new EventsProcessor(
      dataSource,
      new EventProcessorRouter([eventHandler]),
      {
        processorName: "test-projection-processor",
        pollIntervalMs: 60_000,
        batchSize: 2,
        retryBaseDelayMs: 1,
        retryMaxDelayMs: 4,
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

  it("rejects invalid processor settings", () => {
    const createProcessor = (
      processorOptions: Partial<{
        processorName: string;
        pollIntervalMs: number;
        batchSize: number;
        maxAttempts: number;
        retryBaseDelayMs: number;
        retryMaxDelayMs: number;
      }>,
    ) =>
      new EventsProcessor(
        dataSource,
        new EventProcessorRouter([]),
        {
          processorName: "invalid-options-processor",
          pollIntervalMs: 60_000,
          batchSize: 1,
          ...processorOptions,
        },
        {
          fetchEventsPage: async () => ({ items: [], nextCursor: null }),
        },
      );

    assert.throws(
      () => createProcessor({ processorName: "" }),
      /processorName/,
    );
    assert.throws(
      () => createProcessor({ processorName: " invalid " }),
      /processorName/,
    );
    assert.throws(
      () => createProcessor({ pollIntervalMs: 0 }),
      /pollIntervalMs/,
    );
    assert.throws(
      () => createProcessor({ pollIntervalMs: 1.5 }),
      /pollIntervalMs/,
    );
    assert.throws(() => createProcessor({ batchSize: 0 }), /batchSize/);
    assert.throws(
      () => createProcessor({ batchSize: Number.MAX_SAFE_INTEGER + 1 }),
      /batchSize/,
    );
    assert.throws(() => createProcessor({ maxAttempts: 0 }), /maxAttempts/);
    assert.throws(
      () => createProcessor({ retryBaseDelayMs: -1 }),
      /retry delays/,
    );
    assert.throws(
      () => createProcessor({ retryBaseDelayMs: 10, retryMaxDelayMs: 5 }),
      /retry delays/,
    );
  });

  it("catches up from archive_events using the change sequence cursor", async () => {
    const fixture = buildProjectionFixture(10);
    await repository.insertRawEvents([fixture.archiveEvent], "pending");

    const processedFirst = await processor.processOnce();
    const processedSecond = await processor.processOnce();

    assert.equal(processedFirst, 1);
    assert.equal(processedSecond, 0);

    const projection = await dataSource
      .getRepository(TestProjectionEntity)
      .findOneBy({
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

    const offset = await dataSource
      .getRepository(ProcessorOffsetEntity)
      .findOne({
        where: { processorName: "test-projection-processor" },
      });
    assert.ok(offset);
    assert.equal(offset?.lastSeenEventId !== "0", true);
    assert.equal(BigInt(offset?.lastSeenChangeSequence ?? "0") > 0n, true);

    const runtime = await dataSource
      .getRepository(ProcessorRuntimeStatusEntity)
      .findOneBy({ processorName: "test-projection-processor" });
    assert.equal(runtime?.lifecycleState, "idle");
  });

  it("does not advance offset when an event cannot be handled", async () => {
    const invalidEvent: ArchiveEventOutput = {
      blockInfo: {
        height: 11,
      },
      eventData: [
        {
          accountUpdateId: "11",
          // The test handler expects exactly [eventKey, payload].
          data: ["invalid"],
          transactionInfo: {
            hash: "tx-invalid-11",
            zkappAccountUpdateIds: [11],
          },
        },
      ],
    };
    await repository.insertRawEvents([invalidEvent], "pending");

    assert.equal(await processor.processOnce(), 0);
    assert.equal(
      await dataSource.getRepository(TestProjectionEntity).count(),
      0,
    );

    const offset = await dataSource
      .getRepository(ProcessorOffsetEntity)
      .findOne({
        where: { processorName: "test-projection-processor" },
      });
    assert.equal(offset, null);

    const failure = await dataSource
      .getRepository(ProcessorEventFailureEntity)
      .findOneBy({ processorName: "test-projection-processor" });
    assert.equal(failure?.state, "blocked");
    assert.equal(failure?.attemptCount, 5);

    const runtime = await dataSource
      .getRepository(ProcessorRuntimeStatusEntity)
      .findOneBy({ processorName: "test-projection-processor" });
    assert.equal(runtime?.lifecycleState, "blocked");

    assert.equal(await processor.processOnce(), 0);
    const unchangedFailure = await dataSource
      .getRepository(ProcessorEventFailureEntity)
      .findOneBy({ processorName: "test-projection-processor" });
    assert.equal(unchangedFailure?.attemptCount, 5);
  });

  it("blocks a TypeORM handler failure after bounded event attempts", async () => {
    const fixture = buildProjectionFixture(111);
    await repository.insertRawEvents([fixture.archiveEvent], "pending");
    const event = await dataSource.getRepository(ArchiveEventEntity).findOneBy({
      txHash: "tx-111",
      accountUpdateId: "111",
    });
    assert.ok(event);
    event.id = String(event.id);
    event.changeSequence = String(event.changeSequence);

    let attemptCount = 0;
    processor = new EventsProcessor(
      dataSource,
      new EventProcessorRouter([
        {
          eventType: "testProjectionCreated",
          tryHandle: async () => {
            attemptCount += 1;
            throw new TypeORMError("deterministic event constraint failure");
          },
        },
      ]),
      {
        processorName: "typeorm-event-failure-processor",
        pollIntervalMs: 60_000,
        batchSize: 1,
        retryBaseDelayMs: 1,
        retryMaxDelayMs: 4,
      },
      {
        fetchEventsPage: async () => ({
          items: [event],
          nextCursor: { changeSequenceAfter: event.changeSequence },
        }),
      },
    );

    assert.equal(await processor.processOnce(), 0);
    assert.equal(attemptCount, 5);
    const failure = await dataSource
      .getRepository(ProcessorEventFailureEntity)
      .findOneBy({ processorName: "typeorm-event-failure-processor" });
    assert.equal(failure?.state, "blocked");
    assert.equal(failure?.attemptCount, 5);
    assert.equal(failure?.errorCode, "EVENT_DATABASE_FAILED");
    assert.equal(
      await dataSource.getRepository(ProcessorOffsetEntity).countBy({
        processorName: "typeorm-event-failure-processor",
      }),
      0,
    );

    assert.equal(await processor.processOnce(), 0);
    assert.equal(attemptCount, 5);
  });

  it("commits successful events before a later event blocks", async () => {
    const validFixture = buildProjectionFixture(13);
    const invalidEvent: ArchiveEventOutput = {
      blockInfo: { height: 14 },
      eventData: [
        {
          accountUpdateId: "14",
          data: ["invalid"],
          transactionInfo: {
            hash: "tx-invalid-14",
            zkappAccountUpdateIds: [14],
          },
        },
      ],
    };
    await repository.insertRawEvents(
      [validFixture.archiveEvent, invalidEvent],
      "pending",
    );

    assert.equal(await processor.processOnce(), 1);
    assert.equal(
      await dataSource.getRepository(TestProjectionEntity).count(),
      1,
    );

    const offset = await dataSource
      .getRepository(ProcessorOffsetEntity)
      .findOneBy({
        processorName: "test-projection-processor",
      });
    assert.ok(offset);
    const blockedFailure = await dataSource
      .getRepository(ProcessorEventFailureEntity)
      .findOneBy({
        processorName: "test-projection-processor",
        state: "blocked",
      });
    assert.ok(blockedFailure);
    assert.equal(
      BigInt(blockedFailure.changeSequence) >
        BigInt(offset.lastSeenChangeSequence),
      true,
    );
  });

  it("retries a blocked event only after an explicit request", async () => {
    const fixture = buildProjectionFixture(15);
    await repository.insertRawEvents([fixture.archiveEvent], "pending");
    eventHandler.rejectEvents = true;

    assert.equal(await processor.processOnce(), 0);
    assert.equal(eventHandler.attemptCount, 5);
    assert.equal(await processor.processOnce(), 0);
    assert.equal(eventHandler.attemptCount, 5);

    eventHandler.rejectEvents = false;
    assert.equal(await processor.retryBlockedEvent(), 1);
    assert.equal(eventHandler.attemptCount, 6);

    const failure = await dataSource
      .getRepository(ProcessorEventFailureEntity)
      .findOneBy({ processorName: "test-projection-processor" });
    assert.equal(failure?.state, "resolved");
    assert.equal(failure?.attemptCount, 0);
    assert.ok(failure?.resolvedAt);
  });

  it("self-heals a blocked old version without skipping intervening changes", async () => {
    const isolatedDataSource = createInMemoryDataSource();
    await isolatedDataSource.initialize();
    await isolatedDataSource.synchronize();
    const oldEvent = buildSequencedEvent({
      id: "100",
      changeSequence: "10",
      eventKey: "same-event",
      payload: "immutable-payload",
    });
    const interveningEvent = buildSequencedEvent({
      id: "101",
      changeSequence: "11",
      eventKey: "intervening-event",
      payload: "intervening-payload",
    });
    const currentEvent = Object.assign(new ArchiveEventEntity(), oldEvent, {
      changeSequence: "12",
      status: "canonical",
      pendingSeenAtHeight: null,
      chainStatus: "canonical",
      blockEventIndex: 3,
      rawEventData: {
        ...oldEvent.rawEventData,
        transactionInfo: {
          hash: oldEvent.txHash,
          sequenceNumber: 7,
          zkappAccountUpdateIds: [Number(oldEvent.accountUpdateId)],
        },
      },
      updatedAt: new Date("2026-01-01T00:00:12.000Z"),
    }) as SequencedArchiveEvent;
    let currentRows = [oldEvent];
    const fetchCursors: string[] = [];
    const source = {
      fetchEventsPage: async ({
        changeSequenceAfter,
        limit,
      }: {
        changeSequenceAfter: string;
        limit: number;
      }) => {
        fetchCursors.push(changeSequenceAfter);
        const items = currentRows
          .filter(
            (event) =>
              BigInt(event.changeSequence) > BigInt(changeSequenceAfter),
          )
          .sort((left, right) =>
            BigInt(left.changeSequence) < BigInt(right.changeSequence) ? -1 : 1,
          )
          .slice(0, limit);
        return {
          items,
          nextCursor: items.length
            ? { changeSequenceAfter: items.at(-1)!.changeSequence }
            : null,
        };
      },
    };
    const handledSequences: string[] = [];
    const healingProcessor = new EventsProcessor(
      isolatedDataSource,
      new EventProcessorRouter([
        {
          eventType: "testProjectionCreated",
          tryHandle: async (event) => {
            if (event.changeSequence === oldEvent.changeSequence) return false;
            handledSequences.push(event.changeSequence);
            return true;
          },
        },
      ]),
      {
        processorName: "superseded-blocked-processor",
        pollIntervalMs: 60_000,
        batchSize: 2,
        maxAttempts: 1,
        retryBaseDelayMs: 0,
      },
      source,
    );

    try {
      assert.equal(await healingProcessor.processOnce(), 0);
      currentRows = [interveningEvent, currentEvent];
      assert.equal(await healingProcessor.processOnce(), 2);

      assert.deepEqual(handledSequences, ["11", "12"]);
      assert.deepEqual(fetchCursors, ["0", "0", "0"]);
      const failure = await isolatedDataSource
        .getRepository(ProcessorEventFailureEntity)
        .findOneByOrFail({
          processorName: "superseded-blocked-processor",
          archiveEventId: "100",
          changeSequence: "10",
        });
      assert.equal(failure.state, "superseded");
      assert.ok(failure.resolvedAt);
      const offset = await isolatedDataSource
        .getRepository(ProcessorOffsetEntity)
        .findOneByOrFail({ processorName: "superseded-blocked-processor" });
      assert.equal(offset.lastSeenChangeSequence, "12");
      assert.equal(offset.lastSeenEventId, "100");
    } finally {
      await healingProcessor.stop();
    }
  });

  it("does not supersede a blocked event when the same id changes immutable payload", async () => {
    const isolatedDataSource = createInMemoryDataSource();
    await isolatedDataSource.initialize();
    await isolatedDataSource.synchronize();
    const oldEvent = buildSequencedEvent({
      id: "110",
      changeSequence: "20",
      eventKey: "same-event",
      payload: "original-payload",
    });
    const conflictingEvent = buildSequencedEvent({
      id: "110",
      changeSequence: "21",
      eventKey: "same-event",
      payload: "changed-payload",
      status: "canonical",
    });
    let currentRows = [oldEvent];
    let handlerAttempts = 0;
    const guardedProcessor = new EventsProcessor(
      isolatedDataSource,
      new EventProcessorRouter([
        {
          eventType: "testProjectionCreated",
          tryHandle: async () => {
            handlerAttempts += 1;
            return false;
          },
        },
      ]),
      {
        processorName: "immutable-conflict-blocked-processor",
        pollIntervalMs: 60_000,
        batchSize: 2,
        maxAttempts: 1,
        retryBaseDelayMs: 0,
      },
      {
        fetchEventsPage: async ({ changeSequenceAfter }) => {
          const items = currentRows.filter(
            (event) =>
              BigInt(event.changeSequence) > BigInt(changeSequenceAfter),
          );
          return {
            items,
            nextCursor: items.length
              ? { changeSequenceAfter: items.at(-1)!.changeSequence }
              : null,
          };
        },
      },
    );

    try {
      assert.equal(await guardedProcessor.processOnce(), 0);
      currentRows = [conflictingEvent];
      assert.equal(await guardedProcessor.processOnce(), 0);
      assert.equal(handlerAttempts, 1);
      assert.equal(
        (
          await isolatedDataSource
            .getRepository(ProcessorEventFailureEntity)
            .findOneByOrFail({
              processorName: "immutable-conflict-blocked-processor",
              archiveEventId: "110",
              changeSequence: "20",
            })
        ).state,
        "blocked",
      );
      assert.equal(
        await isolatedDataSource
          .getRepository(ProcessorOffsetEntity)
          .countBy({ processorName: "immutable-conflict-blocked-processor" }),
        0,
      );
    } finally {
      await guardedProcessor.stop();
    }
  });

  it("pages through blocked recovery without moving the committed offset", async () => {
    const isolatedDataSource = createInMemoryDataSource();
    await isolatedDataSource.initialize();
    await isolatedDataSource.synchronize();
    const oldEvent = buildSequencedEvent({
      id: "120",
      changeSequence: "30",
      eventKey: "same-event",
      payload: "immutable-payload",
    });
    const interveningEvent = buildSequencedEvent({
      id: "121",
      changeSequence: "31",
      eventKey: "intervening-event",
      payload: "intervening-payload",
    });
    const unseenSuccessor = Object.assign(new ArchiveEventEntity(), oldEvent, {
      changeSequence: "32",
      status: "canonical",
      pendingSeenAtHeight: null,
      chainStatus: "canonical",
      updatedAt: new Date("2026-01-01T00:00:32.000Z"),
    }) as SequencedArchiveEvent;
    let currentRows = [oldEvent];
    let recoveryStarted = false;
    const fetchCursors: string[] = [];
    const offsetsDuringRecovery: number[] = [];
    const handledSequences: string[] = [];
    const boundedProcessor = new EventsProcessor(
      isolatedDataSource,
      new EventProcessorRouter([
        {
          eventType: "testProjectionCreated",
          tryHandle: async (event) => {
            if (event.changeSequence === oldEvent.changeSequence) return false;
            handledSequences.push(event.changeSequence);
            return true;
          },
        },
      ]),
      {
        processorName: "bounded-supersession-processor",
        pollIntervalMs: 60_000,
        batchSize: 1,
        maxAttempts: 1,
        retryBaseDelayMs: 0,
      },
      {
        fetchEventsPage: async ({ changeSequenceAfter, limit }) => {
          fetchCursors.push(changeSequenceAfter);
          if (recoveryStarted) {
            offsetsDuringRecovery.push(
              await isolatedDataSource
                .getRepository(ProcessorOffsetEntity)
                .countBy({ processorName: "bounded-supersession-processor" }),
            );
          }
          const items = currentRows
            .filter(
              (event) =>
                BigInt(event.changeSequence) > BigInt(changeSequenceAfter),
            )
            .slice(0, limit);
          return {
            items,
            nextCursor: items.length
              ? { changeSequenceAfter: items.at(-1)!.changeSequence }
              : null,
          };
        },
      },
    );

    try {
      assert.equal(await boundedProcessor.processOnce(), 0);
      currentRows = [interveningEvent, unseenSuccessor];
      recoveryStarted = true;
      assert.equal(await boundedProcessor.processOnce(), 1);
      assert.equal(await boundedProcessor.processOnce(), 1);
      assert.deepEqual(fetchCursors, ["0", "0", "31", "0", "31"]);
      assert.deepEqual(offsetsDuringRecovery.slice(0, 2), [0, 0]);
      assert.deepEqual(handledSequences, ["31", "32"]);
      assert.equal(
        (
          await isolatedDataSource
            .getRepository(ProcessorEventFailureEntity)
            .findOneByOrFail({
              processorName: "bounded-supersession-processor",
              archiveEventId: "120",
              changeSequence: "30",
            })
        ).state,
        "superseded",
      );
      const offset = await isolatedDataSource
        .getRepository(ProcessorOffsetEntity)
        .findOneByOrFail({ processorName: "bounded-supersession-processor" });
      assert.equal(offset.lastSeenChangeSequence, "32");
    } finally {
      await boundedProcessor.stop();
    }
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
    await simulateChangeSequenceTrigger(dataSource, "tx-12");

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
    await simulateChangeSequenceTrigger(dataSource, "tx-18");
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

    const projectionCount = await dataSource
      .getRepository(TestProjectionEntity)
      .countBy({
        eventKey: fixture.projection.eventKey,
      });
    assert.equal(projectionCount, 1);
  });

  it("does not dispatch a delayed older event after another instance advances the offset", async () => {
    let advisoryLockCount = 0;
    const isolatedDataSource = createInMemoryDataSource("public", [], {
      onProcessorAdvisoryLock: () => {
        advisoryLockCount += 1;
      },
    });
    await isolatedDataSource.initialize();
    await isolatedDataSource.synchronize();

    const makeEvent = (changeSequence: string) =>
      Object.assign(new ArchiveEventEntity(), {
        id: changeSequence,
        changeSequence,
        status: "pending" as const,
        pendingSeenAtHeight: Number(changeSequence),
        blockHeight: Number(changeSequence),
        blockTimestamp: null,
        eventType: "testProjectionCreated",
        txHash: `tx-${changeSequence}`,
        accountUpdateId: changeSequence,
        accountUpdateIndex: 0,
        eventIndex: 0,
        blockEventIndex: 0,
        rawEventData: {
          data: [`projection-${changeSequence}`, `payload-${changeSequence}`],
        },
        indexedAt: new Date(),
        updatedAt: new Date(),
      });
    const olderEvent = makeEvent("80");
    const newerEvent = makeEvent("81");

    let reportOlderFetch: (() => void) | null = null;
    let releaseOlderFetch: (() => void) | null = null;
    const olderFetchStarted = new Promise<void>((resolve) => {
      reportOlderFetch = resolve;
    });
    const olderFetchGate = new Promise<void>((resolve) => {
      releaseOlderFetch = resolve;
    });
    let olderDispatchCount = 0;
    let newerDispatchCount = 0;
    const processorOptions = {
      processorName: "shared-processor",
      pollIntervalMs: 60_000,
      batchSize: 1,
    };
    const olderProcessor = new EventsProcessor(
      isolatedDataSource,
      new EventProcessorRouter([
        {
          eventType: "testProjectionCreated",
          tryHandle: async () => {
            olderDispatchCount += 1;
            return true;
          },
        },
      ]),
      processorOptions,
      {
        fetchEventsPage: async () => {
          reportOlderFetch?.();
          await olderFetchGate;
          return {
            items: [olderEvent],
            nextCursor: { changeSequenceAfter: olderEvent.changeSequence },
          };
        },
      },
    );
    const newerProcessor = new EventsProcessor(
      isolatedDataSource,
      new EventProcessorRouter([
        {
          eventType: "testProjectionCreated",
          tryHandle: async () => {
            newerDispatchCount += 1;
            return true;
          },
        },
      ]),
      processorOptions,
      {
        fetchEventsPage: async () => ({
          items: [newerEvent],
          nextCursor: { changeSequenceAfter: newerEvent.changeSequence },
        }),
      },
    );

    try {
      const delayedOlderProcessing = olderProcessor.processOnce();
      await olderFetchStarted;
      assert.equal(await newerProcessor.processOnce(), 1);
      releaseOlderFetch?.();
      assert.equal(await delayedOlderProcessing, 0);

      assert.equal(olderDispatchCount, 0);
      assert.equal(newerDispatchCount, 1);
      assert.equal(advisoryLockCount, 2);
      const offset = await isolatedDataSource
        .getRepository(ProcessorOffsetEntity)
        .findOneByOrFail({ processorName: "shared-processor" });
      assert.equal(offset.lastSeenChangeSequence, "81");
      assert.equal(offset.lastSeenEventId, "81");
    } finally {
      releaseOlderFetch?.();
      await olderProcessor.stop();
      await newerProcessor.stop();
    }
  });

  it("supersedes a retrying stale event after the advisory-lock offset check", async () => {
    let advisoryLockCount = 0;
    const isolatedDataSource = createInMemoryDataSource("public", [], {
      onProcessorAdvisoryLock: () => {
        advisoryLockCount += 1;
      },
    });
    await isolatedDataSource.initialize();
    await isolatedDataSource.synchronize();

    const event = buildSequencedEvent({
      id: "82",
      changeSequence: "82",
      eventKey: "stale-event",
      payload: "stale-payload",
    });
    await isolatedDataSource.getRepository(ProcessorOffsetEntity).save(
      Object.assign(new ProcessorOffsetEntity(), {
        processorName: "stale-event-processor",
        lastSeenUpdatedAt: new Date("2026-01-01T00:01:23.000Z"),
        lastSeenEventId: "83",
        lastSeenChangeSequence: "83",
      }),
    );
    await isolatedDataSource.getRepository(ProcessorEventFailureEntity).save(
      Object.assign(new ProcessorEventFailureEntity(), {
        processorName: "stale-event-processor",
        archiveEventId: event.id,
        changeSequence: event.changeSequence,
        state: "retrying",
        attemptCount: 1,
        retryAfter: null,
        errorCode: "EVENT_NOT_HANDLED",
        boundedErrorMessage: "previous failure",
        eventSnapshot: { id: event.id },
        firstFailedAt: new Date("2026-01-01T00:00:00.000Z"),
        lastFailedAt: new Date("2026-01-01T00:00:01.000Z"),
        resolvedAt: null,
      }),
    );
    let dispatchCount = 0;
    const staleProcessor = new EventsProcessor(
      isolatedDataSource,
      new EventProcessorRouter([
        {
          eventType: "testProjectionCreated",
          tryHandle: async () => {
            dispatchCount += 1;
            return true;
          },
        },
      ]),
      {
        processorName: "stale-event-processor",
        pollIntervalMs: 60_000,
        batchSize: 1,
      },
      {
        fetchEventsPage: async () => ({
          items: [event],
          nextCursor: { changeSequenceAfter: event.changeSequence },
        }),
      },
    );

    try {
      assert.equal(await staleProcessor.processOnce(), 0);
      assert.equal(dispatchCount, 0);
      assert.equal(advisoryLockCount, 1);
      const failure = await isolatedDataSource
        .getRepository(ProcessorEventFailureEntity)
        .findOneByOrFail({
          processorName: "stale-event-processor",
          archiveEventId: event.id,
          changeSequence: event.changeSequence,
        });
      assert.equal(failure.state, "superseded");
      assert.equal(failure.retryAfter, null);
      assert.ok(failure.resolvedAt);
    } finally {
      await staleProcessor.stop();
    }
  });

  it("preserves a blocked failure that appears during the indexer fetch", async () => {
    let advisoryLockCount = 0;
    const isolatedDataSource = createInMemoryDataSource("public", [], {
      onProcessorAdvisoryLock: () => {
        advisoryLockCount += 1;
      },
    });
    await isolatedDataSource.initialize();
    await isolatedDataSource.synchronize();

    const event = buildSequencedEvent({
      id: "84",
      changeSequence: "84",
      eventKey: "blocked-race-event",
      payload: "blocked-race-payload",
    });
    let dispatchCount = 0;
    let fetchCount = 0;
    const blockedProcessor = new EventsProcessor(
      isolatedDataSource,
      new EventProcessorRouter([
        {
          eventType: "testProjectionCreated",
          tryHandle: async () => {
            dispatchCount += 1;
            return true;
          },
        },
      ]),
      {
        processorName: "blocked-race-processor",
        pollIntervalMs: 60_000,
        batchSize: 1,
      },
      {
        fetchEventsPage: async () => {
          fetchCount += 1;
          await isolatedDataSource
            .getRepository(ProcessorEventFailureEntity)
            .save(
              Object.assign(new ProcessorEventFailureEntity(), {
                processorName: "blocked-race-processor",
                archiveEventId: event.id,
                changeSequence: event.changeSequence,
                state: "blocked",
                attemptCount: 5,
                retryAfter: null,
                errorCode: "EVENT_NOT_HANDLED",
                boundedErrorMessage: "blocked before dispatch",
                eventSnapshot: { id: event.id },
                firstFailedAt: new Date("2026-01-01T00:00:00.000Z"),
                lastFailedAt: new Date("2026-01-01T00:00:01.000Z"),
                resolvedAt: null,
              }),
            );
          return {
            items: [event],
            nextCursor: { changeSequenceAfter: event.changeSequence },
          };
        },
      },
    );

    try {
      assert.equal(await blockedProcessor.processOnce(), 0);
      assert.equal(fetchCount, 1);
      assert.equal(dispatchCount, 0);
      assert.equal(advisoryLockCount, 0);
      const failure = await isolatedDataSource
        .getRepository(ProcessorEventFailureEntity)
        .findOneByOrFail({
          processorName: "blocked-race-processor",
          archiveEventId: event.id,
          changeSequence: event.changeSequence,
        });
      assert.equal(failure.state, "blocked");
      assert.equal(failure.attemptCount, 5);
      assert.equal(
        await isolatedDataSource
          .getRepository(ProcessorOffsetEntity)
          .countBy({ processorName: "blocked-race-processor" }),
        0,
      );
    } finally {
      await blockedProcessor.stop();
    }
  });

  it("continues catch-up in batches with persistent offset", async () => {
    await repository.insertRawEvents(
      [buildProjectionFixture(20).archiveEvent],
      "pending",
    );
    await repository.insertRawEvents(
      [buildProjectionFixture(21).archiveEvent],
      "pending",
    );
    await repository.insertRawEvents(
      [buildProjectionFixture(22).archiveEvent],
      "pending",
    );

    assert.equal(await processor.processOnce(), 2);
    assert.equal(await processor.processOnce(), 1);
    assert.equal(await processor.processOnce(), 0);
    assert.equal(
      await dataSource.getRepository(TestProjectionEntity).count(),
      3,
    );
  });

  it("records indexer failures without consuming an event attempt", async () => {
    const isolatedDataSource = createInMemoryDataSource("public", [
      TestProjectionEntity,
    ]);
    await isolatedDataSource.initialize();
    await isolatedDataSource.synchronize();
    const isolatedProcessor = new EventsProcessor(
      isolatedDataSource,
      new EventProcessorRouter([new TestProjectionEventHandler()]),
      {
        processorName: "infrastructure-failure-processor",
        pollIntervalMs: 60_000,
        batchSize: 2,
      },
      {
        fetchEventsPage: async () => {
          throw new IndexerEventsApiError(
            "INDEXER_RESPONSE_CONTRACT_INVALID",
            "invalid response",
          );
        },
      },
    );

    try {
      assert.equal(await isolatedProcessor.processOnce(), 0);
      assert.equal(
        await isolatedDataSource
          .getRepository(ProcessorEventFailureEntity)
          .count(),
        0,
      );
      const runtime = await isolatedDataSource
        .getRepository(ProcessorRuntimeStatusEntity)
        .findOneBy({ processorName: "infrastructure-failure-processor" });
      assert.equal(runtime?.lifecycleState, "degraded");
      assert.equal(runtime?.lastErrorCode, "INDEXER_RESPONSE_CONTRACT_INVALID");
    } finally {
      await isolatedProcessor.stop();
    }
  });

  it("contains a failure while infrastructure status persistence also fails", async () => {
    const isolatedDataSource = createInMemoryDataSource();
    await isolatedDataSource.initialize();
    await isolatedDataSource.synchronize();
    const runtimeRepository = isolatedDataSource.getRepository(
      ProcessorRuntimeStatusEntity,
    );
    const saveRuntime = runtimeRepository.save.bind(runtimeRepository);
    let rejectRuntimeSave = false;
    runtimeRepository.save = (async (entity: ProcessorRuntimeStatusEntity) => {
      if (rejectRuntimeSave) {
        throw new Error("runtime status unavailable");
      }
      return await saveRuntime(entity);
    }) as typeof runtimeRepository.save;
    const loggedErrors: unknown[][] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]) => {
      loggedErrors.push(args);
    };
    const isolatedProcessor = new EventsProcessor(
      isolatedDataSource,
      new EventProcessorRouter([
        {
          eventType: "testProjectionCreated",
          tryHandle: async () => true,
        },
      ]),
      {
        processorName: "failed-status-persistence-processor",
        pollIntervalMs: 60_000,
        batchSize: 1,
      },
      {
        fetchEventsPage: async () => {
          rejectRuntimeSave = true;
          throw new IndexerEventsApiError(
            "INDEXER_RESPONSE_CONTRACT_INVALID",
            "invalid response",
          );
        },
      },
    );

    try {
      assert.equal(await isolatedProcessor.processOnce(), 0);
      assert.equal(
        loggedErrors.some(
          ([message]) =>
            message ===
            "[events-processor] failed to persist infrastructure failure",
        ),
        true,
      );
      assert.equal(
        await isolatedDataSource
          .getRepository(ProcessorEventFailureEntity)
          .count(),
        0,
      );
    } finally {
      console.error = consoleError;
      runtimeRepository.save = saveRuntime as typeof runtimeRepository.save;
      await isolatedDataSource.destroy();
    }
  });

  it("waits for active event work before it destroys the data source", async () => {
    const isolatedDataSource = createInMemoryDataSource("public", [
      TestProjectionEntity,
    ]);
    await isolatedDataSource.initialize();
    await isolatedDataSource.synchronize();

    let releaseHandler: (() => void) | null = null;
    let reportHandlerStarted: (() => void) | null = null;
    const handlerStarted = new Promise<void>((resolve) => {
      reportHandlerStarted = resolve;
    });
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const event = Object.assign(new ArchiveEventEntity(), {
      id: "40",
      changeSequence: "40",
      status: "pending",
      pendingSeenAtHeight: 40,
      blockHeight: 40,
      blockTimestamp: null,
      eventType: "testProjectionCreated",
      txHash: "tx-40",
      accountUpdateId: "40",
      accountUpdateIndex: 0,
      eventIndex: 0,
      blockEventIndex: 0,
      rawEventData: {
        data: ["projection-40", "payload-40"],
      },
      indexedAt: new Date(),
      updatedAt: new Date(),
    });
    const isolatedProcessor = new EventsProcessor(
      isolatedDataSource,
      new EventProcessorRouter([
        {
          eventType: "testProjectionCreated",
          tryHandle: async () => {
            reportHandlerStarted?.();
            await handlerGate;
            return true;
          },
        },
      ]),
      {
        processorName: "draining-processor",
        pollIntervalMs: 60_000,
        batchSize: 1,
      },
      {
        fetchEventsPage: async ({ changeSequenceAfter }) => ({
          items: changeSequenceAfter === "0" ? [event] : [],
          nextCursor:
            changeSequenceAfter === "0" ? { changeSequenceAfter: "40" } : null,
        }),
      },
    );

    const processing = isolatedProcessor.processOnce();
    await handlerStarted;
    let stopCompleted = false;
    const stopping = isolatedProcessor.stop().then(() => {
      stopCompleted = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(stopCompleted, false);

    releaseHandler?.();
    assert.equal(await processing, 1);
    await stopping;
    assert.equal(isolatedDataSource.isInitialized, false);
  });

  it("shares one shutdown operation across concurrent stop calls", async () => {
    const isolatedDataSource = createInMemoryDataSource();
    await isolatedDataSource.initialize();
    await isolatedDataSource.synchronize();
    let destroyCount = 0;
    const destroy = isolatedDataSource.destroy.bind(isolatedDataSource);
    isolatedDataSource.destroy = async () => {
      destroyCount += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return await destroy();
    };
    const isolatedProcessor = new EventsProcessor(
      isolatedDataSource,
      new EventProcessorRouter([]),
      {
        processorName: "concurrent-stop-processor",
        pollIntervalMs: 60_000,
        batchSize: 1,
      },
      {
        fetchEventsPage: async () => ({ items: [], nextCursor: null }),
      },
    );

    await Promise.all([isolatedProcessor.stop(), isolatedProcessor.stop()]);
    assert.equal(destroyCount, 1);
  });

  it("closes an initialized data source when startup setup fails", async () => {
    const isolatedDataSource = createInMemoryDataSource();
    const isolatedProcessor = new EventsProcessor(
      isolatedDataSource,
      new EventProcessorRouter([]),
      {
        processorName: "failed-start-processor",
        pollIntervalMs: 60_000,
        batchSize: 1,
      },
      {
        fetchEventsPage: async () => ({ items: [], nextCursor: null }),
      },
    );

    await assert.rejects(isolatedProcessor.start(), /processor_runtime_status/);
    assert.equal(isolatedDataSource.isInitialized, false);
  });

  it("interrupts retry backoff during shutdown", async () => {
    const isolatedDataSource = createInMemoryDataSource();
    await isolatedDataSource.initialize();
    await isolatedDataSource.synchronize();
    let reportAttempt: (() => void) | null = null;
    const attempted = new Promise<void>((resolve) => {
      reportAttempt = resolve;
    });
    let attemptCount = 0;
    const event = Object.assign(new ArchiveEventEntity(), {
      id: "50",
      changeSequence: "50",
      status: "pending",
      pendingSeenAtHeight: 50,
      blockHeight: 50,
      blockTimestamp: null,
      eventType: "testProjectionCreated",
      txHash: "tx-50",
      accountUpdateId: "50",
      accountUpdateIndex: 0,
      eventIndex: 0,
      blockEventIndex: 0,
      rawEventData: { data: ["projection-50", "payload-50"] },
      indexedAt: new Date(),
      updatedAt: new Date(),
    });
    const isolatedProcessor = new EventsProcessor(
      isolatedDataSource,
      new EventProcessorRouter([
        {
          eventType: "testProjectionCreated",
          tryHandle: async () => {
            attemptCount += 1;
            reportAttempt?.();
            return false;
          },
        },
      ]),
      {
        processorName: "stop-aware-retry-processor",
        pollIntervalMs: 60_000,
        batchSize: 1,
        retryBaseDelayMs: 60_000,
        retryMaxDelayMs: 60_000,
      },
      {
        fetchEventsPage: async () => ({
          items: [event],
          nextCursor: { changeSequenceAfter: event.changeSequence },
        }),
      },
    );

    const processing = isolatedProcessor.processOnce();
    await attempted;
    let retryingFailure: ProcessorEventFailureEntity | null = null;
    for (let poll = 0; poll < 20 && !retryingFailure; poll += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      retryingFailure = await isolatedDataSource
        .getRepository(ProcessorEventFailureEntity)
        .findOneBy({
          processorName: "stop-aware-retry-processor",
          state: "retrying",
        });
    }
    assert.ok(retryingFailure);
    const stopStartedAt = Date.now();
    await Promise.all([isolatedProcessor.stop(), processing]);
    assert.equal(attemptCount, 1);
    assert.equal(Date.now() - stopStartedAt < 1_000, true);
  });

  it("runs an explicit blocked-event retry as a one-shot operation", async () => {
    const isolatedDataSource = createInMemoryDataSource();
    await isolatedDataSource.initialize();
    await isolatedDataSource.synchronize();
    const event = Object.assign(new ArchiveEventEntity(), {
      id: "60",
      changeSequence: "60",
      status: "pending",
      pendingSeenAtHeight: 60,
      blockHeight: 60,
      blockTimestamp: null,
      eventType: "testProjectionCreated",
      txHash: "tx-60",
      accountUpdateId: "60",
      accountUpdateIndex: 0,
      eventIndex: 0,
      blockEventIndex: 0,
      rawEventData: { data: ["projection-60", "payload-60"] },
      indexedAt: new Date(),
      updatedAt: new Date(),
    });
    let acceptEvent = false;
    const router = new EventProcessorRouter([
      {
        eventType: "testProjectionCreated",
        tryHandle: async () => acceptEvent,
      },
    ]);
    const source = {
      fetchEventsPage: async () => ({
        items: [event],
        nextCursor: { changeSequenceAfter: event.changeSequence },
      }),
    };
    const blockingProcessor = new EventsProcessor(
      isolatedDataSource,
      router,
      {
        processorName: "one-shot-retry-processor",
        pollIntervalMs: 60_000,
        batchSize: 1,
        maxAttempts: 1,
        retryBaseDelayMs: 0,
      },
      source,
    );
    assert.equal(await blockingProcessor.processOnce(), 0);
    await blockingProcessor.stop();
    assert.equal(isolatedDataSource.isInitialized, false);

    acceptEvent = true;
    const retryProcessor = new EventsProcessor(
      isolatedDataSource,
      router,
      {
        processorName: "one-shot-retry-processor",
        pollIntervalMs: 60_000,
        batchSize: 1,
      },
      source,
    );
    assert.equal(await retryProcessor.retryBlockedEvent(), 1);
    assert.equal(isolatedDataSource.isInitialized, false);

    await isolatedDataSource.initialize();
    const failure = await isolatedDataSource
      .getRepository(ProcessorEventFailureEntity)
      .findOneBy({ processorName: "one-shot-retry-processor" });
    const offset = await isolatedDataSource
      .getRepository(ProcessorOffsetEntity)
      .findOneBy({ processorName: "one-shot-retry-processor" });
    const runtime = await isolatedDataSource
      .getRepository(ProcessorRuntimeStatusEntity)
      .findOneBy({ processorName: "one-shot-retry-processor" });
    assert.equal(failure?.state, "resolved");
    assert.equal(offset?.lastSeenChangeSequence, "60");
    assert.equal(runtime?.lifecycleState, "stopped");
    await isolatedDataSource.destroy();
  });

  it("refreshes the runtime heartbeat during the initial long event", async () => {
    const isolatedDataSource = createInMemoryDataSource();
    await isolatedDataSource.initialize();
    await isolatedDataSource.synchronize();
    let releaseHandler: (() => void) | null = null;
    let reportHandlerStarted: (() => void) | null = null;
    const handlerStarted = new Promise<void>((resolve) => {
      reportHandlerStarted = resolve;
    });
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const event = Object.assign(new ArchiveEventEntity(), {
      id: "70",
      changeSequence: "70",
      status: "pending",
      pendingSeenAtHeight: 70,
      blockHeight: 70,
      blockTimestamp: null,
      eventType: "testProjectionCreated",
      txHash: "tx-70",
      accountUpdateId: "70",
      accountUpdateIndex: 0,
      eventIndex: 0,
      blockEventIndex: 0,
      rawEventData: { data: ["projection-70", "payload-70"] },
      indexedAt: new Date(),
      updatedAt: new Date(),
    });
    const longProcessor = new EventsProcessor(
      isolatedDataSource,
      new EventProcessorRouter([
        {
          eventType: "testProjectionCreated",
          tryHandle: async () => {
            reportHandlerStarted?.();
            await handlerGate;
            return true;
          },
        },
      ]),
      {
        processorName: "heartbeat-processor",
        pollIntervalMs: 10,
        batchSize: 1,
      },
      {
        fetchEventsPage: async ({ changeSequenceAfter }) => ({
          items: changeSequenceAfter === "0" ? [event] : [],
          nextCursor:
            changeSequenceAfter === "0"
              ? { changeSequenceAfter: event.changeSequence }
              : null,
        }),
      },
    );
    const starting = longProcessor.start();

    try {
      await handlerStarted;
      const runtimeRepository = isolatedDataSource.getRepository(
        ProcessorRuntimeStatusEntity,
      );
      const initialRuntime = await runtimeRepository.findOneByOrFail({
        processorName: "heartbeat-processor",
      });
      assert.equal(initialRuntime.lifecycleState, "running");

      let refreshedHeartbeat: Date | null = null;
      for (let poll = 0; poll < 40 && !refreshedHeartbeat; poll += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        const runtime = await runtimeRepository.findOneByOrFail({
          processorName: "heartbeat-processor",
        });
        if (
          runtime.heartbeatAt.getTime() > initialRuntime.heartbeatAt.getTime()
        ) {
          refreshedHeartbeat = runtime.heartbeatAt;
        }
      }
      assert.ok(refreshedHeartbeat);
    } finally {
      releaseHandler?.();
      await starting;
      await longProcessor.stop();
    }
  });
});
