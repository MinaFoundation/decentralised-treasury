import type { Server } from "node:http";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";

export interface HttpApiServerOptions {
  name: string;
  port: number;
  corsAllowedOrigins?: string[];
  registerRoutes?: (app: Express) => void | Promise<void>;
  checkReady?: () => void | Promise<void>;
  onStop?: () => void | Promise<void>;
}

export interface HttpApiServerLifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
}

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

export class HttpApiServer implements HttpApiServerLifecycle {
  private server: Server | null = null;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private stopCallbackPending = false;
  private signalHandlersBound = false;
  private readonly handleSigInt = () => {
    void this.handleShutdownSignal("SIGINT").catch((error) => {
      console.error(`[${this.options.name}] shutdown failed`, error);
      process.exitCode = 1;
    });
  };
  private readonly handleSigTerm = () => {
    void this.handleShutdownSignal("SIGTERM").catch((error) => {
      console.error(`[${this.options.name}] shutdown failed`, error);
      process.exitCode = 1;
    });
  };

  public constructor(private readonly options: HttpApiServerOptions) {}

  public async start(): Promise<void> {
    if (this.startPromise) {
      return await this.startPromise;
    }
    if (this.server) {
      return;
    }
    if (this.stopPromise) {
      await this.stopPromise;
    }

    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });
    return await this.startPromise;
  }

  private async startInternal(): Promise<void> {
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
    app.get("/healthz", (_request, response) => {
      response.json({ ok: true });
    });
    app.get("/readyz", async (_request, response) => {
      try {
        await this.options.checkReady?.();
        response.json({ ok: true });
      } catch (error) {
        console.error(`[${this.options.name}] readiness check failed`, error);
        response.status(503).json({
          ok: false,
          error: "Service unavailable",
        });
      }
    });

    if (this.options.registerRoutes) {
      await this.options.registerRoutes(app);
    }

    app.use(
      (
        error: unknown,
        _request: Request,
        response: Response,
        _next: NextFunction,
      ) => {
        if (error instanceof SyntaxError) {
          response.status(400).json({ error: "Invalid JSON request body" });
          return;
        }
        console.error(`[${this.options.name}] unhandled request error`, error);
        response.status(500).json({ error: "Internal server error" });
      },
    );

    const server = app.listen(this.options.port);
    this.server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.off("error", onError);
          console.log(
            `[${this.options.name}] listening on :${this.options.port}`,
          );
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
      });
    } catch (error) {
      if (this.server === server) {
        this.server = null;
      }
      throw error;
    }

    this.stopCallbackPending = true;
    this.bindSignalHandlers();
  }

  public async stop(): Promise<void> {
    if (this.stopPromise) {
      return await this.stopPromise;
    }
    if (this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        this.unbindSignalHandlers();
        return;
      }
    }
    if (this.stopPromise) {
      return await this.stopPromise;
    }
    if (!this.server && !this.stopCallbackPending) {
      this.unbindSignalHandlers();
      return;
    }

    this.stopPromise = this.stopInternal().finally(() => {
      this.stopPromise = null;
    });
    return await this.stopPromise;
  }

  private async stopInternal(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.unbindSignalHandlers();

    let closeError: unknown;
    if (server) {
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      } catch (error) {
        closeError = error;
      }
    }

    if (this.stopCallbackPending) {
      this.stopCallbackPending = false;
      await this.options.onStop?.();
    }

    if (closeError) {
      throw closeError;
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
    console.log(`[${this.options.name}] received ${signal}, shutting down`);
    await this.stop();
  }
}
