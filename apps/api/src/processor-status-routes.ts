import type { EventsApiServerOptions } from "@repo/indexer";
import type { DataSource } from "typeorm";

interface ProcessorStatusRoutesOptions {
  dataSource: DataSource;
  processorName: string;
}

interface ProcessorOffsetSnapshot {
  lastSeenUpdatedAt: string;
  lastSeenEventId: string;
  updatedAt: string;
}

interface ProcessorOffsetQueryRow {
  last_seen_updated_at: string | Date;
  last_seen_event_id: string | number;
  updated_at: string | Date;
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isMissingProcessorOffsetsTable(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeCode = "code" in error ? (error as { code?: unknown }).code : null;
  if (maybeCode === "42P01") {
    return true;
  }
  const message =
    "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return (
    message.includes("processor_offsets") &&
    (message.includes("does not exist") || message.includes("relation"))
  );
}

async function readProcessorOffset(
  dataSource: DataSource,
  processorName: string,
): Promise<ProcessorOffsetSnapshot | null> {
  try {
    const rows = (await dataSource.query(
      `SELECT "last_seen_updated_at", "last_seen_event_id", "updated_at"
       FROM "processor_offsets"
       WHERE "processor_name" = $1
       LIMIT 1`,
      [processorName],
    )) as ProcessorOffsetQueryRow[];
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      lastSeenUpdatedAt: toIsoString(row.last_seen_updated_at),
      lastSeenEventId: String(row.last_seen_event_id),
      updatedAt: toIsoString(row.updated_at),
    };
  } catch (error) {
    if (isMissingProcessorOffsetsTable(error)) {
      return null;
    }
    throw error;
  }
}

async function readProcessorBacklogCount(
  dataSource: DataSource,
  offset: ProcessorOffsetSnapshot | null,
): Promise<number> {
  const result = await dataSource.query(
    `SELECT COUNT(*)::bigint AS "count"
     FROM "archive_events"
     WHERE (
       "updated_at" > $1
       OR ("updated_at" = $1 AND "id" > $2)
     )`,
    [offset?.lastSeenUpdatedAt ?? new Date(0).toISOString(), offset?.lastSeenEventId ?? "0"],
  );
  return Number(
    String((result as Array<{ count?: string | number }>)[0]?.count ?? 0),
  );
}

export function createProcessorStatusRoutes({
  dataSource,
  processorName,
}: ProcessorStatusRoutesOptions): NonNullable<EventsApiServerOptions["registerRoutes"]> {
  return (app) => {
    app.get("/status", async (_request, response) => {
      try {
        const processorOffset = await readProcessorOffset(dataSource, processorName);
        const remainingEvents = await readProcessorBacklogCount(
          dataSource,
          processorOffset,
        );
        response.json({
          ok: true,
          processorName,
          offset: processorOffset,
          remainingEvents,
        });
      } catch (error) {
        console.error("[processor-api] failed to fetch processor status", error);
        response.status(500).json({
          error: "Internal server error",
        });
      }
    });
  };
}
