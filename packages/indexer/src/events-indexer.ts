import type {
  ArchiveBlockStatus,
  ArchiveEventOutput,
  ArchiveMaxHeights,
  FetchEventsOptions,
} from "./archive/client.js";
import { ArchiveClient } from "./archive/client.js";
import { createIndexerDataSource } from "./db/indexer-data-source.js";
import { EventsRepository } from "./events-repository.js";

export interface EventsIndexerOptions {
  pollPendingIntervalMs: number;
  pollCanonicalIntervalMs: number;
  blockBatchSize: number;
  startHeight: number;
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
  eventsStartHeight: number;
  pendingOverlapBlocks: number;
  canonicalOverlapBlocks: number;
  orphanDepthBlocks: number;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}

function assertNonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`);
  }
}

export class EventsIndexer {
  public static readonly PENDING_CURSOR = "events:pending";
  public static readonly CANONICAL_CURSOR = "events:canonical";

  private pendingTimer: NodeJS.Timeout | null = null;
  private canonicalTimer: NodeJS.Timeout | null = null;
  private orphanSweepTimer: NodeJS.Timeout | null = null;
  private pendingSyncPromise: Promise<void> | null = null;
  private canonicalSyncPromise: Promise<void> | null = null;
  private orphanSweepPromise: Promise<number> | null = null;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private started = false;
  private stopping = false;
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
      startHeight: config.eventsStartHeight,
      pendingOverlapBlocks: config.pendingOverlapBlocks,
      canonicalOverlapBlocks: config.canonicalOverlapBlocks,
      orphanDepthBlocks: config.orphanDepthBlocks,
    });
  }

  public constructor(
    private readonly archiveClient: ArchiveEventsSource,
    private readonly repository: EventsRepository,
    private readonly options: EventsIndexerOptions,
  ) {
    assertPositiveInteger(
      options.pollPendingIntervalMs,
      "pollPendingIntervalMs",
    );
    assertPositiveInteger(
      options.pollCanonicalIntervalMs,
      "pollCanonicalIntervalMs",
    );
    assertPositiveInteger(options.blockBatchSize, "blockBatchSize");
    assertNonnegativeInteger(options.startHeight, "startHeight");
    assertNonnegativeInteger(
      options.pendingOverlapBlocks,
      "pendingOverlapBlocks",
    );
    assertNonnegativeInteger(
      options.canonicalOverlapBlocks,
      "canonicalOverlapBlocks",
    );
    assertNonnegativeInteger(options.orphanDepthBlocks, "orphanDepthBlocks");
  }

  public async start(): Promise<void> {
    if (this.stopping) throw new Error("EventsIndexer is stopping");
    if (this.started) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.startInternal();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startInternal(): Promise<void> {
    await this.repository.initialize();

    // Install the pollers *before* the initial catch-up, and do not await it.
    //
    // syncStatusOnce drains all the way to the archive head in a single call, so
    // awaiting the canonical pass here left the pending timer uninstalled for as
    // long as that pass took. On a cold start against a long chain that is over
    // an hour, during which nothing new is indexed at all and every downstream
    // consumer - proposal projection, content attachment - simply stalls.
    //
    // Overlap is safe: each sync has its own in-flight guard, so a tick that
    // lands during the catch-up is a no-op, and pending/canonical already ran
    // concurrently in steady state on their two independent intervals.
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
    this.started = true;

    // Kick off an immediate first pass rather than waiting out one interval.
    void this.syncPendingOnce();
    void this.syncCanonicalOnce();
    void this.sweepOrphanedPendingEvents();

    console.log(
      `[events-indexer] started (pendingInterval=${this.options.pollPendingIntervalMs}ms, canonicalInterval=${this.options.pollCanonicalIntervalMs}ms, blockBatchSize=${this.options.blockBatchSize}, pendingOverlap=${this.options.pendingOverlapBlocks}, canonicalOverlap=${this.options.canonicalOverlapBlocks}, orphanDepth=${this.options.orphanDepthBlocks})`,
    );
  }

  public async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.stopInternal();
    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }

  public async syncPendingOnce(): Promise<void> {
    await this.launchPendingSync(false);
  }

  public async syncCanonicalOnce(): Promise<void> {
    await this.launchCanonicalSync(false);
  }

  public async sweepOrphanedPendingEvents(): Promise<number> {
    return this.launchOrphanSweep(false);
  }

  private async stopInternal(): Promise<void> {
    this.stopping = true;
    if (this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        // Failed startup closes its repository before it rejects.
      }
    }

    if (this.pendingTimer) clearInterval(this.pendingTimer);
    if (this.canonicalTimer) clearInterval(this.canonicalTimer);
    if (this.orphanSweepTimer) clearInterval(this.orphanSweepTimer);
    this.pendingTimer = null;
    this.canonicalTimer = null;
    this.orphanSweepTimer = null;
    this.unbindSignalHandlers();

    const inFlight: Promise<unknown>[] = [];
    if (this.pendingSyncPromise) inFlight.push(this.pendingSyncPromise);
    if (this.canonicalSyncPromise) inFlight.push(this.canonicalSyncPromise);
    if (this.orphanSweepPromise) inFlight.push(this.orphanSweepPromise);
    await Promise.allSettled(inFlight);
    try {
      await this.repository.close();
    } finally {
      this.started = false;
      this.stopping = false;
    }
  }

  private launchPendingSync(propagateError: boolean): Promise<void> {
    if (this.pendingSyncPromise) return this.pendingSyncPromise;
    if (this.stopping) return Promise.resolve();
    const operation = this.runOperation(
      EventsIndexer.PENDING_CURSOR,
      () =>
        this.syncStatusOnce({
          archiveStatus: "PENDING",
          storedStatus: "pending",
          cursorName: EventsIndexer.PENDING_CURSOR,
          overlapBlocks: this.options.pendingOverlapBlocks,
        }),
      propagateError,
    );
    this.pendingSyncPromise = operation.finally(() => {
      this.pendingSyncPromise = null;
    });
    return this.pendingSyncPromise;
  }

  private launchCanonicalSync(propagateError: boolean): Promise<void> {
    if (this.canonicalSyncPromise) return this.canonicalSyncPromise;
    if (this.stopping) return Promise.resolve();
    const operation = this.runOperation(
      EventsIndexer.CANONICAL_CURSOR,
      () =>
        this.syncStatusOnce({
          archiveStatus: "CANONICAL",
          storedStatus: "canonical",
          cursorName: EventsIndexer.CANONICAL_CURSOR,
          overlapBlocks: this.options.canonicalOverlapBlocks,
        }),
      propagateError,
    );
    this.canonicalSyncPromise = operation.finally(() => {
      this.canonicalSyncPromise = null;
    });
    return this.canonicalSyncPromise;
  }

  private launchOrphanSweep(propagateError: boolean): Promise<number> {
    if (this.orphanSweepPromise) return this.orphanSweepPromise;
    if (this.stopping) return Promise.resolve(0);
    const operation = this.runOperation(
      "events:orphan-sweep",
      async () => {
        const canonicalCursor = await this.repository.getCursor(
          EventsIndexer.CANONICAL_CURSOR,
        );
        if (canonicalCursor === null) return 0;
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
      },
      propagateError,
      0,
    );
    this.orphanSweepPromise = operation.finally(() => {
      this.orphanSweepPromise = null;
    });
    return this.orphanSweepPromise;
  }

  private async runOperation<T>(
    operationName: string,
    operation: () => Promise<T>,
    propagateError: boolean,
    fallback?: T,
  ): Promise<T> {
    try {
      await this.repository.recordRuntimeStarted(operationName);
      const result = await operation();
      await this.repository.recordRuntimeSucceeded(operationName);
      return result;
    } catch (error) {
      try {
        await this.repository.recordRuntimeFailed(operationName, error);
      } catch (statusError) {
        console.error(
          `[events-indexer] failed to record runtime status for ${operationName}`,
          statusError,
        );
      }
      if (propagateError) throw error;
      console.error(`[events-indexer] ${operationName} failed`, error);
      return fallback as T;
    }
  }

  private async syncStatusOnce(input: {
    archiveStatus: ArchiveBlockStatus;
    storedStatus: "pending" | "canonical";
    cursorName: string;
    overlapBlocks: number;
  }): Promise<void> {
    const maxHeights = await this.archiveClient.getMaxBlockHeights();
    const archiveHead =
      input.archiveStatus === "PENDING"
        ? maxHeights.pendingMaxBlockHeight
        : maxHeights.canonicalMaxBlockHeight;
    assertNonnegativeInteger(
      archiveHead,
      `${input.archiveStatus} archive head`,
    );

    const cursor = await this.repository.getCursor(input.cursorName);
    // Only used on a cold start; once a cursor exists it always wins, so raising
    // this later never skips blocks that were already being tracked.
    let from = this.options.startHeight;
    if (cursor !== null) {
      from =
        input.overlapBlocks > 0
          ? Math.max(0, cursor - input.overlapBlocks + 1)
          : cursor + 1;
    }
    if (from > archiveHead) return;

    while (from <= archiveHead) {
      const to = Math.min(from + this.options.blockBatchSize - 1, archiveHead);
      await this.repository.recordRuntimeHeartbeat(input.cursorName);
      const events = await this.archiveClient.fetchEvents({
        status: input.archiveStatus,
        from,
        to,
      });
      const result = await this.repository.ingestRawEventsAndAdvanceCursor(
        events,
        input.storedStatus,
        input.cursorName,
        to,
        { from, to },
      );
      await this.repository.recordRuntimeHeartbeat(input.cursorName);
      console.log(
        `[events-indexer] status=${input.storedStatus}, range=${from}-${to}, archiveRows=${events.length}, acceptedRows=${result.acceptedRows}, rejectedRows=${result.rejectedRows}`,
      );
      from = to + 1;
    }
  }

  private bindSignalHandlers(): void {
    if (this.signalHandlersBound) return;
    process.on("SIGINT", this.handleSigInt);
    process.on("SIGTERM", this.handleSigTerm);
    this.signalHandlersBound = true;
  }

  private unbindSignalHandlers(): void {
    if (!this.signalHandlersBound) return;
    process.off("SIGINT", this.handleSigInt);
    process.off("SIGTERM", this.handleSigTerm);
    this.signalHandlersBound = false;
  }

  private async handleShutdownSignal(signal: string): Promise<void> {
    console.log(`[events-indexer] received ${signal}, shutting down`);
    await this.stop();
  }
}
