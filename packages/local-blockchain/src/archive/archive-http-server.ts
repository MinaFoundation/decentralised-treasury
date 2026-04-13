import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  LocalBlockchainRuntime,
  type RuntimeArchiveAction,
  type RuntimeArchiveEvent,
} from "../runtime/local-blockchain-runtime.js";

export interface ArchiveHttpServerOptions {
  host?: string;
  port: number;
  runtime: LocalBlockchainRuntime;
}

export interface ArchiveHttpServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function readGraphqlFieldValue(
  query: string,
  fieldName: string,
  variables?: Record<string, unknown>,
): string | undefined {
  const variableMatch = query.match(new RegExp(`${fieldName}:\\s*\\$([A-Za-z_][A-Za-z0-9_]*)`, "u"));
  if (variableMatch?.[1]) {
    const value = variables?.[variableMatch[1]];
    return typeof value === "string" ? value : undefined;
  }
  const literalMatch = query.match(
    new RegExp(`${fieldName}:\\s*"([^"]+)"`, "u"),
  );
  return literalMatch?.[1];
}

function toArchiveEventOutput(events: RuntimeArchiveEvent[]): Array<{
  blockInfo: { height: number; timestamp: string };
  eventData: Array<RuntimeArchiveEvent["eventData"]>;
}> {
  const grouped = new Map<string, { blockInfo: { height: number; timestamp: string }; eventData: Array<RuntimeArchiveEvent["eventData"]> }>();
  for (const event of events) {
    const key = `${event.blockInfo.height}:${event.eventData.transactionInfo.hash}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.eventData.push(event.eventData);
      continue;
    }
    grouped.set(key, {
      blockInfo: event.blockInfo,
      eventData: [event.eventData],
    });
  }
  return [...grouped.values()];
}

function toArchiveActionOutput(
  actions: RuntimeArchiveAction[],
): Array<{
  actionState: RuntimeArchiveAction["actionState"];
  actionData: RuntimeArchiveAction["actionData"];
}> {
  return actions.map((action) => ({
    actionState: action.actionState,
    actionData: action.actionData,
  }));
}

export function createArchiveHttpServer(options: ArchiveHttpServerOptions): ArchiveHttpServer {
  const host = options.host ?? "127.0.0.1";
  const server: Server = createServer(async (request, response) => {
    try {
      if (request.method !== "POST") {
        writeJson(response, 404, { error: "Not found" });
        return;
      }
      const body = (await readJsonBody(request)) as {
        query?: string;
        variables?: {
          input?: {
            address?: string;
            tokenId?: string;
            status?: "PENDING" | "CANONICAL";
            from?: number;
            to?: number;
          };
        };
      };
      const query = body.query ?? "";
      if (query.includes("networkState")) {
        const heights = options.runtime.getArchiveMaxHeights();
        writeJson(response, 200, {
          data: {
            networkState: {
              maxBlockHeight: heights,
            },
          },
        });
        return;
      }
      if (query.includes("events(")) {
        const input = body.variables?.input ?? {};
        const events = options.runtime.fetchArchiveEvents({
          address: input.address ?? readGraphqlFieldValue(query, "address", body.variables),
          tokenId: input.tokenId ?? readGraphqlFieldValue(query, "tokenId", body.variables),
          status: input.status ?? "CANONICAL",
          from: input.from ?? 0,
          to: input.to ?? Number.MAX_SAFE_INTEGER,
        });
        writeJson(response, 200, {
          data: {
            events: toArchiveEventOutput(events),
          },
        });
        return;
      }
      if (query.includes("actions(")) {
        const input = body.variables?.input ?? {};
        const actions = options.runtime.fetchArchiveActions({
          address: input.address ?? readGraphqlFieldValue(query, "address", body.variables),
          tokenId: input.tokenId ?? readGraphqlFieldValue(query, "tokenId", body.variables),
        });
        writeJson(response, 200, {
          data: {
            actions: toArchiveActionOutput(actions),
          },
        });
        return;
      }
      writeJson(response, 200, {
        data: null,
        errors: [{ message: "Unsupported archive query" }],
      });
    } catch (error) {
      writeJson(response, 500, {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  return {
    async start() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port, host, () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
    },
    async stop() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
