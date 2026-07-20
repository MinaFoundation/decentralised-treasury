import type {
  ArchiveBlockStatus,
  ArchiveEventOutput,
  ArchiveMaxHeights,
  FetchEventsOptions,
} from "./archive/client.js";
import { ArchiveClient } from "./archive/client.js";
import { createIndexerDataSource } from "./db/indexer-data-source.js";
import { EventsRepository } from "./events-repository.js";

interface EventsIndexerOptions {
  pollPendingIntervalMs: number;
  pollCanonicalIntervalMs: number;
  blockBatchSize: number;
  pendingOverlapBlocks: number;
  canonicalOverlapBlocks: number;
  orphanDepthBlocks: number;
}

interface ArchiveEventsSource {
  getMaxBlockHeights(): Promise<ArchiveMaxHeights>;
  fetchEvents(options: FetchEventsOptions): Promise<ArchiveEventOutput[]>;
}

export interface EventsIndexerConfig {
  archiveNodeUrl: string;
  treasuryOwnerContractAddress: string;
  knownEventTypes: string[];
  archiveRequestTimeoutMs: number;
  databaseUrl: string;
  databaseSchema: string;
  pollPendingIntervalMs: number;
  pollCanonicalIntervalMs: number;
  eventsBlockBatchSize: number;
  pendingOverlapBlocks: number;
  canonicalOverlapBlocks: number;
  orphanDepthBlocks: number;
}

export class EventsIndexer {
  public static readonly PENDING_CURSOR = "events:pending";
  public static readonly CANONICAL_CURSOR = "events:canonical";

  private pendingTimer: NodeJS.Timeout | null = null;
  private canonicalTimer: NodeJS.Timeout | null = null;
  private orphanSweepTimer: NodeJS.Timeout | null = null;
  private pendingSyncInFlight = false;
  private canonicalSyncInFlight = false;
  private orphanSweepInFlight = false;
  private signalHandlersBound = false;
  private readonly handleSigInt = () => {
    void this.handleShutdownSignal("SIGINT");
  };
  private readonly handleSigTerm = () => {
    void this.handleShutdownSignal("SIGTERM");
  };

  public static fromConfig(config: EventsIndexerConfig): EventsIndexer {
    const dataSource = createIndexerDataSource(config);
    const archiveClient = new ArchiveClient(config.archiveNodeUrl, config);
    const repository = new EventsRepository(dataSource, config.databaseSchema, {
      knownEventTypes: config.knownEventTypes,
    });
    return new EventsIndexer(archiveClient, repository, {
      pollPendingIntervalMs: config.pollPendingIntervalMs,
      pollCanonicalIntervalMs: config.pollCanonicalIntervalMs,
      blockBatchSize: config.eventsBlockBatchSize,
      pendingOverlapBlocks: config.pendingOverlapBlocks,
      canonicalOverlapBlocks: config.canonicalOverlapBlocks,
      orphanDepthBlocks: config.orphanDepthBlocks,
    });
  }

  public constructor(
    private readonly archiveClient: ArchiveEventsSource,
    private readonly repository: EventsRepository,
    private readonly options: EventsIndexerOptions,
  ) {}

  public async start(): Promise<void> {
    if (this.pendingTimer || this.canonicalTimer || this.orphanSweepTimer) {
      return;
    }

    await this.repository.initialize();
    await this.syncPendingOnce();
    await this.syncCanonicalOnce();
    await this.sweepOrphanedPendingEvents();

    this.pendingTimer = setInterval(() => {
      void this.syncPendingOnce();
    }, this.options.pollPendingIntervalMs);
    this.canonicalTimer = setInterval(() => {
      void this.syncCanonicalOnce();
    }, this.options.pollCanonicalIntervalMs);
    this.orphanSweepTimer = setInterval(() => {
      void this.sweepOrphanedPendingEvents();
    }, this.options.pollCanonicalIntervalMs);
    this.bindSignalHandlers();
    console.log(
      `[events-indexer] started (pendingInterval=${this.options.pollPendingIntervalMs}ms, canonicalInterval=${this.options.pollCanonicalIntervalMs}ms, blockBatchSize=${this.options.blockBatchSize}, pendingOverlap=${this.options.pendingOverlapBlocks}, canonicalOverlap=${this.options.canonicalOverlapBlocks}, orphanDepth=${this.options.orphanDepthBlocks})`,
    );
  }

  public async stop(): Promise<void> {
    if (this.pendingTimer) {
      clearInterval(this.pendingTimer);
      this.pendingTimer = null;
    }
    if (this.canonicalTimer) {
      clearInterval(this.canonicalTimer);
      this.canonicalTimer = null;
    }
    if (this.orphanSweepTimer) {
      clearInterval(this.orphanSweepTimer);
      this.orphanSweepTimer = null;
    }
    this.unbindSignalHandlers();
    await this.repository.close();
  }

  public async syncPendingOnce(): Promise<void> {
    if (this.pendingSyncInFlight) {
      return;
    }

    this.pendingSyncInFlight = true;
    try {
      await this.syncStatusOnce({
        archiveStatus: "PENDING",
        storedStatus: "pending",
        cursorName: EventsIndexer.PENDING_CURSOR,
        overlapBlocks: this.options.pendingOverlapBlocks,
      });
    } catch (error) {
      console.error("[events-indexer] pending sync failed", error);
    } finally {
      this.pendingSyncInFlight = false;
    }
  }

  public async syncCanonicalOnce(): Promise<void> {
    if (this.canonicalSyncInFlight) {
      return;
    }

    this.canonicalSyncInFlight = true;
    try {
      await this.syncStatusOnce({
        archiveStatus: "CANONICAL",
        storedStatus: "canonical",
        cursorName: EventsIndexer.CANONICAL_CURSOR,
        overlapBlocks: this.options.canonicalOverlapBlocks,
      });
    } catch (error) {
      console.error("[events-indexer] canonical sync failed", error);
    } finally {
      this.canonicalSyncInFlight = false;
    }
  }

  public async sweepOrphanedPendingEvents(): Promise<number> {
    if (this.orphanSweepInFlight) {
      return 0;
    }

    this.orphanSweepInFlight = true;
    try {
      const canonicalCursor = await this.repository.getCursor(
        EventsIndexer.CANONICAL_CURSOR,
      );
      if (canonicalCursor === null) {
        return 0;
      }
      const orphanedRows = await this.repository.markPendingAsOrphaned(
        canonicalCursor,
        this.options.orphanDepthBlocks,
      );
      if (orphanedRows > 0) {
        console.log(
          `[events-indexer] orphan sweep: canonicalCursor=${canonicalCursor}, orphanedRows=${orphanedRows}`,
        );
      }
      return orphanedRows;
    } catch (error) {
      console.error("[events-indexer] orphan sweep failed", error);
      return 0;
    } finally {
      this.orphanSweepInFlight = false;
    }
  }

  private async syncStatusOnce(input: {
    archiveStatus: ArchiveBlockStatus;
    storedStatus: string;
    cursorName: string;
    overlapBlocks: number;
  }): Promise<void> {
    const maxHeights = await this.archiveClient.getMaxBlockHeights();
    const archiveHead =
      input.archiveStatus === "PENDING"
        ? maxHeights.pendingMaxBlockHeight
        : maxHeights.canonicalMaxBlockHeight;

    const cursor = await this.repository.getCursor(input.cursorName);
    let from = 0;
    if (cursor !== null) {
      from =
        input.overlapBlocks > 0
          ? Math.max(0, cursor - input.overlapBlocks + 1)
          : cursor + 1;
    }

    if (from > archiveHead) {
      return;
    }

    while (from <= archiveHead) {
      const to = Math.min(from + this.options.blockBatchSize - 1, archiveHead);
      const events = await this.archiveClient.fetchEvents({
        status: input.archiveStatus,
        from,
        to,
      });
      const upsertedRows = await this.repository.insertRawEvents(
        events,
        input.storedStatus,
      );
      await this.repository.setCursor(input.cursorName, to);
      console.log(
        `[events-indexer] status=${input.storedStatus}, range=${from}-${to}, archiveRows=${events.length}, upsertedRows=${upsertedRows}`,
      );
      from = to + 1;
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
    console.log(`[events-indexer] received ${signal}, shutting down`);
    await this.stop();
  }
}
