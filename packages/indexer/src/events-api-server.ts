import type { Server } from "node:http";
import express, { type Express, type Request, type Response } from "express";
import type { EventsRepository } from "./events-repository.js";

export interface EventsApiServerOptions {
  port: number;
  pageLimitDefault: number;
  pageLimitMax: number;
  indexerPrefix?: string;
  corsAllowedOrigins?: string[];
  registerTopLevelRoutes?: (app: Express) => void | Promise<void>;
  /**
   * @deprecated Use registerTopLevelRoutes instead.
   */
  registerRoutes?: (app: Express) => void | Promise<void>;
  onStop?: () => void | Promise<void>;
}

class QueryValidationError extends Error {}

const DEFAULT_CORS_ALLOWED_ORIGINS = [
  "http://127.0.0.1:3100",
  "http://localhost:3100",
];

function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.includes("*") || allowedOrigins.includes(origin);
}

function applyCorsHeaders(
  request: Request,
  response: Response,
  allowedOrigins: string[],
): boolean {
  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }
  if (!isOriginAllowed(origin, allowedOrigins)) {
    return false;
  }

  response.setHeader(
    "access-control-allow-origin",
    allowedOrigins.includes("*") ? "*" : origin,
  );
  response.setHeader("vary", "Origin");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  return true;
}

function parsePositiveInt(
  value: unknown,
  fallback: number,
  max: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new QueryValidationError("limit must be a positive integer");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new QueryValidationError("limit must be a positive safe integer");
  }
  return Math.min(parsed, max);
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new QueryValidationError(
    "boolean query parameter must be true or false",
  );
}

function parseUpdatedAfter(value: unknown): Date {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value)
    throw new QueryValidationError(
      "updatedAfter must be a valid ISO timestamp",
    );
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    throw new QueryValidationError(
      "updatedAfter must be a valid ISO timestamp",
    );
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new QueryValidationError(
      "updatedAfter must be a valid ISO timestamp",
    );
  }
  return parsed;
}

function parseEventIdAfter(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new QueryValidationError(
      "eventIdAfter must be a nonnegative decimal bigint string",
    );
  }
  return value;
}

function parseChangeSequenceAfter(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new QueryValidationError(
      "changeSequenceAfter must be a nonnegative decimal bigint string",
    );
  }
  return value;
}

function parseEventTypes(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (typeof value !== "string" || value.length === 0 || value.length > 8_192) {
    throw new QueryValidationError(
      "eventTypes must be a nonempty comma-separated string",
    );
  }
  const splitEventTypes = value.split(",").map((eventType) => eventType.trim());
  if (splitEventTypes.some((eventType) => eventType.length === 0)) {
    throw new QueryValidationError("eventTypes contains invalid values");
  }
  const eventTypes = Array.from(new Set(splitEventTypes));
  if (
    eventTypes.length === 0 ||
    eventTypes.length > 100 ||
    eventTypes.some((eventType) => eventType.length > 128)
  ) {
    throw new QueryValidationError("eventTypes contains invalid values");
  }
  return eventTypes;
}

function normalizePrefix(value: string | undefined): string {
  const normalized = (value ?? "").trim().replace(/^\/+|\/+$/g, "");
  return normalized.length > 0 ? `/${normalized}` : "";
}

export class EventsApiServer {
  private server: Server | null = null;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private cleanupPromise: Promise<void> | null = null;
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
    if (
      !Number.isSafeInteger(options.port) ||
      options.port < 0 ||
      options.port > 65_535
    ) {
      throw new Error("port must be an integer from 0 through 65535");
    }
    if (
      !Number.isSafeInteger(options.pageLimitDefault) ||
      options.pageLimitDefault <= 0 ||
      !Number.isSafeInteger(options.pageLimitMax) ||
      options.pageLimitMax <= 0
    ) {
      throw new Error("page limits must be positive safe integers");
    }
    if (options.pageLimitDefault > options.pageLimitMax) {
      throw new Error("pageLimitDefault cannot be greater than pageLimitMax");
    }
    if (
      options.corsAllowedOrigins !== undefined &&
      (!Array.isArray(options.corsAllowedOrigins) ||
        options.corsAllowedOrigins.some(
          (origin) =>
            typeof origin !== "string" || !origin || origin.trim() !== origin,
        ))
    ) {
      throw new Error(
        "corsAllowedOrigins must contain nonempty trimmed strings",
      );
    }
  }

  public async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.server) return;
    if (this.cleanupPromise) {
      throw new Error("EventsApiServer cannot restart after cleanup");
    }
    this.startPromise = this.startInternal();
    try {
      await this.startPromise;
    } catch (error) {
      await this.cleanupOnce();
      throw error;
    } finally {
      this.startPromise = null;
    }
  }

  private async startInternal(): Promise<void> {
    await this.repository.initialize();

    const app = express();
    const corsAllowedOrigins =
      this.options.corsAllowedOrigins ?? DEFAULT_CORS_ALLOWED_ORIGINS;
    app.use((request, response, next) => {
      const corsAllowed = applyCorsHeaders(
        request,
        response,
        corsAllowedOrigins,
      );
      if (request.method === "OPTIONS") {
        if (!corsAllowed) {
          response.status(403).json({ error: "CORS origin is not allowed" });
          return;
        }
        response.status(204).end();
        return;
      }
      if (!corsAllowed) {
        response.status(403).json({ error: "CORS origin is not allowed" });
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
      let changeSequenceAfter: string | undefined;
      let useLegacyCursor: boolean;

      try {
        const hasChangeSequence =
          request.query.changeSequenceAfter !== undefined;
        const hasUpdatedAfter = request.query.updatedAfter !== undefined;
        const hasEventIdAfter = request.query.eventIdAfter !== undefined;
        if (hasChangeSequence && (hasUpdatedAfter || hasEventIdAfter)) {
          throw new QueryValidationError(
            "changeSequenceAfter cannot be combined with legacy cursor fields",
          );
        }
        if (!hasChangeSequence && hasUpdatedAfter !== hasEventIdAfter) {
          throw new QueryValidationError(
            "updatedAfter and eventIdAfter must be supplied together",
          );
        }
        // No cursor stays on the legacy mode during the transition.
        useLegacyCursor = !hasChangeSequence;
        limit = parsePositiveInt(
          request.query.limit,
          this.options.pageLimitDefault,
          this.options.pageLimitMax,
        );
        eventTypes = parseEventTypes(request.query.eventTypes);
        includeUnknown = parseBoolean(request.query.includeUnknown, true);
        if (hasChangeSequence) {
          changeSequenceAfter = parseChangeSequenceAfter(
            request.query.changeSequenceAfter,
          );
          updatedAfter = new Date(0);
          eventIdAfter = "0";
        } else if (hasUpdatedAfter) {
          updatedAfter = parseUpdatedAfter(request.query.updatedAfter);
          eventIdAfter = parseEventIdAfter(request.query.eventIdAfter);
        } else {
          updatedAfter = new Date(0);
          eventIdAfter = "0";
        }
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
          ...(useLegacyCursor
            ? { updatedAfter, eventIdAfter }
            : { changeSequenceAfter }),
          limit,
        });
        const lastEvent = events[events.length - 1] ?? null;

        response.json({
          items: events.map((event) => ({
            id: String(event.id),
            changeSequence: String(event.changeSequence),
            status: event.status,
            pendingSeenAtHeight: event.pendingSeenAtHeight,
            blockHeight: event.blockHeight,
            blockTimestamp: event.blockTimestamp
              ? event.blockTimestamp.toISOString()
              : null,
            globalSlotSinceGenesis: event.globalSlotSinceGenesis,
            stateHash: event.stateHash,
            parentHash: event.parentHash,
            chainStatus: event.chainStatus,
            eventType: event.eventType,
            txHash: event.txHash,
            accountUpdateId: event.accountUpdateId,
            accountUpdateIndex: event.accountUpdateIndex,
            eventIndex: event.eventIndex,
            blockEventIndex: event.blockEventIndex,
            rawEventData: event.rawEventData,
            indexedAt: event.indexedAt.toISOString(),
            updatedAt: event.updatedAt.toISOString(),
          })),
          nextCursor: !lastEvent
            ? null
            : useLegacyCursor
              ? {
                  updatedAfter: lastEvent.updatedAt.toISOString(),
                  eventIdAfter: String(lastEvent.id),
                }
              : { changeSequenceAfter: String(lastEvent.changeSequence) },
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

    await new Promise<void>((resolve, reject) => {
      const server = app.listen(this.options.port, () => {
        server.off("error", onError);
        console.log(
          `[indexer-api] listening on :${this.options.port}${indexerPrefix}`,
        );
        resolve();
      });
      const onError = (error: Error) => {
        if (this.server === server) this.server = null;
        reject(error);
      };
      this.server = server;
      server.once("error", onError);
    });
    this.bindSignalHandlers();
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

  private async stopInternal(): Promise<void> {
    if (this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        // start() performs the same one-time cleanup before it rejects.
      }
    }
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
    await this.cleanupOnce();
  }

  private cleanupOnce(): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;
    this.cleanupPromise = (async () => {
      try {
        await this.repository.close();
      } finally {
        if (this.options.onStop) await this.options.onStop();
      }
    })();
    return this.cleanupPromise;
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
