import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  EventsProcessorConfig,
  EventsProcessorSetup,
} from "@repo/processor";
import type { ApiConfig } from "../src/config.js";
import {
  createIndexerWorkerRuntime,
  main as indexerMain,
  type IndexerWorkerRuntime,
} from "../src/indexer.js";
import {
  createProcessorWorkerRuntime,
  main as processorMain,
  type ProcessorWorkerRuntime,
} from "../src/processor.js";
import type { LifecycleVotingLedgerServiceRegistry } from "../src/processors/proposals/lifecycle-voting-ledger-service-registry.js";
import type { LifecycleStakingLedgerServiceRegistry } from "../src/staking-ledger/lifecycle-staking-ledger-service-registry.js";

function createConfig(): ApiConfig {
  return {
    archiveNodeUrl: "http://127.0.0.1:8080/graphql",
    treasuryOwnerContractAddress: "unused-in-worker-tests",
    knownEventTypes: ["proposalCreated", "proposalVoteDispatched"],
    databaseUrl: "postgres://unused-in-worker-tests",
    databaseSchema: "tenant_worker",
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
  };
}

describe("indexer worker entrypoint", () => {
  it("starts the production indexer factory with the loaded configuration", async () => {
    const config = createConfig();
    let capturedConfig: ApiConfig | undefined;
    let startCalls = 0;
    const runtime = createIndexerWorkerRuntime({
      config,
      indexerFactory: (value) => {
        capturedConfig = value;
        return {
          async start() {
            startCalls += 1;
          },
        };
      },
    });

    await runtime.run([]);

    assert.equal(capturedConfig, config);
    assert.equal(startCalls, 1);
  });

  it("resolves a rejection and always closes its repository", async () => {
    const calls: string[] = [];
    const logs: string[] = [];
    const runtime = createIndexerWorkerRuntime({
      config: createConfig(),
      rejectionRepositoryFactory: () => ({
        async initialize() {
          calls.push("initialize");
        },
        async resolveRejection(rejectionId) {
          calls.push(`resolve:${rejectionId}`);
          return true;
        },
        async close() {
          calls.push("close");
        },
      }),
      log: (message) => logs.push(message),
    });

    await runtime.run(["--resolve-rejection", "rejection-7"]);

    assert.deepEqual(calls, ["initialize", "resolve:rejection-7", "close"]);
    assert.deepEqual(logs, [
      "[events-indexer] resolved rejection id=rejection-7",
    ]);
  });

  it("closes the repository when a rejection does not exist", async () => {
    let closeCalls = 0;
    const runtime = createIndexerWorkerRuntime({
      config: createConfig(),
      rejectionRepositoryFactory: () => ({
        async initialize() {},
        async resolveRejection() {
          return false;
        },
        async close() {
          closeCalls += 1;
        },
      }),
    });

    await assert.rejects(
      runtime.run(["--resolve-rejection", "missing"]),
      /Unresolved rejection missing was not found/,
    );
    assert.equal(closeCalls, 1);
  });

  it("closes the repository after an initialization failure", async () => {
    let closeCalls = 0;
    const runtime = createIndexerWorkerRuntime({
      config: createConfig(),
      rejectionRepositoryFactory: () => ({
        async initialize() {
          throw new Error("database initialization failed");
        },
        async resolveRejection() {
          return true;
        },
        async close() {
          closeCalls += 1;
        },
      }),
    });

    await assert.rejects(
      runtime.run(["--resolve-rejection", "unread"]),
      /database initialization failed/,
    );
    assert.equal(closeCalls, 1);
  });

  it("rejects malformed and unknown arguments", async () => {
    const runtime = createIndexerWorkerRuntime({ config: createConfig() });

    await assert.rejects(
      runtime.run(["--resolve-rejection"]),
      /Usage: indexer:resolve-rejection/,
    );
    await assert.rejects(
      runtime.run(["--unknown"]),
      /Unknown indexer argument/,
    );
  });

  it("passes the real module arguments through the injected main seam", async () => {
    const config = createConfig();
    const capturedArgs: string[][] = [];
    const runtime: IndexerWorkerRuntime = {
      async run(args) {
        capturedArgs.push(args);
      },
    };

    await indexerMain(["--resolve-rejection", "id-9"], {
      loadConfig: () => config,
      createRuntime: ({ config: receivedConfig }) => {
        assert.equal(receivedConfig, config);
        return runtime;
      },
    });

    assert.deepEqual(capturedArgs, [["--resolve-rejection", "id-9"]]);
  });
});

describe("processor worker entrypoint", () => {
  it("wires all contract event handlers and closes dependencies once", async () => {
    const config = createConfig();
    const calls: string[] = [];
    let capturedProcessorConfig: EventsProcessorConfig | undefined;
    let capturedSetup: EventsProcessorSetup | undefined;
    const stakingLedgerServices = {
      async close() {
        calls.push("close-staking");
      },
    } as LifecycleStakingLedgerServiceRegistry;
    const votingLedgerServices = {
      async close() {
        calls.push("close-voting");
      },
    } as LifecycleVotingLedgerServiceRegistry;
    const runtime = createProcessorWorkerRuntime({
      config,
      stakingLedgerServices,
      votingLedgerServices,
      processorFactory: (processorConfig, setup) => {
        capturedProcessorConfig = processorConfig;
        capturedSetup = setup;
        return {
          async start() {
            calls.push("start");
          },
          async stop() {
            calls.push("stop-processor");
          },
          async retryBlockedEvent() {
            calls.push("retry");
            return 2;
          },
        };
      },
    });

    await runtime.start();
    assert.equal(await runtime.retryBlockedEvent(), 2);
    await Promise.all([runtime.stop(), runtime.stop()]);

    assert.deepEqual(capturedProcessorConfig, {
      databaseUrl: config.databaseUrl,
      databaseSchema: config.databaseSchema,
      processorName: config.processorName,
      processorPollIntervalMs: config.processorPollIntervalMs,
      processorBatchSize: config.processorBatchSize,
      indexerApiUrl: config.indexerApiUrl,
    });
    assert.deepEqual(
      capturedSetup?.handlers.map((handler) => handler.constructor.name),
      [
        "ProposalCreatedEventHandler",
        "ProposalPauseToggledEventHandler",
        "ProposalVoteDispatchedEventHandler",
        "ProposalVotesTalliedEventHandler",
        "ProposalExecutedEventHandler",
      ],
    );
    assert.ok(capturedSetup?.outputEntitySchemas.length);
    assert.equal(typeof capturedSetup?.beforeProcessing, "function");
    assert.deepEqual(calls, [
      "start",
      "retry",
      "stop-processor",
      "close-staking",
      "close-voting",
    ]);
  });

  it("closes all dependencies when processor startup fails", async () => {
    const calls: string[] = [];
    const runtime = createProcessorWorkerRuntime({
      config: createConfig(),
      stakingLedgerServices: {
        async close() {
          calls.push("close-staking");
        },
      } as LifecycleStakingLedgerServiceRegistry,
      votingLedgerServices: {
        async close() {
          calls.push("close-voting");
        },
      } as LifecycleVotingLedgerServiceRegistry,
      processorFactory: () => ({
        async start() {
          throw new Error("startup failed");
        },
        async stop() {
          calls.push("stop-processor");
        },
        async retryBlockedEvent() {
          return 0;
        },
      }),
    });

    await assert.rejects(runtime.start(), /startup failed/);
    assert.deepEqual(calls, [
      "stop-processor",
      "close-staking",
      "close-voting",
    ]);
  });

  it("starts the worker and registers bounded shutdown handlers", async () => {
    const config = createConfig();
    const calls: string[] = [];
    const listeners = new Map<string, () => void>();
    const runtime: ProcessorWorkerRuntime = {
      async start() {
        calls.push("start");
      },
      async retryBlockedEvent() {
        return 0;
      },
      async stop() {
        calls.push("stop");
      },
    };

    await processorMain([], {
      loadConfig: () => config,
      createRuntime: () => runtime,
      registerSignal: (signal, listener) => listeners.set(signal, listener),
      exit: (code) => calls.push(`exit:${code}`),
      log: (message) => calls.push(message),
    });
    assert.deepEqual([...listeners.keys()], ["SIGINT", "SIGTERM"]);
    assert.deepEqual(calls, ["start"]);

    listeners.get("SIGINT")?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, [
      "start",
      "[events-processor] received SIGINT, shutting down",
      "stop",
      "exit:0",
    ]);

    listeners.get("SIGTERM")?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(calls.slice(-3), [
      "[events-processor] received SIGTERM, shutting down",
      "stop",
      "exit:0",
    ]);
  });

  it("runs one explicit retry and stops the runtime", async () => {
    const calls: string[] = [];
    const runtime: ProcessorWorkerRuntime = {
      async start() {
        calls.push("start");
      },
      async retryBlockedEvent() {
        calls.push("retry");
        return 1;
      },
      async stop() {
        calls.push("stop");
      },
    };

    await processorMain(["--retry-blocked"], {
      loadConfig: createConfig,
      createRuntime: () => runtime,
      log: (message) => calls.push(message),
    });

    assert.deepEqual(calls, [
      "retry",
      "[events-processor] explicit retry succeeded (processedRows=1)",
      "stop",
    ]);
  });

  it("stops after an explicit retry cannot resolve an event", async () => {
    let stopCalls = 0;
    await assert.rejects(
      processorMain(["--retry-blocked"], {
        loadConfig: createConfig,
        createRuntime: () => ({
          async start() {},
          async retryBlockedEvent() {
            return 0;
          },
          async stop() {
            stopCalls += 1;
          },
        }),
      }),
      /No blocked processor event was resolved/,
    );
    assert.equal(stopCalls, 1);
  });

  it("rejects all non-exact processor argument forms before construction", async () => {
    let loadConfigCalls = 0;
    const dependencies = {
      loadConfig: () => {
        loadConfigCalls += 1;
        return createConfig();
      },
    };

    await assert.rejects(
      processorMain(["--unknown"], dependencies),
      /Unknown processor arguments: --unknown/,
    );
    await assert.rejects(
      processorMain(["--retry-blocked", "extra"], dependencies),
      /Unknown processor arguments: --retry-blocked extra/,
    );
    await assert.rejects(
      processorMain(["--retry-blocked", "--retry-blocked"], dependencies),
      /Unknown processor arguments/,
    );
    assert.equal(loadConfigCalls, 0);
  });
});
