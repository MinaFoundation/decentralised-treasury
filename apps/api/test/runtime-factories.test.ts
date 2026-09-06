import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ArchiveMaxHeights,
  EventsApiServerOptions,
  EventsRepository,
} from "@repo/indexer";
import type { Express, RequestHandler } from "express";
import type { DataSource } from "typeorm";
import {
  createAppApiRuntime,
  type AppApiRuntimeDependencies,
} from "../src/app-api.js";
import type { ApiConfig } from "../src/config.js";
import { createIndexerApiRuntime } from "../src/indexer-api.js";
import type {
  HttpApiServerLifecycle,
  HttpApiServerOptions,
} from "../src/http-api-server.js";
import { createProcessorApiRuntime } from "../src/processor-api.js";

interface MutableDataSource {
  isInitialized: boolean;
  options: { schema: string };
  initializeCalls: number;
  destroyCalls: number;
  statements: string[];
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  query(statement: string): Promise<unknown[]>;
}

interface RouteCollector {
  app: Express;
  handlers: Map<string, RequestHandler>;
  paths: string[];
}

function createConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    archiveNodeUrl: "http://127.0.0.1:8080/graphql",
    treasuryOwnerContractAddress: "unused-in-factory-tests",
    knownEventTypes: ["proposalCreated", "proposalVoteDispatched"],
    databaseUrl: "postgres://unused-in-factory-tests",
    databaseSchema: "tenant_runtime",
    apiPort: 4_000,
    apiUrl: "http://127.0.0.1:4000",
    indexerApiPort: 4_001,
    indexerApiUrl: "http://127.0.0.1:4001",
    apiPageLimitDefault: 25,
    apiPageLimitMax: 100,
    pollPendingIntervalMs: 1_000,
    pollCanonicalIntervalMs: 2_000,
    eventsBlockBatchSize: 10,
    eventsStartHeight: 0,
    pendingOverlapBlocks: 20,
    canonicalOverlapBlocks: 100,
    orphanDepthBlocks: 30,
    processorName: "proposal-processor",
    processorPollIntervalMs: 20_000,
    processorBatchSize: 200,
    processorApiPort: 4_002,
    processorApiUrl: "http://127.0.0.1:4002",
    archiveRequestTimeoutMs: 20_000,
    proposalContentMaxChars: 32_768,
    corsAllowedOrigins: ["https://treasury.example"],
    ...overrides,
  };
}

function createDataSource(
  queryResult: (statement: string) => unknown[] = () => [],
): MutableDataSource {
  return {
    isInitialized: false,
    options: { schema: "ignored_schema" },
    initializeCalls: 0,
    destroyCalls: 0,
    statements: [],
    async initialize() {
      this.initializeCalls += 1;
      this.isInitialized = true;
    },
    async destroy() {
      this.destroyCalls += 1;
      this.isInitialized = false;
    },
    async query(statement: string) {
      this.statements.push(statement);
      return queryResult(statement);
    },
  };
}

function createRouteCollector(): RouteCollector {
  const handlers = new Map<string, RequestHandler>();
  const paths: string[] = [];
  const app = {
    get(path: string, ...routeHandlers: RequestHandler[]) {
      paths.push(`GET ${path}`);
      handlers.set(`GET ${path}`, routeHandlers.at(-1)!);
      return app;
    },
    post(path: string, ...routeHandlers: RequestHandler[]) {
      paths.push(`POST ${path}`);
      handlers.set(`POST ${path}`, routeHandlers.at(-1)!);
      return app;
    },
  };
  return { app: app as unknown as Express, handlers, paths };
}

function createResponseCapture(): {
  response: Parameters<RequestHandler>[1];
  getStatus(): number;
  getBody(): unknown;
} {
  let status = 200;
  let body: unknown;
  const response = {
    status(code: number) {
      status = code;
      return response;
    },
    json(value: unknown) {
      body = value;
      return response;
    },
  };
  return {
    response: response as unknown as Parameters<RequestHandler>[1],
    getStatus: () => status,
    getBody: () => body,
  };
}

function createServerCapture(): {
  lifecycle: HttpApiServerLifecycle;
  startCalls(): number;
  stopCalls(): number;
} {
  let started = 0;
  let stopped = 0;
  return {
    lifecycle: {
      async start() {
        started += 1;
      },
      async stop() {
        stopped += 1;
      },
    },
    startCalls: () => started,
    stopCalls: () => stopped,
  };
}

describe("production API runtime factories", () => {
  it("wires the app API routes, readiness query, and dependency lifecycle", async () => {
    const config = createConfig();
    const now = new Date();
    let runtimeState: string | null = "idle";
    let heartbeatAt = now;
    let replayState: string | null = "complete";
    const dataSource = createDataSource((statement) => {
      if (statement.includes("processor_runtime_status")) {
        return runtimeState === null
          ? []
          : [
              {
                lifecycle_state: runtimeState,
                heartbeat_at: heartbeatAt,
                last_success_at: now,
                last_error_at: null,
                last_error_code: null,
                bounded_last_error: null,
                updated_at: now,
              },
            ];
      }
      if (statement.includes("processor_event_failures")) {
        return [{ count: "0" }];
      }
      if (statement.includes("processor_proposal_projection_replay")) {
        return replayState === null
          ? []
          : [
              {
                projection_name: "proposal",
                target_change_sequence: "12",
                state: replayState,
                completed_at: replayState === "complete" ? now : null,
                updated_at: now,
              },
            ];
      }
      return [];
    });
    const server = createServerCapture();
    const routeCollector = createRouteCollector();
    let capturedOptions: HttpApiServerOptions | undefined;
    let stakingCloseCalls = 0;
    let votingCloseCalls = 0;
    const stakingLedgerServices = {
      close: async () => {
        stakingCloseCalls += 1;
      },
    } as unknown as AppApiRuntimeDependencies["stakingLedgerServices"];
    const votingLedgerServices = {
      close: async () => {
        votingCloseCalls += 1;
      },
    } as unknown as AppApiRuntimeDependencies["votingLedgerServices"];

    const runtime = createAppApiRuntime({
      config,
      dataSource: dataSource as unknown as DataSource,
      stakingLedgerServices,
      votingLedgerServices,
      serverFactory: (options) => {
        capturedOptions = options;
        return server.lifecycle;
      },
    });

    await runtime.start();
    assert.equal(dataSource.initializeCalls, 1);
    assert.equal(server.startCalls(), 1);
    assert.equal(capturedOptions?.name, "app-api");
    assert.equal(capturedOptions?.port, config.apiPort);
    assert.deepEqual(
      capturedOptions?.corsAllowedOrigins,
      config.corsAllowedOrigins,
    );

    await capturedOptions?.registerRoutes?.(routeCollector.app);
    assert.ok(routeCollector.paths.includes("GET /proposals"));
    assert.ok(routeCollector.paths.includes("GET /proposals/search"));
    assert.ok(routeCollector.paths.includes("POST /proposals/:id/content"));
    assert.ok(
      routeCollector.paths.includes(
        "GET /staking-ledger/lifecycles/:lifecycleId/witnesses/:index",
      ),
    );
    assert.ok(
      routeCollector.paths.includes(
        "GET /voting-ledger/lifecycles/:lifecycleId/accounts/:publicKey",
      ),
    );

    const checkReady = capturedOptions?.checkReady;
    assert.ok(checkReady);
    await checkReady();
    assert.ok(
      dataSource.statements.some((statement) =>
        statement.includes(
          'SELECT 1 FROM "tenant_runtime"."processor_proposals" LIMIT 1',
        ),
      ),
    );
    assert.ok(
      dataSource.statements.some((statement) =>
        statement.includes('FROM "tenant_runtime"."processor_runtime_status"'),
      ),
    );
    assert.ok(
      dataSource.statements.some((statement) =>
        statement.includes(
          'FROM "tenant_runtime"."processor_proposal_projection_replay"',
        ),
      ),
    );

    replayState = "collecting";
    await assert.rejects(
      async () => await checkReady(),
      /Processor runtime is not ready/,
    );
    replayState = null;
    await assert.rejects(
      async () => await checkReady(),
      /Processor runtime is not ready/,
    );
    replayState = "complete";

    runtimeState = null;
    await assert.rejects(
      async () => await checkReady(),
      /Processor runtime is not ready/,
    );
    runtimeState = "stopped";
    await assert.rejects(
      async () => await checkReady(),
      /Processor runtime is not ready/,
    );
    runtimeState = "blocked";
    await assert.rejects(
      async () => await checkReady(),
      /Processor runtime is not ready/,
    );
    runtimeState = "idle";
    heartbeatAt = new Date(Date.now() - 61_000);
    await assert.rejects(
      async () => await checkReady(),
      /Processor runtime is not ready/,
    );
    heartbeatAt = now;
    await checkReady();

    await runtime.stop();
    await runtime.stop();
    assert.equal(server.stopCalls(), 2);
    assert.equal(dataSource.destroyCalls, 1);
    assert.equal(stakingCloseCalls, 1);
    assert.equal(votingCloseCalls, 1);
  });

  it("wires processor readiness, routes, and database cleanup", async () => {
    const now = new Date();
    const dataSource = createDataSource((statement) => {
      if (statement.includes("processor_runtime_status")) {
        return [
          {
            lifecycle_state: "idle",
            heartbeat_at: now,
            last_success_at: now,
            last_error_at: null,
            last_error_code: null,
            bounded_last_error: null,
            updated_at: now,
          },
        ];
      }
      if (statement.includes("processor_event_failures")) {
        return [{ count: "0" }];
      }
      if (statement.includes("processor_proposal_projection_replay")) {
        return [
          {
            projection_name: "proposal",
            target_change_sequence: "12",
            state: "complete",
            completed_at: now,
            updated_at: now,
          },
        ];
      }
      return [];
    });
    const config = createConfig();
    const server = createServerCapture();
    const routeCollector = createRouteCollector();
    let capturedOptions: HttpApiServerOptions | undefined;
    const runtime = createProcessorApiRuntime({
      config,
      dataSource: dataSource as unknown as DataSource,
      serverFactory: (options) => {
        capturedOptions = options;
        return server.lifecycle;
      },
    });

    await runtime.start();
    await capturedOptions?.registerRoutes?.(routeCollector.app);
    await capturedOptions?.checkReady?.();

    assert.equal(capturedOptions?.name, "processor-api");
    assert.ok(routeCollector.paths.includes("GET /status"));
    assert.ok(routeCollector.paths.includes("GET /proposals/:id"));
    assert.ok(routeCollector.paths.includes("GET /votes/:id"));
    assert.ok(routeCollector.paths.includes("GET /vote-nullifiers/:id"));
    assert.ok(routeCollector.paths.includes("GET /vote-tallies/:id"));
    assert.ok(routeCollector.paths.includes("GET /proposal-executions/:id"));
    assert.ok(
      dataSource.statements.some((statement) =>
        statement.includes(
          'SELECT 1 FROM "tenant_runtime"."processor_offsets" LIMIT 1',
        ),
      ),
    );
    assert.ok(
      dataSource.statements.some((statement) =>
        statement.includes('FROM "tenant_runtime"."processor_runtime_status"'),
      ),
    );
    assert.ok(
      dataSource.statements.some((statement) =>
        statement.includes('FROM "tenant_runtime"."processor_event_failures"'),
      ),
    );
    assert.ok(
      dataSource.statements.some((statement) =>
        statement.includes(
          'FROM "tenant_runtime"."processor_proposal_projection_replay"',
        ),
      ),
    );

    await runtime.stop();
    assert.equal(dataSource.destroyCalls, 1);
    assert.equal(server.startCalls(), 1);
    assert.equal(server.stopCalls(), 1);
  });

  it("wires indexer readiness and includes archive timeout in freshness", async () => {
    const config = createConfig();
    const updatedAt = new Date(Date.now() - 50_000);
    const repository = {
      getCursor: async (cursorName: string) =>
        cursorName === "events:pending" ? 110 : 100,
      getOperationalStatus: async () => ({
        totalRejectionCount: 0,
        unresolvedRejectionCount: 0,
        runtimeOperations: [
          "events:pending",
          "events:canonical",
          "events:orphan-sweep",
        ].map((operationName) => ({
          operationName,
          state: "succeeded" as const,
          updatedAt,
          lastStartedAt: updatedAt,
          lastSucceededAt: updatedAt,
          lastFailedAt: null,
          lastError: null,
        })),
        failedRuntimeOperationCount: 0,
        failedRuntimeOperations: [],
      }),
    } as unknown as EventsRepository;
    const archive = {
      getMaxBlockHeights: async (): Promise<ArchiveMaxHeights> => ({
        canonicalMaxBlockHeight: 120,
        pendingMaxBlockHeight: 130,
      }),
    };
    const routeCollector = createRouteCollector();
    const server = createServerCapture();
    let capturedOptions: EventsApiServerOptions | undefined;
    const runtime = createIndexerApiRuntime({
      config,
      repository,
      archive,
      serverFactory: (receivedRepository, options) => {
        assert.equal(receivedRepository, repository);
        capturedOptions = options;
        return server.lifecycle;
      },
    });

    await runtime.start();
    await capturedOptions?.registerTopLevelRoutes?.(routeCollector.app);
    const readyHandler = routeCollector.handlers.get("GET /readyz");
    assert.ok(readyHandler);
    const responseCapture = createResponseCapture();
    await readyHandler(
      {} as Parameters<RequestHandler>[0],
      responseCapture.response,
      () => undefined,
    );

    assert.equal(capturedOptions?.port, config.indexerApiPort);
    assert.deepEqual(
      capturedOptions?.corsAllowedOrigins,
      config.corsAllowedOrigins,
    );
    assert.equal(responseCapture.getStatus(), 200);
    assert.equal(
      (responseCapture.getBody() as { runtime: { maxAgeMs: number } }).runtime
        .maxAgeMs,
      60_000,
    );

    await runtime.stop();
    assert.equal(server.startCalls(), 1);
    assert.equal(server.stopCalls(), 1);
  });
});
