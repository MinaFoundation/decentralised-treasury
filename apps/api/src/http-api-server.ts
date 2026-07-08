import type { Server } from "node:http";
import express, { type Express, type Request, type Response } from "express";

export interface HttpApiServerOptions {
  name: string;
  port: number;
  corsAllowedOrigins?: string[];
  registerRoutes?: (app: Express) => void | Promise<void>;
  onStop?: () => void | Promise<void>;
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

export class HttpApiServer {
  private server: Server | null = null;
  private signalHandlersBound = false;
  private readonly handleSigInt = () => {
    void this.handleShutdownSignal("SIGINT");
  };
  private readonly handleSigTerm = () => {
    void this.handleShutdownSignal("SIGTERM");
  };

  public constructor(private readonly options: HttpApiServerOptions) {}

  public async start(): Promise<void> {
    if (this.server) {
      return;
    }

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

    if (this.options.registerRoutes) {
      await this.options.registerRoutes(app);
    }

    await new Promise<void>((resolve) => {
      this.server = app.listen(this.options.port, () => {
        console.log(
          `[${this.options.name}] listening on :${this.options.port}`,
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
    if (this.options.onStop) {
      await this.options.onStop();
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
