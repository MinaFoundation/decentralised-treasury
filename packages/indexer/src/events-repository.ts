import { DataSource } from "typeorm";
import type { ArchiveEventData, ArchiveEventOutput } from "./archive/client.js";
import { ArchiveEventEntity, IndexerCursorEntity } from "./entities.js";

interface ArchiveEventInsertInput {
  status: string;
  pendingSeenAtHeight: number | null;
  eventType: string;
  txHash: string;
  accountUpdateId: string;
  accountUpdateIndex: number;
  eventIndex: number;
  rawEventData: ArchiveEventData;
}

const UNKNOWN_EVENT_TYPE = "unknown";

interface EventsRepositoryOptions {
  knownEventTypes?: string[];
}

export interface EventsPageQuery {
  eventTypes: string[];
  includeUnknown: boolean;
  updatedAfter: Date;
  eventIdAfter: string;
  limit: number;
}

function assertSqlIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${label} must be a valid SQL identifier`);
  }
}

export class EventsRepository {
  private readonly knownEventTypes: string[];

  public constructor(
    private readonly dataSource: DataSource,
    schema: string,
    options: EventsRepositoryOptions = {},
  ) {
    assertSqlIdentifier(schema, "DATABASE_SCHEMA");
    this.knownEventTypes = this.normalizeKnownEventTypes(options.knownEventTypes);
  }

  public async initialize(): Promise<void> {
    if (!this.dataSource.isInitialized) {
      await this.dataSource.initialize();
    }
  }

  public async insertRawEvents(
    events: ArchiveEventOutput[],
    status: string,
  ): Promise<number> {
    const rows = this.buildInsertRows(events, status);
    if (!rows.length) {
      return 0;
    }

    const result = await this.dataSource.transaction(async (manager) =>
      manager
        .createQueryBuilder()
        .insert()
        .into(ArchiveEventEntity)
        .values(rows)
        .onConflict(`
          ("tx_hash","account_update_id","account_update_index","event_index")
          DO UPDATE SET
            "updated_at" = CASE
              WHEN "archive_events"."status" <> (
                CASE
                  WHEN "archive_events"."status" = 'canonical' THEN 'canonical'
                  WHEN EXCLUDED."status" = 'canonical' THEN 'canonical'
                  ELSE EXCLUDED."status"
                END
              )
              OR "archive_events"."event_type" <> (
                CASE
                  WHEN EXCLUDED."event_type" = '${UNKNOWN_EVENT_TYPE}'
                    AND "archive_events"."event_type" <> '${UNKNOWN_EVENT_TYPE}'
                    THEN "archive_events"."event_type"
                  ELSE EXCLUDED."event_type"
                END
              )
              OR COALESCE("archive_events"."raw_event_data"::text, '') <> COALESCE(EXCLUDED."raw_event_data"::text, '')
              OR COALESCE(
                "archive_events"."pending_seen_at_height",
                -1
              ) <> COALESCE(
                CASE
                  WHEN EXCLUDED."status" = 'pending'
                    AND "archive_events"."status" = 'orphaned'
                    THEN EXCLUDED."pending_seen_at_height"
                  WHEN EXCLUDED."status" = 'pending'
                    THEN COALESCE(
                      "archive_events"."pending_seen_at_height",
                      EXCLUDED."pending_seen_at_height"
                    )
                  ELSE "archive_events"."pending_seen_at_height"
                END,
                -1
              )
              THEN NOW()
              ELSE "archive_events"."updated_at"
            END,
            "status" = CASE
              WHEN "archive_events"."status" = 'canonical' THEN 'canonical'
              WHEN EXCLUDED."status" = 'canonical' THEN 'canonical'
              ELSE EXCLUDED."status"
            END,
            "event_type" = CASE
              WHEN EXCLUDED."event_type" = '${UNKNOWN_EVENT_TYPE}'
                AND "archive_events"."event_type" <> '${UNKNOWN_EVENT_TYPE}'
                THEN "archive_events"."event_type"
              ELSE EXCLUDED."event_type"
            END,
            "raw_event_data" = EXCLUDED."raw_event_data",
            "pending_seen_at_height" = CASE
              WHEN EXCLUDED."status" = 'pending'
                AND "archive_events"."status" = 'orphaned'
                THEN EXCLUDED."pending_seen_at_height"
              WHEN EXCLUDED."status" = 'pending'
                THEN COALESCE(
                  "archive_events"."pending_seen_at_height",
                  EXCLUDED."pending_seen_at_height"
                )
              ELSE "archive_events"."pending_seen_at_height"
            END
        `)
        .returning("id")
        .execute(),
    );
    if (Array.isArray(result.raw)) {
      return result.raw.length;
    }
    return result.identifiers.length;
  }

  public async getEventsPage(query: EventsPageQuery): Promise<ArchiveEventEntity[]> {
    const normalizedEventTypes = this.normalizeKnownEventTypes(query.eventTypes);
    if (!normalizedEventTypes.length && !query.includeUnknown) {
      return [];
    }

    const eventsQuery = this.dataSource
      .getRepository(ArchiveEventEntity)
      .createQueryBuilder("event")
      .where(
        "(event.updated_at > :updatedAfter OR (event.updated_at = :updatedAfter AND event.id > :eventIdAfter))",
        {
          updatedAfter: query.updatedAfter,
          eventIdAfter: query.eventIdAfter,
        },
      );

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

    return eventsQuery
      .orderBy("event.updated_at", "ASC")
      .addOrderBy("event.id", "ASC")
      .limit(query.limit)
      .getMany();
  }

  public async markPendingAsOrphaned(
    canonicalCursor: number,
    orphanDepthBlocks: number,
  ): Promise<number> {
    const orphanCutoffHeight = canonicalCursor - orphanDepthBlocks;
    if (orphanCutoffHeight < 0) {
      return 0;
    }

    const result = await this.dataSource
      .createQueryBuilder()
      .update(ArchiveEventEntity)
      .set({
        status: "orphaned",
        updatedAt: () => "NOW()",
      } as never)
      .where("status = :pendingStatus", { pendingStatus: "pending" })
      .andWhere("pending_seen_at_height IS NOT NULL")
      .andWhere("pending_seen_at_height <= :orphanCutoffHeight", {
        orphanCutoffHeight,
      })
      .execute();
    return result.affected ?? 0;
  }

  public async getCursor(cursorName: string): Promise<number | null> {
    const cursor = await this.dataSource
      .getRepository(IndexerCursorEntity)
      .findOne({
        where: { cursorName },
      });
    return cursor?.lastProcessedBlockHeight ?? null;
  }

  public async setCursor(cursorName: string, blockHeight: number): Promise<void> {
    await this.dataSource.getRepository(IndexerCursorEntity).upsert(
      {
        cursorName,
        lastProcessedBlockHeight: blockHeight,
      },
      ["cursorName"],
    );
  }

  public async close(): Promise<void> {
    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy();
    }
  }

  private buildInsertRows(
    events: ArchiveEventOutput[],
    status: string,
  ): ArchiveEventInsertInput[] {
    const rows: ArchiveEventInsertInput[] = [];
    const eventIndexByAccountUpdate = new Map<string, number>();

    for (const eventOutput of events) {
      const eventDataList = eventOutput.eventData ?? [];
      for (const eventData of eventDataList) {
        if (!eventData) {
          continue;
        }
        const txHash = eventData.transactionInfo?.hash?.trim();
        const accountUpdateId = eventData.accountUpdateId?.trim();
        if (!txHash || !accountUpdateId) {
          continue;
        }
        const accountUpdateIndex = this.getAccountUpdateIndex(eventData);
        const eventIndexKey = `${txHash}:${accountUpdateId}`;
        const eventIndex = eventIndexByAccountUpdate.get(eventIndexKey) ?? 0;
        eventIndexByAccountUpdate.set(eventIndexKey, eventIndex + 1);

        rows.push({
          status,
          pendingSeenAtHeight:
            status === "pending" ? eventOutput.blockInfo.height : null,
          eventType: this.resolveEventType(eventData),
          txHash,
          accountUpdateId,
          accountUpdateIndex,
          eventIndex,
          rawEventData: eventData,
        });
      }
    }

    return rows;
  }

  private getAccountUpdateIndex(eventData: ArchiveEventData): number {
    const accountUpdateId = eventData.accountUpdateId;
    const zkappAccountUpdateIds = eventData.transactionInfo?.zkappAccountUpdateIds;
    if (!accountUpdateId || !Array.isArray(zkappAccountUpdateIds)) {
      return -1;
    }

    const numericAccountUpdateId = Number.parseInt(accountUpdateId, 10);
    if (!Number.isFinite(numericAccountUpdateId)) {
      return -1;
    }

    return zkappAccountUpdateIds.indexOf(numericAccountUpdateId);
  }

  private resolveEventType(eventData: ArchiveEventData): string {
    const archiveReportedType = this.resolveArchiveReportedEventType(eventData);
    if (archiveReportedType) {
      return archiveReportedType;
    }

    const encodedType = this.resolveEncodedEventType(eventData);
    if (encodedType) {
      return encodedType;
    }
    const txHash = eventData.transactionInfo?.hash ?? "unknown";
    const accountUpdateId = eventData.accountUpdateId ?? "unknown";
    throw new Error(
      `Unable to resolve event type for txHash=${txHash} accountUpdateId=${accountUpdateId}; knownEventTypes=${this.knownEventTypes.join(",") || "<empty>"}`,
    );
  }

  private resolveArchiveReportedEventType(eventData: ArchiveEventData): string | null {
    const genericTypeCandidates: unknown[] = [
      (eventData as { eventType?: unknown }).eventType,
      (eventData as { eventName?: unknown }).eventName,
      (eventData as { name?: unknown }).name,
      (eventData as { type?: unknown }).type,
    ];

    for (const candidate of genericTypeCandidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    return null;
  }

  private resolveEncodedEventType(eventData: ArchiveEventData): string | null {
    if (this.knownEventTypes.length === 0) {
      return null;
    }
    if (this.knownEventTypes.length === 1) {
      return this.knownEventTypes[0];
    }

    const typeIndex = this.getEncodedEventTypeIndex(eventData.data);
    if (
      typeIndex === null ||
      typeIndex < 0 ||
      typeIndex >= this.knownEventTypes.length
    ) {
      return null;
    }
    return this.knownEventTypes[typeIndex] ?? null;
  }

  private getEncodedEventTypeIndex(data: string[] | null | undefined): number | null {
    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }
    const first = data[0];
    if (typeof first !== "string" || first.trim().length === 0) {
      return null;
    }

    try {
      const parsed = BigInt(first);
      if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
        return null;
      }
      return Number(parsed);
    } catch {
      return null;
    }
  }

  private normalizeKnownEventTypes(eventTypes: string[] | undefined): string[] {
    if (!Array.isArray(eventTypes) || eventTypes.length === 0) {
      return [];
    }

    const normalized = new Set<string>();
    for (const eventType of eventTypes) {
      if (typeof eventType !== "string") {
        continue;
      }
      const trimmed = eventType.trim();
      if (trimmed.length > 0) {
        normalized.add(trimmed);
      }
    }
    return Array.from(normalized).sort();
  }
}
