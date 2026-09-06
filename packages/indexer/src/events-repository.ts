import { createHash } from "node:crypto";
import { DataSource, type EntityManager } from "typeorm";
import type { ArchiveEventData, ArchiveEventOutput } from "./archive/client.js";
import {
  ArchiveEventEntity,
  ArchiveEventRejectionEntity,
  IndexerCursorEntity,
  IndexerRuntimeStatusEntity,
  MAX_UINT32_NUMBER,
  type IndexerRuntimeState,
} from "./entities.js";

type StoredEventStatus = "pending" | "canonical" | "orphaned";

interface ArchiveEventInsertInput {
  status: StoredEventStatus;
  pendingSeenAtHeight: number | null;
  blockHeight: number;
  blockTimestamp: Date | null;
  globalSlotSinceGenesis: number | null;
  stateHash: string | null;
  parentHash: string | null;
  chainStatus: string | null;
  eventType: string;
  txHash: string;
  accountUpdateId: string;
  accountUpdateIndex: number;
  eventIndex: number;
  blockEventIndex: number;
  rawEventData: ArchiveEventData;
}

interface ArchiveEventRejectionInsertInput {
  archiveStatus: StoredEventStatus;
  blockHeight: number | null;
  blockEventIndex: number | null;
  reasonCode: string;
  reason: string;
  observationHash: string;
  rawObservation: unknown;
}

interface NormalizedBatch {
  accepted: ArchiveEventInsertInput[];
  rejected: ArchiveEventRejectionInsertInput[];
}

type PreparedBatch = NormalizedBatch;

export interface IngestBatchResult {
  acceptedRows: number;
  rejectedRows: number;
}

export interface CompleteArchiveRange {
  from: number;
  to: number;
}

export interface IndexerOperationalStatus {
  totalRejectionCount: number;
  unresolvedRejectionCount: number;
  runtimeOperations: Array<{
    operationName: string;
    state: IndexerRuntimeState;
    updatedAt: Date;
    lastStartedAt: Date | null;
    lastSucceededAt: Date | null;
    lastFailedAt: Date | null;
    lastError: string | null;
  }>;
  failedRuntimeOperationCount: number;
  failedRuntimeOperations: Array<{
    operationName: string;
    lastFailedAt: Date | null;
    lastError: string | null;
  }>;
}

export interface EventsRepositoryOptions {
  knownEventTypes?: string[];
}

export interface EventsPageQuery {
  eventTypes: string[];
  includeUnknown: boolean;
  /** Preferred monotonic cursor. */
  changeSequenceAfter?: string;
  /** @deprecated Use changeSequenceAfter. */
  updatedAfter?: Date;
  /** @deprecated Use changeSequenceAfter. */
  eventIdAfter?: string;
  limit: number;
}

const STORED_EVENT_STATUSES = new Set<StoredEventStatus>([
  "pending",
  "canonical",
  "orphaned",
]);
const NONNEGATIVE_DECIMAL = /^(0|[1-9][0-9]*)$/;
const UNKNOWN_EVENT_TYPE = "unknown";
const INDEXER_INGEST_ADVISORY_LOCK_NAMESPACE = 1_788_447_600;
const INDEXER_INGEST_ADVISORY_LOCK_KEY = 2;
const IMMUTABLE_LOOKUP_CHUNK_SIZE = 1_000;

function assertSqlIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${label} must be a valid SQL identifier`);
  }
}

function asStoredStatus(value: string): StoredEventStatus {
  if (!STORED_EVENT_STATUSES.has(value as StoredEventStatus)) {
    throw new Error(
      `status must be one of: ${Array.from(STORED_EVENT_STATUSES).join(", ")}`,
    );
  }
  return value as StoredEventStatus;
}

function assertNonnegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`);
  }
}

function assertBigintString(value: string, label: string): void {
  if (!NONNEGATIVE_DECIMAL.test(value)) {
    throw new Error(`${label} must be a nonnegative decimal bigint string`);
  }
}

function toJsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as unknown;
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

export class EventsRepository {
  private readonly knownEventTypes: string[];

  public constructor(
    private readonly dataSource: DataSource,
    schema: string,
    options: EventsRepositoryOptions = {},
  ) {
    assertSqlIdentifier(schema, "DATABASE_SCHEMA");
    this.knownEventTypes = this.normalizeKnownEventTypes(
      options.knownEventTypes,
    );
  }

  public async initialize(): Promise<void> {
    if (!this.dataSource.isInitialized) await this.dataSource.initialize();
  }

  /** Insert observations without cursor movement, for fixture and replay use. */
  public async insertRawEvents(
    events: ArchiveEventOutput[],
    status: string,
  ): Promise<number> {
    const batch = this.buildBatch(events, asStoredStatus(status));
    return this.dataSource.transaction(async (manager) => {
      await this.lockIngestion(manager);
      const prepared = await this.prepareBatch(manager, batch);
      const acceptedRows = await this.upsertAccepted(
        manager,
        prepared.accepted,
      );
      await this.upsertRejections(manager, prepared.rejected);
      return acceptedRows;
    });
  }

  /** Persist accepted rows, rejected observations, and the range cursor once. */
  public async ingestRawEventsAndAdvanceCursor(
    events: ArchiveEventOutput[],
    status: string,
    cursorName: string,
    blockHeight: number,
    completeRange?: CompleteArchiveRange,
  ): Promise<IngestBatchResult> {
    const storedStatus = asStoredStatus(status);
    this.assertCursorName(cursorName);
    assertNonnegativeSafeInteger(blockHeight, "blockHeight");
    if (completeRange) {
      assertNonnegativeSafeInteger(completeRange.from, "completeRange.from");
      assertNonnegativeSafeInteger(completeRange.to, "completeRange.to");
      if (completeRange.to < completeRange.from) {
        throw new Error(
          "completeRange.to must be greater than or equal to completeRange.from",
        );
      }
      if (blockHeight !== completeRange.to) {
        throw new Error("blockHeight must equal completeRange.to");
      }
    }
    const normalizedBatch = this.buildBatch(events, storedStatus);
    const batch = completeRange
      ? this.enforceCompleteRange(normalizedBatch, storedStatus, completeRange)
      : normalizedBatch;

    return this.dataSource.transaction(async (manager) => {
      await this.lockIngestion(manager);
      const prepared = await this.prepareBatch(manager, batch);
      if (
        storedStatus === "pending" &&
        completeRange &&
        prepared.rejected.length === 0
      ) {
        await this.retireAbsentPendingEvents(
          manager,
          completeRange,
          prepared.accepted,
        );
      }
      const acceptedRows = await this.upsertAccepted(
        manager,
        prepared.accepted,
      );
      const rejectedRows = await this.upsertRejections(
        manager,
        prepared.rejected,
      );
      await this.advanceCursor(manager, cursorName, blockHeight);
      return { acceptedRows, rejectedRows };
    });
  }

  public async getEventsPage(
    query: EventsPageQuery,
  ): Promise<ArchiveEventEntity[]> {
    this.validatePageQuery(query);
    const normalizedEventTypes = this.normalizeRequestedEventTypes(
      query.eventTypes,
    );
    if (!normalizedEventTypes.length && !query.includeUnknown) return [];

    const eventsQuery = this.dataSource
      .getRepository(ArchiveEventEntity)
      .createQueryBuilder("event");
    if (query.changeSequenceAfter !== undefined) {
      eventsQuery.where("event.change_sequence > :changeSequenceAfter", {
        changeSequenceAfter: query.changeSequenceAfter,
      });
    } else {
      eventsQuery.where(
        "(event.updated_at > :updatedAfter OR (event.updated_at = :updatedAfter AND event.id > :eventIdAfter))",
        {
          updatedAfter: query.updatedAfter ?? new Date(0),
          eventIdAfter: query.eventIdAfter ?? "0",
        },
      );
    }

    if (normalizedEventTypes.length && query.includeUnknown) {
      eventsQuery.andWhere(
        "(event.event_type IN (:...eventTypes) OR event.event_type = :unknownEventType)",
        {
          eventTypes: normalizedEventTypes,
          unknownEventType: UNKNOWN_EVENT_TYPE,
        },
      );
    } else if (normalizedEventTypes.length) {
      eventsQuery.andWhere("event.event_type IN (:...eventTypes)", {
        eventTypes: normalizedEventTypes,
      });
    } else {
      eventsQuery.andWhere("event.event_type = :unknownEventType", {
        unknownEventType: UNKNOWN_EVENT_TYPE,
      });
    }

    if (query.changeSequenceAfter !== undefined) {
      eventsQuery.orderBy("event.change_sequence", "ASC");
    } else {
      eventsQuery
        .orderBy("event.updated_at", "ASC")
        .addOrderBy("event.id", "ASC");
    }
    return eventsQuery.limit(query.limit).getMany();
  }

  public async markPendingAsOrphaned(
    canonicalCursor: number,
    orphanDepthBlocks: number,
  ): Promise<number> {
    assertNonnegativeSafeInteger(canonicalCursor, "canonicalCursor");
    assertNonnegativeSafeInteger(orphanDepthBlocks, "orphanDepthBlocks");
    const orphanCutoffHeight = canonicalCursor - orphanDepthBlocks;
    if (orphanCutoffHeight < 0) return 0;

    return this.dataSource.transaction(async (manager) => {
      await this.lockIngestion(manager);
      // The database trigger assigns change_sequence for each semantic update.
      const result = await manager
        .createQueryBuilder()
        .update(ArchiveEventEntity)
        .set({ status: "orphaned", updatedAt: () => "NOW()" } as never)
        .where("status = :pendingStatus", { pendingStatus: "pending" })
        .andWhere("pending_seen_at_height IS NOT NULL")
        .andWhere("pending_seen_at_height <= :orphanCutoffHeight", {
          orphanCutoffHeight,
        })
        .execute();
      return result.affected ?? 0;
    });
  }

  public async getCursor(cursorName: string): Promise<number | null> {
    this.assertCursorName(cursorName);
    const cursor = await this.dataSource
      .getRepository(IndexerCursorEntity)
      .findOne({ where: { cursorName } });
    return cursor?.lastProcessedBlockHeight ?? null;
  }

  public async setCursor(
    cursorName: string,
    blockHeight: number,
  ): Promise<void> {
    this.assertCursorName(cursorName);
    assertNonnegativeSafeInteger(blockHeight, "blockHeight");
    await this.dataSource.transaction(async (manager) => {
      await this.lockIngestion(manager);
      await this.advanceCursor(manager, cursorName, blockHeight);
    });
  }

  public async recordRuntimeStarted(operationName: string): Promise<void> {
    this.assertOperationName(operationName);
    await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(IndexerRuntimeStatusEntity)
      .values({
        operationName,
        state: "running",
        lastStartedAt: new Date(),
        lastSucceededAt: null,
        lastFailedAt: null,
        lastError: null,
      })
      .onConflict(
        `
        ("operation_name") DO UPDATE SET
          "state" = 'running',
          "last_started_at" = EXCLUDED."last_started_at",
          "updated_at" = NOW()
      `,
      )
      .execute();
  }

  public async recordRuntimeSucceeded(operationName: string): Promise<void> {
    this.assertOperationName(operationName);
    await this.dataSource
      .createQueryBuilder()
      .update(IndexerRuntimeStatusEntity)
      .set({ state: "succeeded", lastSucceededAt: new Date(), lastError: null })
      .where("operation_name = :operationName", { operationName })
      .execute();
  }

  public async recordRuntimeHeartbeat(operationName: string): Promise<void> {
    this.assertOperationName(operationName);
    await this.dataSource
      .createQueryBuilder()
      .update(IndexerRuntimeStatusEntity)
      .set({ state: "running" })
      .where("operation_name = :operationName", { operationName })
      .execute();
  }

  public async recordRuntimeFailed(
    operationName: string,
    error: unknown,
  ): Promise<void> {
    this.assertOperationName(operationName);
    const message = error instanceof Error ? error.message : String(error);
    await this.dataSource
      .createQueryBuilder()
      .update(IndexerRuntimeStatusEntity)
      .set({
        state: "failed",
        lastFailedAt: new Date(),
        lastError: message.slice(0, 4_000),
      })
      .where("operation_name = :operationName", { operationName })
      .execute();
  }

  public async getOperationalStatus(): Promise<IndexerOperationalStatus> {
    const [totalRejectionCount, unresolvedRejectionCount, runtimeRows] =
      await Promise.all([
        this.dataSource.getRepository(ArchiveEventRejectionEntity).count(),
        this.dataSource.getRepository(ArchiveEventRejectionEntity).count({
          where: { resolutionStatus: "unresolved" },
        }),
        this.dataSource.getRepository(IndexerRuntimeStatusEntity).find({
          order: { operationName: "ASC" },
        }),
      ]);
    const failedRuntimeRows = runtimeRows.filter(
      (row) =>
        row.state === "failed" || (row.state === "running" && row.lastError),
    );
    return {
      totalRejectionCount,
      unresolvedRejectionCount,
      runtimeOperations: runtimeRows.map((row) => ({
        operationName: row.operationName,
        state: row.state,
        updatedAt: row.updatedAt,
        lastStartedAt: row.lastStartedAt,
        lastSucceededAt: row.lastSucceededAt,
        lastFailedAt: row.lastFailedAt,
        lastError: row.lastError,
      })),
      failedRuntimeOperationCount: failedRuntimeRows.length,
      failedRuntimeOperations: failedRuntimeRows.map((row) => ({
        operationName: row.operationName,
        lastFailedAt: row.lastFailedAt,
        lastError: row.lastError,
      })),
    };
  }

  public async resolveRejection(rejectionId: string): Promise<boolean> {
    if (typeof rejectionId !== "string" || !/^[1-9][0-9]*$/.test(rejectionId)) {
      throw new Error("rejectionId must be a positive decimal bigint string");
    }
    const result = await this.dataSource
      .createQueryBuilder()
      .update(ArchiveEventRejectionEntity)
      .set({ resolutionStatus: "resolved", resolvedAt: new Date() })
      .where("id = :rejectionId", { rejectionId })
      .andWhere("resolution_status = :resolutionStatus", {
        resolutionStatus: "unresolved",
      })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  public async close(): Promise<void> {
    if (this.dataSource.isInitialized) await this.dataSource.destroy();
  }

  private async lockIngestion(manager: EntityManager): Promise<void> {
    await manager.query("SELECT pg_advisory_xact_lock($1, $2)", [
      INDEXER_INGEST_ADVISORY_LOCK_NAMESPACE,
      INDEXER_INGEST_ADVISORY_LOCK_KEY,
    ]);
  }

  private async advanceCursor(
    manager: EntityManager,
    cursorName: string,
    blockHeight: number,
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(IndexerCursorEntity)
      .values({ cursorName, lastProcessedBlockHeight: blockHeight })
      .onConflict(
        `
        ("cursor_name") DO UPDATE SET
          "last_processed_block_height" = GREATEST(
            "indexer_cursors"."last_processed_block_height",
            EXCLUDED."last_processed_block_height"
          ),
          "updated_at" = CASE
            WHEN EXCLUDED."last_processed_block_height" > "indexer_cursors"."last_processed_block_height"
              THEN NOW()
            ELSE "indexer_cursors"."updated_at"
          END
      `,
      )
      .execute();
  }

  private async retireAbsentPendingEvents(
    manager: EntityManager,
    completeRange: CompleteArchiveRange,
    observedRows: ArchiveEventInsertInput[],
  ): Promise<void> {
    const pendingRows = await manager
      .getRepository(ArchiveEventEntity)
      .createQueryBuilder("event")
      .where("event.status = :status", { status: "pending" })
      .andWhere("event.block_height BETWEEN :from AND :to", completeRange)
      .getMany();
    const observedIdentities = new Set(
      observedRows.map((row) => this.eventIdentity(row)),
    );
    const absentIds = pendingRows
      .filter((row) => !observedIdentities.has(this.eventIdentity(row)))
      .map((row) => row.id);
    if (!absentIds.length) return;

    await manager
      .getRepository(ArchiveEventEntity)
      .createQueryBuilder()
      .update(ArchiveEventEntity)
      .set({ status: "orphaned", updatedAt: () => "NOW()" } as never)
      .where("id IN (:...absentIds)", { absentIds })
      .andWhere("status = :status", { status: "pending" })
      .execute();
  }

  private eventIdentity(
    row: Pick<
      ArchiveEventInsertInput,
      "txHash" | "accountUpdateId" | "accountUpdateIndex" | "eventIndex"
    >,
  ): string {
    return stableJson([
      row.txHash,
      row.accountUpdateId,
      row.accountUpdateIndex,
      row.eventIndex,
    ]);
  }

  private immutableEventMatches(
    existing: ArchiveEventEntity | ArchiveEventInsertInput,
    incoming: ArchiveEventInsertInput,
  ): boolean {
    return (
      this.eventIdentity(existing) === this.eventIdentity(incoming) &&
      existing.eventType === incoming.eventType &&
      stableJson(existing.rawEventData.data) ===
        stableJson(incoming.rawEventData.data)
    );
  }

  private immutableConflictRejection(
    incoming: ArchiveEventInsertInput,
    existing: ArchiveEventEntity | ArchiveEventInsertInput,
    reasonCode: "DUPLICATE_EVENT_IDENTITY" | "IMMUTABLE_EVENT_CONFLICT",
  ): ArchiveEventRejectionInsertInput {
    return this.buildRejection(
      incoming.status,
      incoming.blockHeight,
      incoming.blockEventIndex,
      reasonCode,
      reasonCode === "DUPLICATE_EVENT_IDENTITY"
        ? "The Archive response contains the same event identity more than once"
        : "An existing transaction event identity has a different immutable event type or contract data",
      {
        identity: {
          txHash: incoming.txHash,
          accountUpdateId: incoming.accountUpdateId,
          accountUpdateIndex: incoming.accountUpdateIndex,
          eventIndex: incoming.eventIndex,
        },
        existing: {
          eventType: existing.eventType,
          rawEventData: existing.rawEventData,
        },
        incoming: {
          eventType: incoming.eventType,
          rawEventData: incoming.rawEventData,
          blockHeight: incoming.blockHeight,
          blockEventIndex: incoming.blockEventIndex,
          stateHash: incoming.stateHash,
        },
      },
    );
  }

  private async prepareBatch(
    manager: EntityManager,
    batch: NormalizedBatch,
  ): Promise<PreparedBatch> {
    const rejected = [...batch.rejected];
    const uniqueRows = new Map<string, ArchiveEventInsertInput>();
    for (const row of batch.accepted) {
      const identity = this.eventIdentity(row);
      const prior = uniqueRows.get(identity);
      if (!prior) {
        uniqueRows.set(identity, row);
        continue;
      }
      rejected.push(
        this.immutableConflictRejection(
          row,
          prior,
          this.immutableEventMatches(prior, row)
            ? "DUPLICATE_EVENT_IDENTITY"
            : "IMMUTABLE_EVENT_CONFLICT",
        ),
      );
    }

    const candidates = Array.from(uniqueRows.values());
    if (!candidates.length) {
      return { accepted: [], rejected };
    }

    const txHashes = Array.from(new Set(candidates.map((row) => row.txHash)));
    const existingRows: ArchiveEventEntity[] = [];
    for (
      let offset = 0;
      offset < txHashes.length;
      offset += IMMUTABLE_LOOKUP_CHUNK_SIZE
    ) {
      existingRows.push(
        ...(await manager
          .getRepository(ArchiveEventEntity)
          .createQueryBuilder("event")
          .where("event.tx_hash IN (:...txHashes)", {
            txHashes: txHashes.slice(
              offset,
              offset + IMMUTABLE_LOOKUP_CHUNK_SIZE,
            ),
          })
          .getMany()),
      );
    }
    const existingByIdentity = new Map(
      existingRows.map((row) => [this.eventIdentity(row), row]),
    );
    const accepted: ArchiveEventInsertInput[] = [];
    for (const candidate of candidates) {
      const existing = existingByIdentity.get(this.eventIdentity(candidate));
      if (!existing || this.immutableEventMatches(existing, candidate)) {
        accepted.push(candidate);
        continue;
      }
      rejected.push(
        this.immutableConflictRejection(
          candidate,
          existing,
          "IMMUTABLE_EVENT_CONFLICT",
        ),
      );
    }
    return { accepted, rejected };
  }

  private enforceCompleteRange(
    batch: NormalizedBatch,
    status: StoredEventStatus,
    completeRange: CompleteArchiveRange,
  ): NormalizedBatch {
    const accepted: ArchiveEventInsertInput[] = [];
    const rejected = [...batch.rejected];
    for (const row of batch.accepted) {
      if (
        row.blockHeight >= completeRange.from &&
        row.blockHeight <= completeRange.to
      ) {
        accepted.push(row);
        continue;
      }
      rejected.push(
        this.buildRejection(
          status,
          row.blockHeight,
          row.blockEventIndex,
          "EVENT_OUTSIDE_COMPLETE_RANGE",
          "Archive returned an event outside the requested complete range",
          {
            completeRange,
            event: row.rawEventData,
            blockIdentity: {
              blockHeight: row.blockHeight,
              globalSlotSinceGenesis: row.globalSlotSinceGenesis,
              stateHash: row.stateHash,
              parentHash: row.parentHash,
              chainStatus: row.chainStatus,
            },
          },
        ),
      );
    }
    return { accepted, rejected };
  }

  private async upsertAccepted(
    manager: EntityManager,
    rows: ArchiveEventInsertInput[],
  ): Promise<number> {
    if (!rows.length) return 0;
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(ArchiveEventEntity)
      .values(rows)
      .onConflict(
        `
        ("tx_hash","account_update_id","account_update_index","event_index")
        DO UPDATE SET
          "updated_at" = CASE
            WHEN "archive_events"."status" = 'canonical' AND EXCLUDED."status" <> 'canonical'
              THEN "archive_events"."updated_at"
            WHEN "archive_events"."status" <> EXCLUDED."status"
              OR COALESCE("archive_events"."pending_seen_at_height", -1) <> COALESCE((
                CASE
                  WHEN EXCLUDED."status" = 'pending' AND "archive_events"."status" = 'orphaned'
                    THEN EXCLUDED."pending_seen_at_height"
                  WHEN EXCLUDED."status" = 'pending'
                    THEN COALESCE("archive_events"."pending_seen_at_height", EXCLUDED."pending_seen_at_height")
                  ELSE "archive_events"."pending_seen_at_height"
                END
              ), -1)
              OR COALESCE("archive_events"."block_height", -1) <> COALESCE(EXCLUDED."block_height", -1)
              OR (
                ("archive_events"."block_timestamp" IS NULL AND EXCLUDED."block_timestamp" IS NOT NULL)
                OR ("archive_events"."block_timestamp" IS NOT NULL AND EXCLUDED."block_timestamp" IS NULL)
                OR "archive_events"."block_timestamp" <> EXCLUDED."block_timestamp"
              )
              OR COALESCE("archive_events"."global_slot_since_genesis", -1) <> COALESCE(EXCLUDED."global_slot_since_genesis", -1)
              OR COALESCE("archive_events"."state_hash", '') <> COALESCE(EXCLUDED."state_hash", '')
              OR COALESCE("archive_events"."parent_hash", '') <> COALESCE(EXCLUDED."parent_hash", '')
              OR COALESCE("archive_events"."chain_status", '') <> COALESCE(EXCLUDED."chain_status", '')
              OR COALESCE("archive_events"."block_event_index", -1) <> COALESCE(EXCLUDED."block_event_index", -1)
              OR "archive_events"."raw_event_data" <> EXCLUDED."raw_event_data"
              THEN NOW()
            ELSE "archive_events"."updated_at"
          END,
          "status" = CASE
            WHEN "archive_events"."status" = 'canonical' THEN 'canonical'
            WHEN EXCLUDED."status" = 'canonical' THEN 'canonical'
            ELSE EXCLUDED."status"
          END,
          "pending_seen_at_height" = CASE
            WHEN "archive_events"."status" = 'canonical' AND EXCLUDED."status" <> 'canonical'
              THEN "archive_events"."pending_seen_at_height"
            WHEN EXCLUDED."status" = 'pending' AND "archive_events"."status" = 'orphaned'
              THEN EXCLUDED."pending_seen_at_height"
            WHEN EXCLUDED."status" = 'pending'
              THEN COALESCE("archive_events"."pending_seen_at_height", EXCLUDED."pending_seen_at_height")
            ELSE "archive_events"."pending_seen_at_height"
          END,
          "block_height" = CASE
            WHEN "archive_events"."status" = 'canonical' AND EXCLUDED."status" <> 'canonical'
              THEN "archive_events"."block_height"
            ELSE EXCLUDED."block_height"
          END,
          "block_timestamp" = CASE
            WHEN "archive_events"."status" = 'canonical' AND EXCLUDED."status" <> 'canonical'
              THEN "archive_events"."block_timestamp"
            ELSE EXCLUDED."block_timestamp"
          END,
          "global_slot_since_genesis" = CASE
            WHEN "archive_events"."status" = 'canonical' AND EXCLUDED."status" <> 'canonical'
              THEN "archive_events"."global_slot_since_genesis"
            ELSE EXCLUDED."global_slot_since_genesis"
          END,
          "state_hash" = CASE
            WHEN "archive_events"."status" = 'canonical' AND EXCLUDED."status" <> 'canonical'
              THEN "archive_events"."state_hash"
            ELSE EXCLUDED."state_hash"
          END,
          "parent_hash" = CASE
            WHEN "archive_events"."status" = 'canonical' AND EXCLUDED."status" <> 'canonical'
              THEN "archive_events"."parent_hash"
            ELSE EXCLUDED."parent_hash"
          END,
          "chain_status" = CASE
            WHEN "archive_events"."status" = 'canonical' AND EXCLUDED."status" <> 'canonical'
              THEN "archive_events"."chain_status"
            ELSE EXCLUDED."chain_status"
          END,
          "block_event_index" = CASE
            WHEN "archive_events"."status" = 'canonical' AND EXCLUDED."status" <> 'canonical'
              THEN "archive_events"."block_event_index"
            ELSE EXCLUDED."block_event_index"
          END,
          "raw_event_data" = CASE
            WHEN "archive_events"."status" = 'canonical' AND EXCLUDED."status" <> 'canonical'
              THEN "archive_events"."raw_event_data"
            ELSE EXCLUDED."raw_event_data"
          END
        WHERE "archive_events"."event_type" = EXCLUDED."event_type"
          AND "archive_events"."raw_event_data" -> 'data' = EXCLUDED."raw_event_data" -> 'data'
      `,
      )
      .returning(["id", "change_sequence"])
      .execute();
    return Array.isArray(result.raw)
      ? result.raw.length
      : result.identifiers.length;
  }

  private async upsertRejections(
    manager: EntityManager,
    rows: ArchiveEventRejectionInsertInput[],
  ): Promise<number> {
    if (!rows.length) return 0;
    const result = await manager
      .createQueryBuilder()
      .insert()
      .into(ArchiveEventRejectionEntity)
      .values(rows)
      .onConflict(
        `
        ("archive_status","observation_hash") DO UPDATE SET
          "reason_code" = EXCLUDED."reason_code",
          "reason" = EXCLUDED."reason",
          "raw_observation" = EXCLUDED."raw_observation",
          "block_height" = EXCLUDED."block_height",
          "block_event_index" = EXCLUDED."block_event_index",
          "resolution_status" = 'unresolved',
          "resolved_at" = NULL,
          "occurrence_count" = CAST("archive_event_rejections"."occurrence_count" AS integer) + CAST(1 AS integer),
          "last_seen_at" = NOW()
      `,
      )
      .returning("id")
      .execute();
    return Array.isArray(result.raw)
      ? result.raw.length
      : result.identifiers.length;
  }

  private buildBatch(
    events: ArchiveEventOutput[],
    status: StoredEventStatus,
  ): NormalizedBatch {
    if (!Array.isArray(events)) throw new Error("events must be an array");
    const accepted: ArchiveEventInsertInput[] = [];
    const rejected: ArchiveEventRejectionInsertInput[] = [];
    const eventIndexByAccountUpdate = new Map<string, number>();
    const blockEventIndexes = new Map<number, number>();

    for (let outputIndex = 0; outputIndex < events.length; outputIndex += 1) {
      const output = events[outputIndex] as unknown;
      const outputRecord = this.asRecord(output);
      const blockInfo = this.asRecord(outputRecord?.blockInfo);
      const height = blockInfo?.height;
      const validHeight =
        typeof height === "number" &&
        Number.isSafeInteger(height) &&
        height >= 0
          ? height
          : null;
      const eventDataList = outputRecord?.eventData;

      if (eventDataList === null || eventDataList === undefined) {
        rejected.push(
          this.buildRejection(
            status,
            validHeight,
            null,
            validHeight === null
              ? "INVALID_BLOCK_HEIGHT"
              : "INVALID_EVENT_LIST",
            validHeight === null
              ? "blockInfo.height must be a nonnegative safe integer"
              : "eventData must be an array",
            { outputIndex, output },
          ),
        );
        continue;
      }
      if (!Array.isArray(eventDataList)) {
        rejected.push(
          this.buildRejection(
            status,
            validHeight,
            null,
            "INVALID_EVENT_LIST",
            "eventData must be an array, null, or absent",
            { outputIndex, output },
          ),
        );
        continue;
      }

      for (
        let sourceEventIndex = 0;
        sourceEventIndex < eventDataList.length;
        sourceEventIndex += 1
      ) {
        const eventData = eventDataList[sourceEventIndex];
        const eventIndex = this.reserveEventIndex(
          eventData,
          eventIndexByAccountUpdate,
        );
        const blockEventIndex =
          validHeight === null
            ? null
            : (blockEventIndexes.get(validHeight) ?? 0);
        if (validHeight !== null) {
          blockEventIndexes.set(validHeight, blockEventIndex! + 1);
        }
        const observation = {
          outputIndex,
          sourceEventIndex,
          eventIndex,
          blockInfo,
          eventData,
        };
        try {
          if (validHeight === null) {
            throw this.observationError(
              "INVALID_BLOCK_HEIGHT",
              "blockInfo.height must be a nonnegative safe integer",
            );
          }
          const blockTimestamp = this.resolveBlockTimestamp(
            blockInfo?.timestamp,
          );
          const globalSlotSinceGenesis = this.resolveOptionalNonnegativeInteger(
            blockInfo?.globalSlotSinceGenesis,
            "blockInfo.globalSlotSinceGenesis",
          );
          const stateHash = this.resolveOptionalNonemptyString(
            blockInfo?.stateHash,
            "blockInfo.stateHash",
          );
          const parentHash = this.resolveOptionalNonemptyString(
            blockInfo?.parentHash,
            "blockInfo.parentHash",
          );
          const chainStatus = this.resolveOptionalNonemptyString(
            blockInfo?.chainStatus,
            "blockInfo.chainStatus",
          );
          const normalizedEventData = this.validateEventData(eventData);
          const txHash = normalizedEventData.transactionInfo!.hash!.trim();
          const accountUpdateId = normalizedEventData.accountUpdateId!.trim();
          const accountUpdateIndex =
            this.getAccountUpdateIndex(normalizedEventData);
          if (eventIndex === null) {
            throw this.observationError(
              "INVALID_EVENT_IDENTITY",
              "The event identity could not reserve its source sibling index",
            );
          }
          const eventType = this.resolveEventType(normalizedEventData);

          accepted.push({
            status,
            pendingSeenAtHeight: status === "pending" ? validHeight : null,
            blockHeight: validHeight,
            blockTimestamp,
            globalSlotSinceGenesis,
            stateHash,
            parentHash,
            chainStatus,
            eventType,
            txHash,
            accountUpdateId,
            accountUpdateIndex,
            eventIndex,
            blockEventIndex: blockEventIndex!,
            // Keep the exact archive payload as source evidence.
            rawEventData: toJsonValue(normalizedEventData) as ArchiveEventData,
          });
        } catch (error) {
          const parsed = this.parseObservationError(error);
          rejected.push(
            this.buildRejection(
              status,
              validHeight,
              blockEventIndex,
              parsed.code,
              parsed.message,
              observation,
            ),
          );
        }
      }
    }
    // Assign source order before immutable-conflict filtering. A conflicting
    // observation stays represented by its prior active row, so its position
    // must remain reserved for the valid siblings in this observation set.
    const inconsistentOrderRows = new Set(
      this.assignBlockEventIndexes(accepted),
    );
    for (const row of inconsistentOrderRows) {
      rejected.push(
        this.buildRejection(
          status,
          row.blockHeight,
          row.blockEventIndex,
          "INCOMPLETE_TRANSACTION_SEQUENCE",
          "A block must provide transactionInfo.sequenceNumber for all events or no events",
          {
            blockHeight: row.blockHeight,
            stateHash: row.stateHash,
            eventData: row.rawEventData,
          },
        ),
      );
    }
    return {
      accepted: accepted.filter((row) => !inconsistentOrderRows.has(row)),
      rejected,
    };
  }

  private validateEventData(value: unknown): ArchiveEventData {
    const eventData = this.asRecord(value);
    if (!eventData) {
      throw this.observationError(
        "INVALID_EVENT",
        "eventData entry must be an object",
      );
    }
    const accountUpdateId = eventData.accountUpdateId;
    if (
      typeof accountUpdateId !== "string" ||
      !NONNEGATIVE_DECIMAL.test(accountUpdateId.trim())
    ) {
      throw this.observationError(
        "INVALID_ACCOUNT_UPDATE_ID",
        "accountUpdateId must be a nonnegative decimal string",
      );
    }
    const transactionInfo = this.asRecord(eventData.transactionInfo);
    if (
      !transactionInfo ||
      typeof transactionInfo.hash !== "string" ||
      !transactionInfo.hash.trim()
    ) {
      throw this.observationError(
        "INVALID_TRANSACTION_HASH",
        "transactionInfo.hash must be a nonempty string",
      );
    }
    if (
      transactionInfo.sequenceNumber !== null &&
      transactionInfo.sequenceNumber !== undefined &&
      (!Number.isSafeInteger(transactionInfo.sequenceNumber) ||
        (transactionInfo.sequenceNumber as number) < 0)
    ) {
      throw this.observationError(
        "INVALID_TRANSACTION_SEQUENCE",
        "transactionInfo.sequenceNumber must be a nonnegative safe integer when present",
      );
    }
    if (
      !Array.isArray(transactionInfo.zkappAccountUpdateIds) ||
      !transactionInfo.zkappAccountUpdateIds.every(
        (id) => typeof id === "number" && Number.isSafeInteger(id) && id >= 0,
      )
    ) {
      throw this.observationError(
        "INVALID_ACCOUNT_UPDATE_IDS",
        "transactionInfo.zkappAccountUpdateIds must contain nonnegative safe integers",
      );
    }
    if (
      !Array.isArray(eventData.data) ||
      !eventData.data.every((field) => typeof field === "string")
    ) {
      throw this.observationError(
        "INVALID_EVENT_DATA",
        "eventData.data must be an array of strings",
      );
    }
    return eventData as unknown as ArchiveEventData;
  }

  private assignBlockEventIndexes(
    rows: ArchiveEventInsertInput[],
  ): ArchiveEventInsertInput[] {
    const rowsByHeight = new Map<number, ArchiveEventInsertInput[]>();
    const inconsistentOrderRows: ArchiveEventInsertInput[] = [];
    for (const row of rows) {
      const blockRows = rowsByHeight.get(row.blockHeight) ?? [];
      blockRows.push(row);
      rowsByHeight.set(row.blockHeight, blockRows);
    }

    for (const blockRows of rowsByHeight.values()) {
      const sequencedRowCount = blockRows.filter((row) =>
        Number.isSafeInteger(row.rawEventData.transactionInfo?.sequenceNumber),
      ).length;
      if (sequencedRowCount > 0 && sequencedRowCount < blockRows.length) {
        inconsistentOrderRows.push(...blockRows);
        continue;
      }
      if (sequencedRowCount === 0) {
        // Legacy Archive servers and fixtures can omit sequenceNumber. Keep
        // their response order for compatibility.
        continue;
      }
      const hasCompleteTransactionOrder = blockRows.every((row) =>
        Number.isSafeInteger(row.rawEventData.transactionInfo?.sequenceNumber),
      );
      if (!hasCompleteTransactionOrder) {
        // The count checks above make this unreachable, but keep the type
        // narrowing explicit next to the comparator.
        continue;
      }

      blockRows.sort((left, right) => {
        const sequenceDifference =
          left.rawEventData.transactionInfo!.sequenceNumber! -
          right.rawEventData.transactionInfo!.sequenceNumber!;
        if (sequenceDifference !== 0) return sequenceDifference;
        if (left.accountUpdateIndex !== right.accountUpdateIndex) {
          return left.accountUpdateIndex - right.accountUpdateIndex;
        }
        if (left.eventIndex !== right.eventIndex) {
          return left.eventIndex - right.eventIndex;
        }
        return left.txHash.localeCompare(right.txHash);
      });
      blockRows.forEach((row, blockEventIndex) => {
        row.blockEventIndex = blockEventIndex;
      });
    }
    return inconsistentOrderRows;
  }

  private reserveEventIndex(
    value: unknown,
    eventIndexByAccountUpdate: Map<string, number>,
  ): number | null {
    const eventData = this.asRecord(value);
    const transactionInfo = this.asRecord(eventData?.transactionInfo);
    const accountUpdateId = eventData?.accountUpdateId;
    const txHash = transactionInfo?.hash;
    if (
      typeof accountUpdateId !== "string" ||
      !NONNEGATIVE_DECIMAL.test(accountUpdateId.trim()) ||
      typeof txHash !== "string" ||
      !txHash.trim()
    ) {
      return null;
    }
    const key = stableJson([txHash.trim(), accountUpdateId.trim()]);
    const eventIndex = eventIndexByAccountUpdate.get(key) ?? 0;
    eventIndexByAccountUpdate.set(key, eventIndex + 1);
    return eventIndex;
  }

  private resolveBlockTimestamp(value: unknown): Date | null {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "string" || value.trim() !== value || !value) {
      throw this.observationError(
        "INVALID_BLOCK_TIMESTAMP",
        "blockInfo.timestamp must be a valid nonempty timestamp string",
      );
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw this.observationError(
        "INVALID_BLOCK_TIMESTAMP",
        "blockInfo.timestamp must be a valid timestamp",
      );
    }
    return parsed;
  }

  private resolveOptionalNonnegativeInteger(
    value: unknown,
    label: string,
  ): number | null {
    if (value === null || value === undefined) return null;
    if (
      !Number.isSafeInteger(value) ||
      (value as number) < 0 ||
      (value as number) > MAX_UINT32_NUMBER
    ) {
      throw this.observationError(
        "INVALID_BLOCK_IDENTITY",
        `${label} must be in the UInt32 range`,
      );
    }
    return value as number;
  }

  private resolveOptionalNonemptyString(
    value: unknown,
    label: string,
  ): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string" || !value || value.trim() !== value) {
      throw this.observationError(
        "INVALID_BLOCK_IDENTITY",
        `${label} must be a nonempty trimmed string`,
      );
    }
    return value;
  }

  private getAccountUpdateIndex(eventData: ArchiveEventData): number {
    const numericId = Number(eventData.accountUpdateId);
    if (!Number.isSafeInteger(numericId)) {
      throw this.observationError(
        "INVALID_ACCOUNT_UPDATE_ID",
        "accountUpdateId is outside the safe integer range",
      );
    }
    const accountUpdateIndex =
      eventData.transactionInfo!.zkappAccountUpdateIds!.indexOf(numericId);
    if (accountUpdateIndex < 0) {
      throw this.observationError(
        "UNRESOLVED_ACCOUNT_UPDATE",
        "accountUpdateId is not present in transactionInfo.zkappAccountUpdateIds",
      );
    }
    return accountUpdateIndex;
  }

  private resolveEventType(eventData: ArchiveEventData): string {
    if (this.knownEventTypes.length === 1) return this.knownEventTypes[0];
    if (this.knownEventTypes.length === 0) {
      throw this.observationError(
        "UNRESOLVED_EVENT_TYPE",
        "No known event types are configured",
      );
    }
    const first = eventData.data![0];
    if (typeof first !== "string" || !NONNEGATIVE_DECIMAL.test(first)) {
      throw this.observationError(
        "INVALID_EVENT_DISCRIMINATOR",
        "The o1js event discriminator must be a nonnegative decimal bigint string",
      );
    }
    const typeIndex = BigInt(first);
    if (typeIndex >= BigInt(this.knownEventTypes.length)) {
      throw this.observationError(
        "UNRESOLVED_EVENT_TYPE",
        `The o1js event discriminator ${first} is outside the configured lexical event type list`,
      );
    }
    return this.knownEventTypes[Number(typeIndex)];
  }

  private buildRejection(
    archiveStatus: StoredEventStatus,
    blockHeight: number | null,
    blockEventIndex: number | null,
    reasonCode: string,
    reason: string,
    observation: unknown,
  ): ArchiveEventRejectionInsertInput {
    const rawObservation = toJsonValue(observation);
    const observationRecord = this.asRecord(rawObservation);
    const hashObservation =
      observationRecord &&
      Object.prototype.hasOwnProperty.call(observationRecord, "eventData")
        ? {
            blockInfo: observationRecord.blockInfo,
            eventData: observationRecord.eventData,
          }
        : (observationRecord?.output ?? rawObservation);
    const observationHash = createHash("sha256")
      .update(stableJson({ blockHeight, blockEventIndex, hashObservation }))
      .digest("hex");
    return {
      archiveStatus,
      blockHeight,
      blockEventIndex,
      reasonCode,
      reason,
      observationHash,
      rawObservation,
    };
  }

  private observationError(code: string, message: string): Error {
    const error = new Error(message) as Error & { code?: string };
    error.code = code;
    return error;
  }

  private parseObservationError(error: unknown): {
    code: string;
    message: string;
  } {
    if (error instanceof Error) {
      return {
        code:
          (error as Error & { code?: string }).code ?? "INVALID_OBSERVATION",
        message: error.message,
      };
    }
    return { code: "INVALID_OBSERVATION", message: String(error) };
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private normalizeKnownEventTypes(eventTypes: string[] | undefined): string[] {
    if (eventTypes === undefined) return [];
    if (!Array.isArray(eventTypes)) {
      throw new Error("knownEventTypes must be an array of nonempty strings");
    }
    const normalized: string[] = [];
    for (const eventType of eventTypes) {
      if (
        typeof eventType !== "string" ||
        eventType.trim() !== eventType ||
        !eventType
      ) {
        throw new Error(
          "knownEventTypes must contain nonempty trimmed strings",
        );
      }
      if (normalized.includes(eventType)) {
        throw new Error(
          `knownEventTypes contains duplicate value: ${eventType}`,
        );
      }
      normalized.push(eventType);
    }
    // This is the exact Array.prototype.sort authority used by o1js.
    return normalized.sort();
  }

  private normalizeRequestedEventTypes(eventTypes: string[]): string[] {
    if (!Array.isArray(eventTypes))
      throw new Error("eventTypes must be an array");
    const normalized = new Set<string>();
    for (const eventType of eventTypes) {
      if (
        typeof eventType !== "string" ||
        eventType.trim() !== eventType ||
        !eventType
      ) {
        throw new Error("eventTypes must contain nonempty trimmed strings");
      }
      normalized.add(eventType);
    }
    return Array.from(normalized);
  }

  private validatePageQuery(query: EventsPageQuery): void {
    if (!Number.isSafeInteger(query.limit) || query.limit <= 0) {
      throw new Error("limit must be a positive safe integer");
    }
    if (typeof query.includeUnknown !== "boolean") {
      throw new Error("includeUnknown must be a boolean");
    }
    const usesChangeSequence = query.changeSequenceAfter !== undefined;
    const usesLegacy =
      query.updatedAfter !== undefined || query.eventIdAfter !== undefined;
    if (usesChangeSequence && usesLegacy) {
      throw new Error(
        "changeSequenceAfter cannot be combined with legacy cursor fields",
      );
    }
    if (usesChangeSequence) {
      if (typeof query.changeSequenceAfter !== "string") {
        throw new Error("changeSequenceAfter must be a string");
      }
      assertBigintString(query.changeSequenceAfter, "changeSequenceAfter");
      return;
    }
    if (
      (query.updatedAfter === undefined) !==
      (query.eventIdAfter === undefined)
    ) {
      throw new Error(
        "updatedAfter and eventIdAfter must be supplied together",
      );
    }
    if (query.updatedAfter !== undefined) {
      if (
        !(query.updatedAfter instanceof Date) ||
        Number.isNaN(query.updatedAfter.getTime())
      ) {
        throw new Error("updatedAfter must be a valid Date");
      }
      if (typeof query.eventIdAfter !== "string") {
        throw new Error("eventIdAfter must be a string");
      }
      assertBigintString(query.eventIdAfter, "eventIdAfter");
    }
  }

  private assertCursorName(cursorName: string): void {
    if (
      typeof cursorName !== "string" ||
      !cursorName.trim() ||
      cursorName.trim() !== cursorName
    ) {
      throw new Error("cursorName must be a nonempty trimmed string");
    }
  }

  private assertOperationName(operationName: string): void {
    if (
      typeof operationName !== "string" ||
      !operationName.trim() ||
      operationName.trim() !== operationName
    ) {
      throw new Error("operationName must be a nonempty trimmed string");
    }
  }
}
