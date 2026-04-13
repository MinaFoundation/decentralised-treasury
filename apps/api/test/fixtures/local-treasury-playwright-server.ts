import { createServer } from "node:http";
import { startLocalTreasuryStack } from "../../../../apps/web/e2e/utils/local-treasury-stack.js";

const port = Number(process.env.LOCAL_TREASURY_HARNESS_PORT ?? "0");

function readJsonBody(request: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function writeJson(
  response: import("node:http").ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
}

async function main(): Promise<void> {
  console.log("[local-treasury-harness] booting");
  const stack = await startLocalTreasuryStack();
  console.log("[local-treasury-harness] stack started");

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/healthz") {
        writeJson(response, 200, { ok: true });
        return;
      }
      if (request.method === "GET" && url.pathname === "/stack") {
        writeJson(response, 200, {
          ok: true,
          baseUrl: stack.baseUrl,
          minaNodeUrl: stack.minaNodeUrl,
          archiveUrl: stack.archiveUrl,
          treasuryApiUrl: stack.treasuryApiUrl,
          processorApiUrl: stack.processorApiUrl,
          treasuryOwnerPublicKey: stack.treasuryOwnerPublicKey,
          proposalAmount: stack.proposalAmount,
          recipientPublicKey: stack.recipientPublicKey,
          proposer: stack.proposer,
          voter1: stack.voter1,
          voter2: stack.voter2,
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/advance-slots") {
        const body = (await readJsonBody(request)) as { by?: number };
        await stack.advanceSlots(Number(body.by));
        writeJson(response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/wait/proposal") {
        const body = (await readJsonBody(request)) as { proposalPublicKey?: string };
        const proposal = await stack.waitForProposal(String(body.proposalPublicKey));
        writeJson(response, 200, { ok: true, proposal });
        return;
      }
      if (request.method === "POST" && url.pathname === "/wait/votes") {
        const body = (await readJsonBody(request)) as {
          proposalPublicKey?: string;
          expectedCount?: number;
        };
        const votes = await stack.waitForVotes(
          String(body.proposalPublicKey),
          Number(body.expectedCount),
        );
        writeJson(response, 200, { ok: true, votes });
        return;
      }
      if (request.method === "POST" && url.pathname === "/wait/tally") {
        const body = (await readJsonBody(request)) as { proposalPublicKey?: string };
        await stack.waitForTally(String(body.proposalPublicKey));
        writeJson(response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/wait/execution") {
        const body = (await readJsonBody(request)) as { proposalPublicKey?: string };
        const execution = await stack.waitForExecution(String(body.proposalPublicKey));
        writeJson(response, 200, { ok: true, execution });
        return;
      }
      if (request.method === "POST" && url.pathname === "/tally") {
        const body = (await readJsonBody(request)) as { proposalPublicKey?: string };
        await stack.tallyVotes(String(body.proposalPublicKey));
        writeJson(response, 200, { ok: true });
        return;
      }
      writeJson(response, 404, { error: "Not found" });
    } catch (error) {
      writeJson(response, 500, {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await stack.dispose();
  };

  process.once("SIGINT", () => {
    void close().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void close().finally(() => process.exit(0));
  });

  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve());
  });
  console.log(`[local-treasury-harness] listening on ${port}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
