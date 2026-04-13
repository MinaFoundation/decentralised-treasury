import type { DataSource } from "typeorm";
import { ProcessorOffsetEntity } from "./entities.js";
import type { EventProcessorHandler } from "./event-handler.js";
import { IndexerEventsApiClient } from "./indexer-events-api-client.js";
import {
  createProcessorDataSource,
  type ProcessorEntitySchema,
} from "./processor-data-source.js";
import { EventProcessorRouter } from "./router.js";

interface EventsProcessorOptions {
  processorName: string;
  pollIntervalMs: number;
  batchSize: number;
}

export interface EventsProcessorSetup {
  handlers: EventProcessorHandler[];
  outputEntitySchemas: ProcessorEntitySchema[];
}

export interface EventsProcessorConfig {
  databaseUrl: string;
  databaseSchema: string;
  processorName: string;
  processorPollIntervalMs: number;
  processorBatchSize: number;
  indexerApiUrl: string;
}

export class EventsProcessor {
  private timer: NodeJS.Timeout | null = null;
  private processInFlight = false;
  private signalHandlersBound = false;
  private readonly handleSigInt = () => {
    void this.handleShutdownSignal("SIGINT");
  };
  private readonly handleSigTerm = () => {
    void this.handleShutdownSignal("SIGTERM");
  };

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
    );
  }

  public constructor(
    private readonly dataSource: DataSource,
    private readonly router: EventProcessorRouter,
    private readonly options: EventsProcessorOptions,
    private readonly eventsApiClient: IndexerEventsApiClient,
  ) {}

  public async start(): Promise<void> {
    if (this.timer) {
      return;
    }

    if (!this.dataSource.isInitialized) {
      await this.dataSource.initialize();
    }
    await this.processOnce();
    this.timer = setInterval(() => {
      void this.processOnce();
    }, this.options.pollIntervalMs);
    this.bindSignalHandlers();
    console.log(
      `[events-processor] started (name=${this.options.processorName}, pollInterval=${this.options.pollIntervalMs}ms, batchSize=${this.options.batchSize})`,
    );
  }

  public async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.unbindSignalHandlers();
    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy();
    }
  }

  public async processOnce(): Promise<number> {
    if (!this.dataSource.isInitialized) {
      console.error(
        `[events-processor] name=${this.options.processorName} data source is not initialized`,
      );
      return 0;
    }
    if (this.processInFlight) {
      return 0;
    }

    this.processInFlight = true;
    try {
      const handledEventTypes = this.router.getHandledEventTypes();
      if (!handledEventTypes.length) {
        return 0;
      }

      const { fetchedRows, processedRows } = await this.processOnceFromIndexerApi(
        handledEventTypes,
      );
      console.log(
        `[events-processor] name=${this.options.processorName}, fetchedRows=${fetchedRows}, processedRows=${processedRows}`,
      );
      return processedRows;
    } catch (error) {
      console.error("[events-processor] processing failed", error);
      return 0;
    } finally {
      this.processInFlight = false;
    }
  }

  private bindSignalHandlers(): void {
    if (this.signalHandlersBound) {
      return;
    }
    process.on("SIGINT", this.handleSigInt);
    process.on("SIGTERM", this.handleSigTerm);
    this.signalHandlersBound = true;
  }

  private unbindSignalHandlers(): void {
    if (!this.signalHandlersBound) {
      return;
    }
    process.off("SIGINT", this.handleSigInt);
    process.off("SIGTERM", this.handleSigTerm);
    this.signalHandlersBound = false;
  }

  private async handleShutdownSignal(signal: string): Promise<void> {
    console.log(
      `[events-processor] name=${this.options.processorName} received ${signal}, shutting down`,
    );
    await this.stop();
  }

  private async processOnceFromIndexerApi(
    handledEventTypes: string[],
  ): Promise<{ fetchedRows: number; processedRows: number }> {
    const offsets = this.dataSource.getRepository(ProcessorOffsetEntity);
    const offset =
      (await offsets.findOne({
        where: { processorName: this.options.processorName },
      })) ?? null;

    const lastSeenUpdatedAt = offset?.lastSeenUpdatedAt ?? new Date(0);
    const lastSeenEventId = offset?.lastSeenEventId ?? "0";
    const events = await this.eventsApiClient.fetchEventsPage({
      handledEventTypes,
      updatedAfter: lastSeenUpdatedAt,
      eventIdAfter: lastSeenEventId,
      limit: this.options.batchSize,
    });
    if (!events.length) {
      return {
        fetchedRows: 0,
        processedRows: 0,
      };
    }

    await this.dataSource.transaction(async (manager) => {
      const transactionalOffsets = manager.getRepository(ProcessorOffsetEntity);

      for (const event of events) {
        const dispatchResult = await this.router.dispatch(event, manager);
        if (!dispatchResult.handled) {
          throw new Error(
            `[events-processor] failed to handle event id=${event.id} eventType=${event.eventType} status=${event.status}`,
          );
        }
      }

      const lastEvent = events[events.length - 1];
      await transactionalOffsets.upsert(
        {
          processorName: this.options.processorName,
          lastSeenUpdatedAt: lastEvent.updatedAt,
          lastSeenEventId: lastEvent.id,
        },
        ["processorName"],
      );
    });

    return {
      fetchedRows: events.length,
      processedRows: events.length,
    };
  }
}
