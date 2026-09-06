import assert from "node:assert/strict";
import { test } from "node:test";
import { EventProcessorRouter, EventsProcessor } from "../src/index.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";
import { TestProjectionEventHandler } from "./support/test-event-handler.js";

test("runs preparation transactionally before the first event fetch", async () => {
  const dataSource = createInMemoryDataSource();
  await dataSource.initialize();
  await dataSource.synchronize();
  let preparationCount = 0;
  let fetchCount = 0;
  let reportPreparationStarted: (() => void) | null = null;
  let releasePreparation: (() => void) | null = null;
  const preparationStarted = new Promise<void>((resolve) => {
    reportPreparationStarted = resolve;
  });
  const preparationGate = new Promise<void>((resolve) => {
    releasePreparation = resolve;
  });
  const processor = new EventsProcessor(
    dataSource,
    new EventProcessorRouter([new TestProjectionEventHandler()]),
    {
      processorName: "prepared-processor",
      pollIntervalMs: 60_000,
      batchSize: 1,
    },
    {
      fetchEventsPage: async () => {
        assert.equal(preparationCount, 1);
        fetchCount += 1;
        return { items: [], nextCursor: null };
      },
    },
    async ({ manager, processorName }) => {
      assert.equal(processorName, "prepared-processor");
      assert.equal(manager.queryRunner?.isTransactionActive, true);
      preparationCount += 1;
      reportPreparationStarted?.();
      await preparationGate;
    },
  );

  try {
    const firstProcessing = processor.processOnce();
    await preparationStarted;
    const concurrentProcessing = processor.processOnce();
    releasePreparation?.();
    assert.deepEqual(
      await Promise.all([firstProcessing, concurrentProcessing]),
      [0, 0],
    );
    assert.equal(fetchCount, 1);

    assert.equal(await processor.processOnce(), 0);
    assert.equal(preparationCount, 1);
    assert.equal(fetchCount, 2);
  } finally {
    await processor.stop();
  }
});
