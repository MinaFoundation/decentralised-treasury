import type { Server } from "node:http";
import express, { type Express } from "express";

export interface HttpApiServerOptions {
  name: string;
  port: number;
  registerRoutes?: (app: Express) => void | Promise<void>;
  onStop?: () => void | Promise<void>;
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
    app.get("/healthz", (_request, response) => {
      response.json({ ok: true });
    });

    if (this.options.registerRoutes) {
      await this.options.registerRoutes(app);
    }

    await new Promise<void>((resolve) => {
      this.server = app.listen(this.options.port, () => {
        console.log(`[${this.options.name}] listening on :${this.options.port}`);
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
