import type {
  ArchiveMaxHeights,
  EventsApiServerOptions,
  EventsRepository,
} from "@repo/indexer";
import { EventsIndexer } from "@repo/indexer";

interface ArchiveHeightsSource {
  getMaxBlockHeights(): Promise<ArchiveMaxHeights>;
}

export interface IndexerStatusRoutesOptions {
  repository: EventsRepository;
  archive: ArchiveHeightsSource;
}

function computeRemainingBlocks(head: number, cursor: number | null): number {
  return Math.max(0, head - (cursor ?? -1));
}

export function createIndexerStatusRoutes({
  repository,
  archive,
}: IndexerStatusRoutesOptions): NonNullable<EventsApiServerOptions["registerRoutes"]> {
  return (app) => {
    app.get("/status", async (_request, response) => {
      try {
        const [archiveHeights, pendingCursor, canonicalCursor] = await Promise.all([
          archive.getMaxBlockHeights(),
          repository.getCursor(EventsIndexer.PENDING_CURSOR),
          repository.getCursor(EventsIndexer.CANONICAL_CURSOR),
        ]);

        response.json({
          ok: true,
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
        });
      } catch (error) {
        console.error("[indexer-api] failed to fetch indexer stats", error);
        response.status(500).json({
          error: "Internal server error",
        });
      }
    });
  };
}
