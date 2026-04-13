import type { Server } from "node:http";
import express, { type Express } from "express";
import type { EventsRepository } from "./events-repository.js";

export interface EventsApiServerOptions {
  port: number;
  pageLimitDefault: number;
  pageLimitMax: number;
  indexerPrefix?: string;
  registerTopLevelRoutes?: (app: Express) => void | Promise<void>;
  /**
   * @deprecated Use registerTopLevelRoutes instead.
   */
  registerRoutes?: (app: Express) => void | Promise<void>;
  onStop?: () => void | Promise<void>;
}

class QueryValidationError extends Error {}

function parsePositiveInt(
  value: unknown,
  fallback: number,
  max: number,
): number {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new QueryValidationError("limit must be a positive integer");
  }
  return Math.min(parsed, max);
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new QueryValidationError("boolean query parameter must be true or false");
}

function parseUpdatedAfter(value: unknown): Date {
  if (typeof value !== "string" || value.trim().length === 0) {
    return new Date(0);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new QueryValidationError("updatedAfter must be a valid ISO timestamp");
  }
  return parsed;
}

function parseEventIdAfter(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "0";
  }
  return value.trim();
}

function parseEventTypes(value: unknown): string[] {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .split(",")
        .map((eventType) => eventType.trim())
        .filter((eventType) => eventType.length > 0),
    ),
  );
}

function normalizePrefix(value: string | undefined): string {
  const normalized = (value ?? "").trim().replace(/^\/+|\/+$/g, "");
  return normalized.length > 0 ? `/${normalized}` : "";
}

export class EventsApiServer {
  private server: Server | null = null;
  private signalHandlersBound = false;
  private readonly handleSigInt = () => {
    void this.handleShutdownSignal("SIGINT");
  };
  private readonly handleSigTerm = () => {
    void this.handleShutdownSignal("SIGTERM");
  };

  public constructor(
    private readonly repository: EventsRepository,
    private readonly options: EventsApiServerOptions,
  ) {
    if (options.pageLimitDefault > options.pageLimitMax) {
      throw new Error("pageLimitDefault cannot be greater than pageLimitMax");
    }
  }

  public async start(): Promise<void> {
    if (this.server) {
      return;
    }
    await this.repository.initialize();

    const app = express();
    app.use((_request, response, next) => {
      response.setHeader("access-control-allow-origin", "*");
      response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
      response.setHeader("access-control-allow-headers", "content-type");
      if (_request.method === "OPTIONS") {
        response.status(204).end();
        return;
      }
      next();
    });
    app.use(express.json());
    const indexerPrefix = normalizePrefix(this.options.indexerPrefix);

    app.get(`${indexerPrefix}/healthz`, (_request, response) => {
      response.json({ ok: true });
    });

    app.get(`${indexerPrefix}/events`, async (request, response) => {
      let limit: number;
      let eventTypes: string[];
      let includeUnknown: boolean;
      let updatedAfter: Date;
      let eventIdAfter: string;

      try {
        limit = parsePositiveInt(
          request.query.limit,
          this.options.pageLimitDefault,
          this.options.pageLimitMax,
        );
        eventTypes = parseEventTypes(request.query.eventTypes);
        includeUnknown = parseBoolean(request.query.includeUnknown, true);
        updatedAfter = parseUpdatedAfter(request.query.updatedAfter);
        eventIdAfter = parseEventIdAfter(request.query.eventIdAfter);
      } catch (error) {
        if (error instanceof QueryValidationError) {
          response.status(400).json({
            error: error.message,
          });
          return;
        }
        console.error("[indexer-api] failed to parse events query", error);
        response.status(500).json({
          error: "Internal server error",
        });
        return;
      }

      try {
        const events = await this.repository.getEventsPage({
          eventTypes,
          includeUnknown,
          updatedAfter,
          eventIdAfter,
          limit,
        });
        const lastEvent = events[events.length - 1] ?? null;

        response.json({
          items: events.map((event) => ({
            id: event.id,
            status: event.status,
            pendingSeenAtHeight: event.pendingSeenAtHeight,
            blockHeight: event.blockHeight,
            blockTimestamp: event.blockTimestamp
              ? event.blockTimestamp.toISOString()
              : null,
            eventType: event.eventType,
            txHash: event.txHash,
            accountUpdateId: event.accountUpdateId,
            accountUpdateIndex: event.accountUpdateIndex,
            eventIndex: event.eventIndex,
            rawEventData: event.rawEventData,
            indexedAt: event.indexedAt.toISOString(),
            updatedAt: event.updatedAt.toISOString(),
          })),
          nextCursor: lastEvent
            ? {
                updatedAfter: lastEvent.updatedAt.toISOString(),
                eventIdAfter: lastEvent.id,
              }
            : null,
        });
      } catch (error) {
        console.error("[indexer-api] failed to fetch events page", error);
        response.status(500).json({
          error: "Internal server error",
        });
      }
    });

    const registerTopLevelRoutes =
      this.options.registerTopLevelRoutes ?? this.options.registerRoutes;
    if (registerTopLevelRoutes) {
      await registerTopLevelRoutes(app);
    }

    await new Promise<void>((resolve) => {
      this.server = app.listen(this.options.port, () => {
        console.log(
          `[indexer-api] listening on :${this.options.port}${indexerPrefix}`,
        );
        resolve();
      });
    });
    this.bindSignalHandlers();
  }

  public async stop(): Promise<void> {
    if (this.server) {
      const server = this.server;
      this.server = null;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
    this.unbindSignalHandlers();
    try {
      await this.repository.close();
    } finally {
      if (this.options.onStop) {
        await this.options.onStop();
      }
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
    console.log(`[indexer-api] received ${signal}, shutting down`);
    await this.stop();
  }
}
