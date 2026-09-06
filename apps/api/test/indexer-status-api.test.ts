import assert from "node:assert/strict";
import { createServer } from "node:net";
import { afterEach, describe, it } from "node:test";
import {
  EventsApiServer,
  EventsIndexer,
  EventsRepository,
  ArchiveEventRejectionEntity,
  IndexerRuntimeStatusEntity,
} from "@repo/indexer";
import {
  ProcessorEventFailureEntity,
  ProcessorOffsetEntity,
  ProcessorRuntimeStatusEntity,
} from "@repo/processor";
import type { DataSource } from "typeorm";
import { createIndexerStatusRoutes } from "../src/indexer-status-routes.js";
import { HttpApiServer } from "../src/http-api-server.js";
import { createProcessorStatusRoutes } from "../src/processor-status-routes.js";
import { ProposalProjectionReplayEntity } from "../src/processors/proposals/proposal-projection-replay-entity.js";
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
        server.close(() =>
          reject(new Error("Unable to resolve ephemeral port")),
        );
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
    dataSource = createInMemoryDataSource("public", [
      ProposalProjectionReplayEntity,
    ]);
    repository = new EventsRepository(dataSource, "public", {
      knownEventTypes: ["proposalCreated", "unrelatedEvent"],
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
        {
          blockInfo: { height: 122 },
          eventData: [
            {
              accountUpdateId: "2",
              data: ["1", "33", "44"],
              transactionInfo: {
                hash: "tx-unrelated-status-test",
                zkappAccountUpdateIds: [2],
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
        lastSeenChangeSequence: "0",
      },
      ["processorName"],
    );
    await dataSource.getRepository(ProcessorRuntimeStatusEntity).insert({
      processorName: "proposal-processor",
      lifecycleState: "idle",
      startedAt: new Date(),
      heartbeatAt: new Date(),
      lastSuccessAt: new Date(),
      lastErrorAt: null,
      lastErrorCode: null,
      boundedLastError: null,
    });
    await dataSource.getRepository(ProposalProjectionReplayEntity).insert({
      projectionName: "proposal",
      targetChangeSequence: "0",
      state: "complete",
      completedAt: new Date(),
    });

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
        runtimeMaxAgeMs: 30_000,
      }),
    });
    processorServer = new HttpApiServer({
      name: "processor-api-test",
      port: processorPort,
      registerRoutes: createProcessorStatusRoutes({
        dataSource,
        processorName: "proposal-processor",
        eventTypes: ["proposalCreated"],
      }),
    });
    await indexerServer.start();
    await processorServer.start();

    const statusStatements: string[] = [];
    const originalQuery = dataSource.query.bind(dataSource);
    dataSource.query = (async (query: string, parameters?: unknown[]) => {
      if (
        query.includes("processor_offsets") ||
        query.includes("archive_events")
      ) {
        statusStatements.push(query);
      }
      return await originalQuery(query, parameters);
    }) as DataSource["query"];

    const indexerResponse = await fetch(
      `http://127.0.0.1:${indexerPort}/status`,
    );
    assert.equal(indexerResponse.status, 200);
    const indexerPayload = (await indexerResponse.json()) as {
      ok: boolean;
      ready: boolean;
      archive: {
        canonicalMaxBlockHeight: number;
        pendingMaxBlockHeight: number;
      };
      pendingCursor: number | null;
      canonicalCursor: number | null;
      remainingPendingBlocks: number;
      remainingCanonicalBlocks: number;
    };
    const processorResponse = await fetch(
      `http://127.0.0.1:${processorPort}/status`,
    );
    assert.equal(processorResponse.status, 200);
    const processorPayload = (await processorResponse.json()) as {
      ok: boolean;
      processorName: string;
      offset: {
        lastSeenUpdatedAt: string;
        lastSeenEventId: string;
        lastSeenChangeSequence: string;
        updatedAt: string;
      } | null;
      remainingEvents: number;
      projectionReplay: {
        projectionName: string;
        state: string;
        completedAt: string | null;
      } | null;
    };

    assert.equal(indexerPayload.ok, true);
    assert.equal(indexerPayload.ready, false);
    assert.deepEqual(indexerPayload.archive, {
      canonicalMaxBlockHeight: 140,
      pendingMaxBlockHeight: 180,
    });
    assert.equal(indexerPayload.pendingCursor, 120);
    assert.equal(indexerPayload.canonicalCursor, 100);
    assert.equal(indexerPayload.remainingPendingBlocks, 60);
    assert.equal(indexerPayload.remainingCanonicalBlocks, 40);

    const missingRuntimeReadyResponse = await fetch(
      `http://127.0.0.1:${indexerPort}/readyz`,
    );
    assert.equal(missingRuntimeReadyResponse.status, 503);
    const missingRuntimeReady = (await missingRuntimeReadyResponse.json()) as {
      runtime: { missingOperations: string[] };
    };
    assert.deepEqual(missingRuntimeReady.runtime.missingOperations, [
      EventsIndexer.PENDING_CURSOR,
      EventsIndexer.CANONICAL_CURSOR,
      "events:orphan-sweep",
    ]);

    for (const operationName of [
      EventsIndexer.PENDING_CURSOR,
      EventsIndexer.CANONICAL_CURSOR,
      "events:orphan-sweep",
    ]) {
      await repository.recordRuntimeStarted(operationName);
      await repository.recordRuntimeSucceeded(operationName);
    }
    const freshRuntimeReadyResponse = await fetch(
      `http://127.0.0.1:${indexerPort}/readyz`,
    );
    assert.equal(freshRuntimeReadyResponse.status, 200);
    assert.equal(
      ((await freshRuntimeReadyResponse.json()) as { ok: boolean }).ok,
      true,
    );

    await dataSource
      .getRepository(IndexerRuntimeStatusEntity)
      .update(
        { operationName: EventsIndexer.CANONICAL_CURSOR },
        { updatedAt: new Date(Date.now() - 31_000) },
      );
    const staleRuntimeReadyResponse = await fetch(
      `http://127.0.0.1:${indexerPort}/readyz`,
    );
    assert.equal(staleRuntimeReadyResponse.status, 503);
    const staleRuntimeReady = (await staleRuntimeReadyResponse.json()) as {
      runtime: { staleOperations: string[] };
    };
    assert.deepEqual(staleRuntimeReady.runtime.staleOperations, [
      EventsIndexer.CANONICAL_CURSOR,
    ]);
    await repository.recordRuntimeStarted(EventsIndexer.CANONICAL_CURSOR);
    await repository.recordRuntimeSucceeded(EventsIndexer.CANONICAL_CURSOR);

    assert.equal(processorPayload.ok, true);
    assert.equal(processorPayload.processorName, "proposal-processor");
    assert.equal(processorPayload.offset?.lastSeenEventId, "0");
    assert.equal(processorPayload.offset?.lastSeenChangeSequence, "0");
    assert.equal(processorPayload.remainingEvents, 1);
    assert.equal(processorPayload.projectionReplay?.projectionName, "proposal");
    assert.equal(processorPayload.projectionReplay?.state, "complete");
    assert.ok(processorPayload.projectionReplay?.completedAt);
    assert.ok(
      statusStatements.some((statement) =>
        statement.includes('FROM "public"."processor_offsets"'),
      ),
    );
    assert.ok(
      statusStatements.some((statement) =>
        statement.includes('FROM "public"."archive_events"'),
      ),
    );

    await dataSource
      .getRepository(ProposalProjectionReplayEntity)
      .update(
        { projectionName: "proposal" },
        { state: "collecting", completedAt: null },
      );
    const collectingReplayResponse = await fetch(
      `http://127.0.0.1:${processorPort}/status`,
    );
    assert.equal(collectingReplayResponse.status, 503);
    const collectingReplay = (await collectingReplayResponse.json()) as {
      ready: boolean;
      projectionReplay: { state: string; completedAt: string | null };
    };
    assert.equal(collectingReplay.ready, false);
    assert.equal(collectingReplay.projectionReplay.state, "collecting");
    assert.equal(collectingReplay.projectionReplay.completedAt, null);

    await dataSource.getRepository(ProposalProjectionReplayEntity).delete({
      projectionName: "proposal",
    });
    const missingReplayResponse = await fetch(
      `http://127.0.0.1:${processorPort}/status`,
    );
    assert.equal(missingReplayResponse.status, 503);
    assert.equal(
      ((await missingReplayResponse.json()) as { projectionReplay: null })
        .projectionReplay,
      null,
    );
    await dataSource.getRepository(ProposalProjectionReplayEntity).insert({
      projectionName: "proposal",
      targetChangeSequence: "0",
      state: "complete",
      completedAt: new Date(),
    });

    await dataSource
      .getRepository(ProcessorRuntimeStatusEntity)
      .update(
        { processorName: "proposal-processor" },
        { heartbeatAt: new Date(Date.now() - 31_000) },
      );
    const staleProcessorResponse = await fetch(
      `http://127.0.0.1:${processorPort}/status`,
    );
    assert.equal(staleProcessorResponse.status, 503);
    const staleProcessor = (await staleProcessorResponse.json()) as {
      ok: boolean;
      ready: boolean;
      runtime: { lifecycleState: string; heartbeatAt: string };
    };
    assert.equal(staleProcessor.ok, false);
    assert.equal(staleProcessor.ready, false);
    assert.equal(staleProcessor.runtime.lifecycleState, "idle");

    await dataSource
      .getRepository(ProcessorRuntimeStatusEntity)
      .update(
        { processorName: "proposal-processor" },
        { heartbeatAt: new Date() },
      );

    await dataSource
      .getRepository(ProcessorRuntimeStatusEntity)
      .update(
        { processorName: "proposal-processor" },
        { lifecycleState: "stopping" },
      );
    const stoppingProcessorResponse = await fetch(
      `http://127.0.0.1:${processorPort}/status`,
    );
    assert.equal(stoppingProcessorResponse.status, 503);

    await dataSource
      .getRepository(ProcessorRuntimeStatusEntity)
      .update(
        { processorName: "proposal-processor" },
        { lifecycleState: "idle" },
      );

    await dataSource
      .getRepository(ProcessorRuntimeStatusEntity)
      .update(
        { processorName: "proposal-processor" },
        { lifecycleState: "blocked" },
      );
    const blockedProcessorResponse = await fetch(
      `http://127.0.0.1:${processorPort}/status`,
    );
    assert.equal(blockedProcessorResponse.status, 503);
    const blockedProcessor = (await blockedProcessorResponse.json()) as {
      ok: boolean;
      ready: boolean;
      runtime: { lifecycleState: string };
    };
    assert.equal(blockedProcessor.ok, false);
    assert.equal(blockedProcessor.ready, false);
    assert.equal(blockedProcessor.runtime.lifecycleState, "blocked");

    await dataSource
      .getRepository(ProcessorRuntimeStatusEntity)
      .update(
        { processorName: "proposal-processor" },
        { lifecycleState: "idle" },
      );
    await dataSource.getRepository(ProcessorEventFailureEntity).insert({
      processorName: "proposal-processor",
      archiveEventId: "1",
      changeSequence: "1",
      state: "retrying",
      attemptCount: 1,
      retryAfter: new Date(0),
      errorCode: "EVENT_HANDLER_FAILED",
      boundedErrorMessage: "injected failure",
      eventSnapshot: {},
      lastFailedAt: new Date(),
      resolvedAt: null,
    });
    const dueFailureResponse = await fetch(
      `http://127.0.0.1:${processorPort}/status`,
    );
    assert.equal(dueFailureResponse.status, 503);
    const dueFailureStatus = (await dueFailureResponse.json()) as {
      failures: { due: number };
    };
    assert.equal(dueFailureStatus.failures.due, 1);

    await dataSource.getRepository(ArchiveEventRejectionEntity).insert({
      archiveStatus: "pending",
      blockHeight: 181,
      blockEventIndex: 0,
      reasonCode: "INVALID_EVENT",
      reason: "invalid test observation",
      observationHash: "rejection-hash",
      rawObservation: {},
      resolutionStatus: "unresolved",
      resolvedAt: null,
      occurrenceCount: 1,
    });
    const rejectedReadyResponse = await fetch(
      `http://127.0.0.1:${indexerPort}/readyz`,
    );
    assert.equal(rejectedReadyResponse.status, 503);
    assert.equal(
      ((await rejectedReadyResponse.json()) as { ready: boolean }).ready,
      false,
    );
    const degradedStatusResponse = await fetch(
      `http://127.0.0.1:${indexerPort}/status`,
    );
    assert.equal(degradedStatusResponse.status, 200);
    const degradedStatus = (await degradedStatusResponse.json()) as {
      ok: boolean;
      ready: boolean;
      rejections: { unresolved: number };
    };
    assert.equal(degradedStatus.ok, true);
    assert.equal(degradedStatus.ready, false);
    assert.equal(degradedStatus.rejections.unresolved, 1);

    await dataSource
      .getRepository(ArchiveEventRejectionEntity)
      .update(
        { observationHash: "rejection-hash" },
        { resolutionStatus: "resolved", resolvedAt: new Date() },
      );
    await dataSource.getRepository(IndexerRuntimeStatusEntity).update(
      { operationName: EventsIndexer.PENDING_CURSOR },
      {
        state: "failed",
        lastStartedAt: new Date(),
        lastFailedAt: new Date(),
        lastError: "archive unavailable",
      },
    );
    const failedRuntimeReadyResponse = await fetch(
      `http://127.0.0.1:${indexerPort}/readyz`,
    );
    assert.equal(failedRuntimeReadyResponse.status, 503);
    const failedRuntimeReady = (await failedRuntimeReadyResponse.json()) as {
      runtime: {
        failedOperations: Array<{
          operationName: string;
          lastError: string | null;
        }>;
      };
    };
    assert.equal(
      failedRuntimeReady.runtime.failedOperations[0]?.operationName,
      EventsIndexer.PENDING_CURSOR,
    );
    assert.equal(
      failedRuntimeReady.runtime.failedOperations[0]?.lastError,
      "archive unavailable",
    );
  });

  it("reports processor dependency failures as unavailable", async () => {
    const port = await getAvailablePort();
    const attemptedStatements: string[] = [];
    const failingDataSource = {
      options: { schema: "tenant-schema" },
      query: async (query: string) => {
        attemptedStatements.push(query);
        throw new Error("database unavailable");
      },
    } as unknown as DataSource;

    processorServer = new HttpApiServer({
      name: "processor-status-failure-test",
      port,
      registerRoutes: createProcessorStatusRoutes({
        dataSource: failingDataSource,
        processorName: "proposal-processor",
        eventTypes: ["proposalCreated"],
      }),
    });
    await processorServer.start();

    const response = await fetch(`http://127.0.0.1:${port}/status`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "Service unavailable",
    });
    assert.match(
      attemptedStatements[0] ?? "",
      /FROM "tenant-schema"\."processor_offsets"/,
    );
  });
});
