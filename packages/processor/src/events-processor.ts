import { type DataSource, type EntityManager, TypeORMError } from "typeorm";
import {
  ProcessorEventFailureEntity,
  type ProcessorLifecycleState,
  ProcessorOffsetEntity,
  ProcessorRuntimeStatusEntity,
} from "./entities.js";
import type { EventProcessorHandler } from "./event-handler.js";
import {
  IndexerEventsApiClient,
  IndexerEventsApiError,
  type IndexerEventsSource,
  type SequencedArchiveEvent,
} from "./indexer-events-api-client.js";
import {
  createProcessorDataSource,
  type ProcessorEntitySchema,
} from "./processor-data-source.js";
import { EventProcessorRouter } from "./router.js";

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 60_000;
const MAX_PERSISTED_ERROR_LENGTH = 2_000;
const PROCESSOR_ADVISORY_LOCK_NAMESPACE = 20_260_903;

type EventProcessingResult = "processed" | "skipped" | "blocked";

export interface EventsProcessorOptions {
  processorName: string;
  pollIntervalMs: number;
  batchSize: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
}

interface NormalizedEventsProcessorOptions {
  processorName: string;
  pollIntervalMs: number;
  batchSize: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
}

export interface EventsProcessorSetup {
  handlers: EventProcessorHandler[];
  outputEntitySchemas: ProcessorEntitySchema[];
  beforeProcessing?: (
    context: EventsProcessorBeforeProcessingContext,
  ) => Promise<void>;
}

export interface EventsProcessorBeforeProcessingContext {
  manager: EntityManager;
  processorName: string;
}

export interface EventsProcessorConfig {
  databaseUrl: string;
  databaseSchema: string;
  processorName: string;
  processorPollIntervalMs: number;
  processorBatchSize: number;
  indexerApiUrl: string;
}

class EventHandlingError extends Error {
  public readonly code = "EVENT_NOT_HANDLED";
}

function boundedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_PERSISTED_ERROR_LENGTH);
}

function eventFailureCode(error: unknown): string {
  if (error instanceof EventHandlingError) {
    return error.code;
  }
  if (error instanceof TypeORMError) {
    return "EVENT_DATABASE_FAILED";
  }
  return "EVENT_HANDLER_FAILED";
}

function infrastructureErrorCode(error: unknown): string {
  if (error instanceof IndexerEventsApiError) {
    return error.code;
  }
  if (error instanceof TypeORMError) {
    return "PROCESSOR_DATABASE_ERROR";
  }
  return "PROCESSOR_INFRASTRUCTURE_ERROR";
}

function eventSnapshot(event: SequencedArchiveEvent): Record<string, unknown> {
  return {
    id: event.id,
    changeSequence: event.changeSequence,
    status: event.status,
    pendingSeenAtHeight: event.pendingSeenAtHeight,
    blockHeight: event.blockHeight,
    blockTimestamp: event.blockTimestamp?.toISOString() ?? null,
    globalSlotSinceGenesis: event.globalSlotSinceGenesis,
    stateHash: event.stateHash,
    parentHash: event.parentHash,
    chainStatus: event.chainStatus,
    eventType: event.eventType,
    txHash: event.txHash,
    accountUpdateId: event.accountUpdateId,
    accountUpdateIndex: event.accountUpdateIndex,
    eventIndex: event.eventIndex,
    blockEventIndex: event.blockEventIndex,
    rawEventData: event.rawEventData,
    indexedAt: event.indexedAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function isImmutableSuccessor(
  failure: ProcessorEventFailureEntity,
  event: SequencedArchiveEvent,
): boolean {
  const snapshot = failure.eventSnapshot;
  const snapshotRawEventData = snapshot.rawEventData;
  const snapshotContractData =
    snapshotRawEventData !== null &&
    typeof snapshotRawEventData === "object" &&
    !Array.isArray(snapshotRawEventData)
      ? (snapshotRawEventData as Record<string, unknown>).data
      : undefined;
  return (
    event.id === failure.archiveEventId &&
    BigInt(event.changeSequence) > BigInt(failure.changeSequence) &&
    snapshot.id === event.id &&
    snapshot.eventType === event.eventType &&
    snapshot.txHash === event.txHash &&
    snapshot.accountUpdateId === event.accountUpdateId &&
    snapshot.accountUpdateIndex === event.accountUpdateIndex &&
    snapshot.eventIndex === event.eventIndex &&
    stableJson(snapshotContractData) === stableJson(event.rawEventData.data)
  );
}

function normalizeOptions(
  options: EventsProcessorOptions,
): NormalizedEventsProcessorOptions {
  if (
    typeof options.processorName !== "string" ||
    options.processorName.length === 0 ||
    options.processorName.trim() !== options.processorName
  ) {
    throw new TypeError(
      "EventsProcessor processorName must be a nonempty trimmed string",
    );
  }
  if (
    !Number.isSafeInteger(options.pollIntervalMs) ||
    options.pollIntervalMs < 1
  ) {
    throw new TypeError(
      "EventsProcessor pollIntervalMs must be a positive safe integer",
    );
  }
  if (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1) {
    throw new TypeError(
      "EventsProcessor batchSize must be a positive safe integer",
    );
  }
  const normalized = {
    ...options,
    maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    retryBaseDelayMs: options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
    retryMaxDelayMs: options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS,
  };
  if (
    !Number.isSafeInteger(normalized.maxAttempts) ||
    normalized.maxAttempts < 1
  ) {
    throw new TypeError(
      "EventsProcessor maxAttempts must be a positive integer",
    );
  }
  if (
    !Number.isFinite(normalized.retryBaseDelayMs) ||
    normalized.retryBaseDelayMs < 0 ||
    !Number.isFinite(normalized.retryMaxDelayMs) ||
    normalized.retryMaxDelayMs < normalized.retryBaseDelayMs
  ) {
    throw new TypeError("EventsProcessor retry delays are invalid");
  }
  return normalized;
}

export class EventsProcessor {
  private timer: NodeJS.Timeout | null = null;
  private activeProcessing: Promise<number> | null = null;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private heartbeatRefresh: Promise<void> | null = null;
  private preparationPromise: Promise<void> | null = null;
  private cancelRetryWait: (() => void) | null = null;
  private processingPrepared = false;
  private started = false;
  private stopping = false;
  private readonly options: NormalizedEventsProcessorOptions;

  public static fromConfig(
    config: EventsProcessorConfig,
    setup: EventsProcessorSetup,
  ): EventsProcessor {
    const dataSource = createProcessorDataSource(
      config,
      setup.outputEntitySchemas,
    );
    const router = new EventProcessorRouter(setup.handlers);
    const eventsApiClient = new IndexerEventsApiClient({
      indexerApiUrl: config.indexerApiUrl,
    });

    return new EventsProcessor(
      dataSource,
      router,
      {
        processorName: config.processorName,
        pollIntervalMs: config.processorPollIntervalMs,
        batchSize: config.processorBatchSize,
      },
      eventsApiClient,
      setup.beforeProcessing,
    );
  }

  public constructor(
    private readonly dataSource: DataSource,
    private readonly router: EventProcessorRouter,
    options: EventsProcessorOptions,
    private readonly eventsApiClient: IndexerEventsSource,
    private readonly beforeProcessing?: (
      context: EventsProcessorBeforeProcessingContext,
    ) => Promise<void>,
  ) {
    this.options = normalizeOptions(options);
  }

  public async start(): Promise<void> {
    if (this.stopPromise) {
      await this.stopPromise;
    }
    if (this.started) {
      return;
    }
    if (this.startPromise) {
      return await this.startPromise;
    }

    const startPromise = this.startInternal();
    this.startPromise = startPromise;
    try {
      await startPromise;
    } finally {
      if (this.startPromise === startPromise) {
        this.startPromise = null;
      }
    }
  }

  private async startInternal(): Promise<void> {
    this.stopping = false;
    try {
      if (!this.dataSource.isInitialized) {
        await this.dataSource.initialize();
      }
      await this.updateRuntime("starting", {
        startedAt: new Date(),
      });
      this.timer = setInterval(() => {
        void this.processOnce();
      }, this.options.pollIntervalMs);
      await this.processOnce();
      if (this.stopping) {
        return;
      }
      this.started = true;
      console.log(
        `[events-processor] started (name=${this.options.processorName}, pollInterval=${this.options.pollIntervalMs}ms, batchSize=${this.options.batchSize})`,
      );
    } catch (error) {
      this.started = false;
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      if (this.dataSource.isInitialized) {
        await this.dataSource.destroy();
      }
      this.processingPrepared = false;
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (this.stopPromise) {
      return await this.stopPromise;
    }

    const stopPromise = this.stopInternal();
    this.stopPromise = stopPromise;
    try {
      await stopPromise;
    } finally {
      if (this.stopPromise === stopPromise) {
        this.stopPromise = null;
      }
    }
  }

  private async stopInternal(): Promise<void> {
    this.stopping = true;
    this.cancelRetryWait?.();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const startPromise = this.startPromise;
    if (startPromise) {
      await startPromise.catch(() => undefined);
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const activeProcessing = this.activeProcessing;
    if (activeProcessing) {
      await activeProcessing;
    }
    const heartbeatRefresh = this.heartbeatRefresh;
    if (heartbeatRefresh) {
      await heartbeatRefresh;
    }

    if (this.dataSource.isInitialized) {
      try {
        await this.updateRuntime("stopped");
      } finally {
        try {
          await this.dataSource.destroy();
        } finally {
          this.started = false;
          this.processingPrepared = false;
        }
      }
    }
    this.started = false;
  }

  public async processOnce(): Promise<number> {
    if (!this.dataSource.isInitialized) {
      console.error(
        `[events-processor] name=${this.options.processorName} data source is not initialized`,
      );
      return 0;
    }
    if (this.stopping) {
      return 0;
    }
    if (this.activeProcessing) {
      await this.refreshActiveHeartbeat();
      return 0;
    }

    const processing = this.runPreparedProcessOnce();
    this.activeProcessing = processing;
    try {
      return await processing;
    } finally {
      if (this.activeProcessing === processing) {
        this.activeProcessing = null;
      }
    }
  }

  private async runPreparedProcessOnce(): Promise<number> {
    await this.ensureProcessingPrepared();
    return await this.runProcessOnce();
  }

  private async ensureProcessingPrepared(): Promise<void> {
    if (this.processingPrepared) {
      return;
    }
    if (this.preparationPromise) {
      return await this.preparationPromise;
    }

    const preparation = this.beforeProcessing
      ? this.dataSource.transaction(async (manager) => {
          await this.beforeProcessing!({
            manager,
            processorName: this.options.processorName,
          });
        })
      : Promise.resolve();
    this.preparationPromise = preparation;
    try {
      await preparation;
      this.processingPrepared = true;
    } finally {
      if (this.preparationPromise === preparation) {
        this.preparationPromise = null;
      }
    }
  }

  public async retryBlockedEvent(): Promise<number> {
    if (this.activeProcessing) {
      throw new Error(
        "Cannot retry a blocked event while processing is active",
      );
    }
    if (this.stopping) {
      throw new Error(
        "Cannot retry a blocked event while the processor is stopping",
      );
    }

    const ownsDataSourceLifecycle = !this.dataSource.isInitialized;
    if (ownsDataSourceLifecycle) {
      await this.dataSource.initialize();
      try {
        await this.updateRuntime("starting", { startedAt: new Date() });
      } catch (error) {
        if (this.dataSource.isInitialized) {
          await this.dataSource.destroy();
        }
        this.processingPrepared = false;
        throw error;
      }
    }

    try {
      return await this.retryBlockedEventInitialized();
    } finally {
      if (ownsDataSourceLifecycle) {
        await this.stop();
      }
    }
  }

  private async retryBlockedEventInitialized(): Promise<number> {
    const failureRepository = this.dataSource.getRepository(
      ProcessorEventFailureEntity,
    );
    const blockedFailure = await failureRepository.findOne({
      where: {
        processorName: this.options.processorName,
        state: "blocked",
      },
      order: {
        lastFailedAt: "ASC",
      },
    });
    if (!blockedFailure) {
      return 0;
    }

    blockedFailure.state = "retrying";
    blockedFailure.attemptCount = 0;
    blockedFailure.retryAfter = null;
    blockedFailure.resolvedAt = null;
    await failureRepository.save(blockedFailure);
    await this.updateRuntime("idle");
    return await this.processOnce();
  }

  private async runProcessOnce(): Promise<number> {
    try {
      const handledEventTypes = this.router.getHandledEventTypes();
      if (!handledEventTypes.length) {
        await this.updateRuntime("idle", { lastSuccessAt: new Date() });
        return 0;
      }

      const blockedFailure = await this.findBlockedFailure();
      if (blockedFailure) {
        await this.trySupersedeBlockedFailure(
          blockedFailure,
          handledEventTypes,
        );
        const remainingBlockedFailure = await this.findBlockedFailure();
        if (remainingBlockedFailure) {
          await this.updateRuntime("blocked", {
            lastErrorAt: remainingBlockedFailure.lastFailedAt,
            lastErrorCode: remainingBlockedFailure.errorCode,
            boundedLastError: remainingBlockedFailure.boundedErrorMessage,
          });
          return 0;
        }
      }

      await this.updateRuntime("running");
      const { fetchedRows, processedRows, blocked } =
        await this.processOnceFromIndexerApi(handledEventTypes);
      if (!blocked && !this.stopping) {
        await this.updateRuntime("idle", { lastSuccessAt: new Date() });
      }
      console.log(
        `[events-processor] name=${this.options.processorName}, fetchedRows=${fetchedRows}, processedRows=${processedRows}`,
      );
      return processedRows;
    } catch (error) {
      const code = infrastructureErrorCode(error);
      await this.recordInfrastructureFailure(code, error);
      console.error(
        `[events-processor] infrastructure failure code=${code}`,
        error,
      );
      return 0;
    }
  }

  private async findBlockedFailure(): Promise<ProcessorEventFailureEntity | null> {
    return await this.dataSource
      .getRepository(ProcessorEventFailureEntity)
      .findOne({
        where: {
          processorName: this.options.processorName,
          state: "blocked",
        },
        order: {
          lastFailedAt: "ASC",
        },
      });
  }

  private async trySupersedeBlockedFailure(
    failure: ProcessorEventFailureEntity,
    handledEventTypes: string[],
  ): Promise<boolean> {
    const offset = await this.dataSource
      .getRepository(ProcessorOffsetEntity)
      .findOneBy({ processorName: this.options.processorName });
    const changeSequenceAfter = offset?.lastSeenChangeSequence ?? "0";
    if (BigInt(changeSequenceAfter) >= BigInt(failure.changeSequence)) {
      return await this.markFailureSuperseded(failure);
    }

    // Use a local cursor for this scan. Only normal event processing can move
    // the committed processor offset.
    let scanCursor = changeSequenceAfter;
    while (true) {
      const page = await this.eventsApiClient.fetchEventsPage({
        handledEventTypes,
        changeSequenceAfter: scanCursor,
        limit: this.options.batchSize,
      });
      if (page.items.some((event) => isImmutableSuccessor(failure, event))) {
        return await this.markFailureSuperseded(failure);
      }

      const nextCursor = page.nextCursor?.changeSequenceAfter;
      if (
        nextCursor === undefined ||
        BigInt(nextCursor) <= BigInt(scanCursor)
      ) {
        return false;
      }
      scanCursor = nextCursor;
    }
  }

  private async markFailureSuperseded(
    failure: ProcessorEventFailureEntity,
  ): Promise<boolean> {
    return await this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1), $2)", [
        this.options.processorName,
        PROCESSOR_ADVISORY_LOCK_NAMESPACE,
      ]);
      const current = await manager
        .getRepository(ProcessorEventFailureEntity)
        .findOneBy({
          processorName: failure.processorName,
          archiveEventId: failure.archiveEventId,
          changeSequence: failure.changeSequence,
        });
      if (!current || current.state !== "blocked") return false;

      current.state = "superseded";
      current.retryAfter = null;
      current.resolvedAt = new Date();
      await manager.getRepository(ProcessorEventFailureEntity).save(current);
      return true;
    });
  }

  private async processOnceFromIndexerApi(
    handledEventTypes: string[],
  ): Promise<{ fetchedRows: number; processedRows: number; blocked: boolean }> {
    const offsets = this.dataSource.getRepository(ProcessorOffsetEntity);
    const offset =
      (await offsets.findOne({
        where: { processorName: this.options.processorName },
      })) ?? null;
    const changeSequenceAfter = offset?.lastSeenChangeSequence ?? "0";
    const page = await this.eventsApiClient.fetchEventsPage({
      handledEventTypes,
      changeSequenceAfter,
      limit: this.options.batchSize,
    });

    let processedRows = 0;
    let blocked = false;
    for (const event of page.items) {
      const result = await this.processEventWithRetries(event);
      if (result === "blocked") {
        blocked = true;
        break;
      }
      if (result === "processed") {
        processedRows += 1;
      }
    }

    return {
      fetchedRows: page.items.length,
      processedRows,
      blocked,
    };
  }

  private async processEventWithRetries(
    event: SequencedArchiveEvent,
  ): Promise<EventProcessingResult> {
    const failureRepository = this.dataSource.getRepository(
      ProcessorEventFailureEntity,
    );
    let failure = await failureRepository.findOneBy({
      processorName: this.options.processorName,
      archiveEventId: event.id,
      changeSequence: event.changeSequence,
    });
    if (failure?.state === "blocked") {
      return "blocked";
    }

    let attemptCount = failure?.state === "retrying" ? failure.attemptCount : 0;
    if (failure?.state === "retrying" && failure.retryAfter) {
      const waitMs = failure.retryAfter.getTime() - Date.now();
      if (waitMs > 0) {
        await this.delay(waitMs);
        if (this.stopping) {
          return "blocked";
        }
      }
    }

    while (attemptCount < this.options.maxAttempts) {
      try {
        const result = await this.dataSource.transaction(async (manager) => {
          await manager.query(
            "SELECT pg_advisory_xact_lock(hashtext($1), $2)",
            [this.options.processorName, PROCESSOR_ADVISORY_LOCK_NAMESPACE],
          );

          const committedOffset = await manager
            .getRepository(ProcessorOffsetEntity)
            .findOneBy({ processorName: this.options.processorName });
          if (
            committedOffset &&
            BigInt(committedOffset.lastSeenChangeSequence) >=
              BigInt(event.changeSequence)
          ) {
            if (failure) {
              await manager.getRepository(ProcessorEventFailureEntity).update(
                {
                  processorName: this.options.processorName,
                  archiveEventId: event.id,
                  changeSequence: event.changeSequence,
                },
                {
                  state: "superseded",
                  retryAfter: null,
                  resolvedAt: new Date(),
                },
              );
            }
            return "skipped" as const;
          }

          const dispatchResult = await this.router.dispatch(event, manager);
          if (!dispatchResult.handled) {
            throw new EventHandlingError(
              `No handler accepted event id=${event.id} eventType=${event.eventType} status=${event.status}`,
            );
          }

          await manager.getRepository(ProcessorOffsetEntity).upsert(
            {
              processorName: this.options.processorName,
              lastSeenUpdatedAt: event.updatedAt,
              lastSeenEventId: event.id,
              lastSeenChangeSequence: event.changeSequence,
            },
            ["processorName"],
          );

          if (failure) {
            failure.state = "resolved";
            failure.retryAfter = null;
            failure.resolvedAt = new Date();
            await manager
              .getRepository(ProcessorEventFailureEntity)
              .save(failure);
          }
          await manager
            .getRepository(ProcessorEventFailureEntity)
            .createQueryBuilder()
            .update(ProcessorEventFailureEntity)
            .set({
              state: "superseded",
              retryAfter: null,
              resolvedAt: new Date(),
            })
            .where("processor_name = :processorName", {
              processorName: this.options.processorName,
            })
            .andWhere("archive_event_id = :archiveEventId", {
              archiveEventId: event.id,
            })
            .andWhere("change_sequence <> :changeSequence", {
              changeSequence: event.changeSequence,
            })
            .andWhere("state = :state", { state: "retrying" })
            .execute();
          return "processed" as const;
        });
        return result;
      } catch (error) {
        attemptCount += 1;
        failure = await this.recordEventFailure(event, error, attemptCount);
        if (failure.state === "blocked") {
          return "blocked";
        }
        if (this.stopping) {
          return "blocked";
        }
        const waitMs = Math.max(
          0,
          (failure.retryAfter?.getTime() ?? Date.now()) - Date.now(),
        );
        await this.delay(waitMs);
        if (this.stopping) {
          return "blocked";
        }
      }
    }

    return "blocked";
  }

  private async recordEventFailure(
    event: SequencedArchiveEvent,
    error: unknown,
    attemptCount: number,
  ): Promise<ProcessorEventFailureEntity> {
    const now = new Date();
    const blocked = attemptCount >= this.options.maxAttempts;
    const delayMs = Math.min(
      this.options.retryBaseDelayMs * 2 ** Math.max(0, attemptCount - 1),
      this.options.retryMaxDelayMs,
    );
    const errorCode = eventFailureCode(error);
    const message = boundedErrorMessage(error);

    return await this.dataSource.transaction(async (manager) => {
      const failures = manager.getRepository(ProcessorEventFailureEntity);
      const existing = await failures.findOneBy({
        processorName: this.options.processorName,
        archiveEventId: event.id,
        changeSequence: event.changeSequence,
      });
      const failure = existing ?? new ProcessorEventFailureEntity();
      failure.processorName = this.options.processorName;
      failure.archiveEventId = event.id;
      failure.changeSequence = event.changeSequence;
      failure.state = blocked ? "blocked" : "retrying";
      failure.attemptCount = attemptCount;
      failure.retryAfter = blocked ? null : new Date(now.getTime() + delayMs);
      failure.errorCode = errorCode;
      failure.boundedErrorMessage = message;
      failure.eventSnapshot = eventSnapshot(event);
      failure.firstFailedAt = existing?.firstFailedAt ?? now;
      failure.lastFailedAt = now;
      failure.resolvedAt = null;
      const savedFailure = await failures.save(failure);
      await this.updateRuntimeWithManager(
        manager,
        blocked ? "blocked" : "running",
        {
          lastErrorAt: now,
          lastErrorCode: errorCode,
          boundedLastError: message,
        },
      );
      return savedFailure;
    });
  }

  private async recordInfrastructureFailure(
    code: string,
    error: unknown,
  ): Promise<void> {
    try {
      if (this.dataSource.isInitialized) {
        await this.updateRuntime("degraded", {
          lastErrorAt: new Date(),
          lastErrorCode: code,
          boundedLastError: boundedErrorMessage(error),
        });
      }
    } catch (runtimeError) {
      console.error(
        "[events-processor] failed to persist infrastructure failure",
        runtimeError,
      );
    }
  }

  private async updateRuntime(
    lifecycleState: ProcessorLifecycleState,
    patch: Partial<ProcessorRuntimeStatusEntity> = {},
  ): Promise<void> {
    await this.updateRuntimeWithManager(
      this.dataSource.manager,
      lifecycleState,
      patch,
    );
  }

  private async refreshActiveHeartbeat(): Promise<void> {
    if (this.heartbeatRefresh) {
      return await this.heartbeatRefresh;
    }

    const heartbeatRefresh = this.dataSource
      .getRepository(ProcessorRuntimeStatusEntity)
      .update(
        { processorName: this.options.processorName },
        { heartbeatAt: new Date() },
      )
      .then(() => undefined)
      .catch((error: unknown) => {
        console.error(
          "[events-processor] failed to refresh active heartbeat",
          error,
        );
      });
    this.heartbeatRefresh = heartbeatRefresh;
    try {
      await heartbeatRefresh;
    } finally {
      if (this.heartbeatRefresh === heartbeatRefresh) {
        this.heartbeatRefresh = null;
      }
    }
  }

  private async updateRuntimeWithManager(
    manager: EntityManager,
    lifecycleState: ProcessorLifecycleState,
    patch: Partial<ProcessorRuntimeStatusEntity> = {},
  ): Promise<void> {
    const repository = manager.getRepository(ProcessorRuntimeStatusEntity);
    const existing = await repository.findOneBy({
      processorName: this.options.processorName,
    });
    const runtime = existing ?? new ProcessorRuntimeStatusEntity();
    runtime.processorName = this.options.processorName;
    runtime.lifecycleState = lifecycleState;
    runtime.startedAt = patch.startedAt ?? existing?.startedAt ?? null;
    runtime.heartbeatAt = new Date();
    runtime.lastSuccessAt =
      patch.lastSuccessAt ?? existing?.lastSuccessAt ?? null;
    runtime.lastErrorAt = patch.lastErrorAt ?? existing?.lastErrorAt ?? null;
    runtime.lastErrorCode =
      patch.lastErrorCode ?? existing?.lastErrorCode ?? null;
    runtime.boundedLastError =
      patch.boundedLastError ?? existing?.boundedLastError ?? null;
    await repository.save(runtime);
  }

  private async delay(delayMs: number): Promise<void> {
    if (delayMs <= 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (this.cancelRetryWait === finish) {
          this.cancelRetryWait = null;
        }
        resolve();
      };
      timer = setTimeout(finish, delayMs);
      this.cancelRetryWait = finish;
    });
  }
}
