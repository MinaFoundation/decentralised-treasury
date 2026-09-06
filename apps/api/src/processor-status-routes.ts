import type { EventsApiServerOptions } from "@repo/indexer";
import type { DataSource } from "typeorm";
import { qualifyTableName, resolveDatabaseSchema } from "./database-schema.js";

export interface ProcessorStatusRoutesOptions {
  dataSource: DataSource;
  processorName: string;
  eventTypes: string[];
  projectionName?: string;
  databaseSchema?: string;
  heartbeatMaxAgeMs?: number;
}

const DEFAULT_HEARTBEAT_MAX_AGE_MS = 30_000;
const DEFAULT_PROJECTION_NAME = "proposal";
const ACTIVE_PROCESSOR_STATES = new Set(["running", "idle"]);

export async function assertProcessorReady({
  dataSource,
  processorName,
  projectionName = DEFAULT_PROJECTION_NAME,
  databaseSchema,
  heartbeatMaxAgeMs = DEFAULT_HEARTBEAT_MAX_AGE_MS,
}: Pick<
  ProcessorStatusRoutesOptions,
  | "dataSource"
  | "processorName"
  | "projectionName"
  | "databaseSchema"
  | "heartbeatMaxAgeMs"
>): Promise<void> {
  const resolvedSchema = resolveDatabaseSchema(dataSource, databaseSchema);
  const runtime = await readProcessorRuntime(
    dataSource,
    processorName,
    qualifyTableName(resolvedSchema, "processor_runtime_status"),
  );
  const dueFailureCount = await readDueFailureCount(
    dataSource,
    processorName,
    qualifyTableName(resolvedSchema, "processor_event_failures"),
  );
  const projectionReplay = await readProjectionReplay(
    dataSource,
    projectionName,
    qualifyTableName(resolvedSchema, "processor_proposal_projection_replay"),
  );
  if (
    !isProcessorReady(
      runtime,
      dueFailureCount,
      projectionReplay,
      heartbeatMaxAgeMs,
    )
  ) {
    throw new Error("Processor runtime is not ready");
  }
}

interface ProcessorOffsetSnapshot {
  lastSeenUpdatedAt: string;
  lastSeenEventId: string;
  lastSeenChangeSequence: string;
  updatedAt: string;
}

interface ProcessorOffsetQueryRow {
  last_seen_updated_at: string | Date;
  last_seen_event_id: string | number;
  last_seen_change_sequence: string | number;
  updated_at: string | Date;
}

interface ProcessorRuntimeSnapshot {
  lifecycleState: string;
  heartbeatAt: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  boundedLastError: string | null;
  updatedAt: string;
}

interface ProcessorRuntimeQueryRow {
  lifecycle_state: string;
  heartbeat_at: string | Date;
  last_success_at: string | Date | null;
  last_error_at: string | Date | null;
  last_error_code: string | null;
  bounded_last_error: string | null;
  updated_at: string | Date;
}

interface ProjectionReplaySnapshot {
  projectionName: string;
  targetChangeSequence: string;
  state: string;
  completedAt: string | null;
  updatedAt: string;
}

interface ProjectionReplayQueryRow {
  projection_name: string;
  target_change_sequence: string | number;
  state: string;
  completed_at: string | Date | null;
  updated_at: string | Date;
}

function isProjectionReplayComplete(
  replay: ProjectionReplaySnapshot | null,
): boolean {
  return replay?.state === "complete" && replay.completedAt !== null;
}

function isProcessorReady(
  runtime: ProcessorRuntimeSnapshot | null,
  dueFailureCount: number,
  projectionReplay: ProjectionReplaySnapshot | null,
  heartbeatMaxAgeMs: number,
): boolean {
  return (
    runtime !== null &&
    ACTIVE_PROCESSOR_STATES.has(runtime.lifecycleState) &&
    !isHeartbeatStale(runtime, heartbeatMaxAgeMs) &&
    dueFailureCount === 0 &&
    isProjectionReplayComplete(projectionReplay)
  );
}

function isHeartbeatStale(
  runtime: ProcessorRuntimeSnapshot,
  heartbeatMaxAgeMs: number,
  nowMs = Date.now(),
): boolean {
  const heartbeatMs = Date.parse(runtime.heartbeatAt);
  return (
    !Number.isFinite(heartbeatMs) || nowMs - heartbeatMs > heartbeatMaxAgeMs
  );
}

function toIsoString(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toNullableIsoString(value: string | Date | null): string | null {
  return value === null ? null : toIsoString(value);
}

async function readProcessorOffset(
  dataSource: DataSource,
  processorName: string,
  processorOffsetsTable: string,
): Promise<ProcessorOffsetSnapshot | null> {
  const rows = (await dataSource.query(
    `SELECT "last_seen_updated_at", "last_seen_event_id",
            "last_seen_change_sequence", "updated_at"
     FROM ${processorOffsetsTable}
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
    lastSeenChangeSequence: String(row.last_seen_change_sequence),
    updatedAt: toIsoString(row.updated_at),
  };
}

async function readProcessorRuntime(
  dataSource: DataSource,
  processorName: string,
  processorRuntimeTable: string,
): Promise<ProcessorRuntimeSnapshot | null> {
  const rows = (await dataSource.query(
    `SELECT "lifecycle_state", "heartbeat_at", "last_success_at",
            "last_error_at", "last_error_code", "bounded_last_error", "updated_at"
     FROM ${processorRuntimeTable}
     WHERE "processor_name" = $1
     LIMIT 1`,
    [processorName],
  )) as ProcessorRuntimeQueryRow[];
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    lifecycleState: row.lifecycle_state,
    heartbeatAt: toIsoString(row.heartbeat_at),
    lastSuccessAt: toNullableIsoString(row.last_success_at),
    lastErrorAt: toNullableIsoString(row.last_error_at),
    lastErrorCode: row.last_error_code,
    boundedLastError: row.bounded_last_error,
    updatedAt: toIsoString(row.updated_at),
  };
}

async function readDueFailureCount(
  dataSource: DataSource,
  processorName: string,
  processorFailuresTable: string,
): Promise<number> {
  const rows = (await dataSource.query(
    `SELECT COUNT(*)::bigint AS "count"
     FROM ${processorFailuresTable}
     WHERE "processor_name" = $1
       AND (
         "state" = 'blocked'
         OR (
           "state" = 'retrying'
           AND ("retry_after" IS NULL OR "retry_after" <= NOW())
         )
       )`,
    [processorName],
  )) as Array<{ count?: string | number }>;
  return Number(String(rows[0]?.count ?? 0));
}

async function readProjectionReplay(
  dataSource: DataSource,
  projectionName: string,
  projectionReplayTable: string,
): Promise<ProjectionReplaySnapshot | null> {
  const rows = (await dataSource.query(
    `SELECT "projection_name", "target_change_sequence", "state",
            "completed_at", "updated_at"
     FROM ${projectionReplayTable}
     WHERE "projection_name" = $1
     LIMIT 1`,
    [projectionName],
  )) as ProjectionReplayQueryRow[];
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    projectionName: row.projection_name,
    targetChangeSequence: String(row.target_change_sequence),
    state: row.state,
    completedAt: toNullableIsoString(row.completed_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

async function readProcessorBacklogCount(
  dataSource: DataSource,
  offset: ProcessorOffsetSnapshot | null,
  eventTypes: string[],
  archiveEventsTable: string,
): Promise<number> {
  if (eventTypes.length === 0) {
    return 0;
  }
  const eventTypePlaceholders = eventTypes
    .map((_, index) => `$${index + 2}`)
    .join(", ");
  const result = await dataSource.query(
    `SELECT COUNT(*)::bigint AS "count"
     FROM ${archiveEventsTable}
     WHERE "event_type" IN (${eventTypePlaceholders})
       AND "change_sequence" > $1`,
    [offset?.lastSeenChangeSequence ?? "0", ...eventTypes],
  );
  return Number(
    String((result as Array<{ count?: string | number }>)[0]?.count ?? 0),
  );
}

export function createProcessorStatusRoutes({
  dataSource,
  processorName,
  eventTypes,
  projectionName = DEFAULT_PROJECTION_NAME,
  databaseSchema,
  heartbeatMaxAgeMs = DEFAULT_HEARTBEAT_MAX_AGE_MS,
}: ProcessorStatusRoutesOptions): NonNullable<
  EventsApiServerOptions["registerRoutes"]
> {
  const resolvedSchema = resolveDatabaseSchema(dataSource, databaseSchema);
  const processorOffsetsTable = qualifyTableName(
    resolvedSchema,
    "processor_offsets",
  );
  const archiveEventsTable = qualifyTableName(resolvedSchema, "archive_events");
  const processorRuntimeTable = qualifyTableName(
    resolvedSchema,
    "processor_runtime_status",
  );
  const processorFailuresTable = qualifyTableName(
    resolvedSchema,
    "processor_event_failures",
  );
  const projectionReplayTable = qualifyTableName(
    resolvedSchema,
    "processor_proposal_projection_replay",
  );

  return (app) => {
    app.get("/status", async (_request, response) => {
      try {
        const processorOffset = await readProcessorOffset(
          dataSource,
          processorName,
          processorOffsetsTable,
        );
        const [remainingEvents, runtime, dueFailureCount, projectionReplay] =
          await Promise.all([
            readProcessorBacklogCount(
              dataSource,
              processorOffset,
              eventTypes,
              archiveEventsTable,
            ),
            readProcessorRuntime(
              dataSource,
              processorName,
              processorRuntimeTable,
            ),
            readDueFailureCount(
              dataSource,
              processorName,
              processorFailuresTable,
            ),
            readProjectionReplay(
              dataSource,
              projectionName,
              projectionReplayTable,
            ),
          ]);
        const ready = isProcessorReady(
          runtime,
          dueFailureCount,
          projectionReplay,
          heartbeatMaxAgeMs,
        );
        response.status(ready ? 200 : 503).json({
          ok: ready,
          ready,
          processorName,
          offset: processorOffset,
          remainingEvents,
          runtime,
          projectionReplay,
          failures: {
            due: dueFailureCount,
          },
        });
      } catch (error) {
        console.error(
          "[processor-api] failed to fetch processor status",
          error,
        );
        response.status(503).json({
          ok: false,
          error: "Service unavailable",
        });
      }
    });
  };
}
