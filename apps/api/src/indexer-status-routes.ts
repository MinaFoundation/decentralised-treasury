import type {
  ArchiveMaxHeights,
  EventsApiServerOptions,
  EventsRepository,
} from "@repo/indexer";
import { EventsIndexer } from "@repo/indexer";
import type { RequestHandler } from "express";

interface ArchiveHeightsSource {
  getMaxBlockHeights(): Promise<ArchiveMaxHeights>;
}

export interface IndexerStatusRoutesOptions {
  repository: EventsRepository;
  archive: ArchiveHeightsSource;
  runtimeMaxAgeMs?: number;
}

const DEFAULT_RUNTIME_MAX_AGE_MS = 30_000;
const REQUIRED_RUNTIME_OPERATIONS = [
  EventsIndexer.PENDING_CURSOR,
  EventsIndexer.CANONICAL_CURSOR,
  "events:orphan-sweep",
] as const;

function computeRemainingBlocks(head: number, cursor: number | null): number {
  return Math.max(0, head - (cursor ?? -1));
}

export function createIndexerStatusRoutes({
  repository,
  archive,
  runtimeMaxAgeMs = DEFAULT_RUNTIME_MAX_AGE_MS,
}: IndexerStatusRoutesOptions): NonNullable<
  EventsApiServerOptions["registerRoutes"]
> {
  return (app) => {
    const createStatusHandler =
      (readinessProbe: boolean): RequestHandler =>
      async (_request, response) => {
        try {
          const [archiveHeights, pendingCursor, canonicalCursor, operational] =
            await Promise.all([
              archive.getMaxBlockHeights(),
              repository.getCursor(EventsIndexer.PENDING_CURSOR),
              repository.getCursor(EventsIndexer.CANONICAL_CURSOR),
              repository.getOperationalStatus(),
            ]);

          const runtimeByName = new Map(
            operational.runtimeOperations.map((operation) => [
              operation.operationName,
              operation,
            ]),
          );
          const missingOperations = REQUIRED_RUNTIME_OPERATIONS.filter(
            (operationName) => !runtimeByName.has(operationName),
          );
          const nowMs = Date.now();
          const staleOperations = REQUIRED_RUNTIME_OPERATIONS.filter(
            (operationName) => {
              const updatedAt = runtimeByName.get(operationName)?.updatedAt;
              if (!updatedAt) {
                return false;
              }
              const updatedAtMs = new Date(updatedAt).getTime();
              return (
                !Number.isFinite(updatedAtMs) ||
                nowMs - updatedAtMs > runtimeMaxAgeMs
              );
            },
          );
          const ready =
            operational.unresolvedRejectionCount === 0 &&
            operational.failedRuntimeOperations.length === 0 &&
            missingOperations.length === 0 &&
            staleOperations.length === 0;
          response.status(readinessProbe && !ready ? 503 : 200).json({
            ok: readinessProbe ? ready : true,
            ready,
            archive: archiveHeights,
            pendingCursor,
            canonicalCursor,
            remainingPendingBlocks: computeRemainingBlocks(
              archiveHeights.pendingMaxBlockHeight,
              pendingCursor,
            ),
            remainingCanonicalBlocks: computeRemainingBlocks(
              archiveHeights.canonicalMaxBlockHeight,
              canonicalCursor,
            ),
            rejections: {
              total: operational.totalRejectionCount,
              unresolved: operational.unresolvedRejectionCount,
            },
            runtime: {
              operations: operational.runtimeOperations,
              failedOperations: operational.failedRuntimeOperations,
              missingOperations,
              staleOperations,
              maxAgeMs: runtimeMaxAgeMs,
            },
          });
        } catch (error) {
          console.error("[indexer-api] failed to fetch indexer stats", error);
          response.status(503).json({
            ok: false,
            error: "Service unavailable",
          });
        }
      };

    app.get("/status", createStatusHandler(false));
    app.get("/readyz", createStatusHandler(true));
  };
}
