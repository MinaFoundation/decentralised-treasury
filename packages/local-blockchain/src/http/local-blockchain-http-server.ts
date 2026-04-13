import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import {
  LocalBlockchainRuntime,
  type LocalBlockchainRuntimeOptions,
  type SubmitTransactionInput,
  type UpdateNetworkStateInput,
} from "../runtime/local-blockchain-runtime.js";

export interface LocalBlockchainHttpServerOptions
  extends LocalBlockchainRuntimeOptions {
  host?: string;
  port: number;
}

export interface LocalBlockchainHttpServer {
  runtime: LocalBlockchainRuntime;
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

function quoteGraphqlObjectKeys(graphqlObject: string): string {
  return graphqlObject.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/gmu, '$1"$2":');
}

function extractBalancedObject(source: string, startIndex: number): string {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;

  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (character === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error("Unable to extract GraphQL object literal");
}

function extractZkappCommandJson(query: string): string {
  const marker = "zkappCommand:";
  const markerIndex = query.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error("sendZkapp mutation is missing zkappCommand");
  }
  const objectStart = query.indexOf("{", markerIndex);
  if (objectStart < 0) {
    throw new Error("sendZkapp mutation is missing zkappCommand object");
  }
  const graphqlObject = extractBalancedObject(query, objectStart);
  return JSON.stringify(JSON.parse(quoteGraphqlObjectKeys(graphqlObject)));
}

function extractZkappCommandJsonFromVariables(
  query: string,
  variables?: Record<string, unknown>,
): string | null {
  const variableMatch = query.match(/zkappCommand:\s*\$([A-Za-z_][A-Za-z0-9_]*)/u);
  if (variableMatch?.[1]) {
    const value = variables?.[variableMatch[1]];
    if (typeof value === "string") {
      return JSON.stringify(JSON.parse(value));
    }
    if (value && typeof value === "object") {
      return JSON.stringify(value);
    }
  }

  const input = variables?.input;
  if (!input || typeof input !== "object") {
    return null;
  }
  const zkappCommand = (input as { zkappCommand?: unknown }).zkappCommand;
  if (typeof zkappCommand === "string") {
    return JSON.stringify(JSON.parse(zkappCommand));
  }
  if (zkappCommand && typeof zkappCommand === "object") {
    return JSON.stringify(zkappCommand);
  }
  return null;
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

function readBestChainMaxLength(query: string): number {
  const match = query.match(/bestChain\s*\(\s*maxLength:\s*(\d+)/u);
  const parsed = match?.[1] ? Number.parseInt(match[1], 10) : 1;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

async function handleGraphqlRequest(
  runtime: LocalBlockchainRuntime,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(request)) as {
    query?: string;
    variables?: Record<string, unknown>;
  };
  const query = body.query ?? "";

  if (query.includes("bestChain(")) {
    writeJson(response, 200, {
      data: {
        bestChain: runtime.getBestChain(readBestChainMaxLength(query)),
      },
    });
    return;
  }

  if (query.includes("genesisConstants")) {
    writeJson(response, 200, {
      data: runtime.getGenesisConstants(),
    });
    return;
  }

  if (query.includes("networkID")) {
    writeJson(response, 200, {
      data: {
        networkID: runtime.getNetworkId(),
      },
    });
    return;
  }

  if (query.includes("account(")) {
    const publicKey = readGraphqlFieldValue(query, "publicKey", body.variables);
    const tokenId = readGraphqlFieldValue(query, "token", body.variables);
    if (!publicKey) {
      writeJson(response, 200, {
        data: {
          account: null,
        },
        errors: [{ message: "Missing publicKey argument" }],
      });
      return;
    }
    writeJson(response, 200, {
      data: {
        account: runtime.getAccount(publicKey, tokenId),
      },
    });
    return;
  }

  if (query.includes("transactionStatus(")) {
    const txId = readGraphqlFieldValue(query, "zkappTransaction", body.variables);
    if (!txId) {
      writeJson(response, 200, {
        data: {
          transactionStatus: null,
        },
        errors: [{ message: "Missing zkappTransaction argument" }],
      });
      return;
    }
    writeJson(response, 200, {
      data: {
        transactionStatus: runtime.getTransactionStatus(txId),
      },
    });
    return;
  }

  if (query.includes("sendZkapp(")) {
    const transactionJson =
      extractZkappCommandJsonFromVariables(query, body.variables) ??
      extractZkappCommandJson(query);
    const result = await runtime.submitTransaction({
      transactionJson,
      waitForInclusion: true,
      label: "graphql-sendZkapp",
    });
    writeJson(response, 200, {
      data: {
        sendZkapp: {
          zkapp: result.sendZkapp,
        },
      },
    });
    return;
  }

  writeJson(response, 200, {
    data: null,
    errors: [{ message: "Unsupported GraphQL operation" }],
  });
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function writeHtml(response: ServerResponse, statusCode: number, payload: string): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(payload);
}

function applyCorsHeaders(response: ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function renderAdminPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Local Blockchain Admin</title>
    <style>
      :root { color-scheme: dark; }
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #0b1020; color: #e5e7eb; }
      main { max-width: 1100px; margin: 0 auto; padding: 24px; }
      h1, h2 { margin: 0 0 12px; }
      .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
      .card { background: #111827; border: 1px solid #374151; border-radius: 12px; padding: 16px; }
      .stats { display: grid; gap: 8px; }
      .stat { display: flex; justify-content: space-between; gap: 16px; }
      label { display: block; font-size: 14px; margin-bottom: 8px; }
      input { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; border: 1px solid #4b5563; background: #0f172a; color: #e5e7eb; }
      button { padding: 10px 14px; border-radius: 8px; border: 0; background: #2563eb; color: white; cursor: pointer; }
      button.secondary { background: #374151; }
      .row { display: flex; gap: 8px; flex-wrap: wrap; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th, td { text-align: left; padding: 8px; border-bottom: 1px solid #374151; vertical-align: top; }
      code { word-break: break-all; }
      #status { margin-bottom: 16px; color: #93c5fd; min-height: 20px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Local Blockchain Admin</h1>
      <div id="status"></div>
      <div class="grid">
        <section class="card">
          <h2>Network State</h2>
          <div id="network-state" class="stats"></div>
          <div class="row" style="margin-top: 12px;">
            <button id="refresh-button" class="secondary" type="button">Refresh</button>
          </div>
        </section>
        <section class="card">
          <h2>Slot Controls</h2>
          <form id="set-slot-form">
            <label>Set slot
              <input id="set-slot-input" name="slot" inputmode="numeric" />
            </label>
            <button type="submit">Set Slot</button>
          </form>
          <form id="increment-slot-form" style="margin-top: 12px;">
            <label>Increment by
              <input id="increment-slot-input" name="by" inputmode="numeric" value="1" />
            </label>
            <button type="submit">Increment Slot</button>
          </form>
        </section>
        <section class="card">
          <h2>Staking Epoch Snapshot</h2>
          <form id="network-state-form">
            <label>Staking ledger hash
              <input id="ledger-hash-input" name="stakingEpochDataLedgerHash" />
            </label>
            <label>Staking ledger total currency
              <input id="ledger-total-currency-input" name="stakingEpochDataLedgerTotalCurrency" inputmode="numeric" />
            </label>
            <button type="submit">Update Network State</button>
          </form>
        </section>
      </div>
      <section class="card" style="margin-top: 16px;">
        <h2>Test Accounts</h2>
        <table>
          <thead>
            <tr>
              <th>Public Key</th>
              <th>Private Key</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody id="accounts-body"></tbody>
        </table>
      </section>
      <section class="card" style="margin-top: 16px;">
        <h2>Transactions</h2>
        <table>
          <thead>
            <tr>
              <th>Hash</th>
              <th>Status</th>
              <th>Slot Before</th>
              <th>Slot After</th>
              <th>Label</th>
            </tr>
          </thead>
          <tbody id="transactions-body"></tbody>
        </table>
      </section>
    </main>
    <script>
      const statusEl = document.getElementById("status");
      const networkStateEl = document.getElementById("network-state");
      const accountsBodyEl = document.getElementById("accounts-body");
      const transactionsBodyEl = document.getElementById("transactions-body");
      const setSlotForm = document.getElementById("set-slot-form");
      const incrementSlotForm = document.getElementById("increment-slot-form");
      const networkStateForm = document.getElementById("network-state-form");
      const refreshButton = document.getElementById("refresh-button");
      const setSlotInput = document.getElementById("set-slot-input");
      const incrementSlotInput = document.getElementById("increment-slot-input");
      const ledgerHashInput = document.getElementById("ledger-hash-input");
      const ledgerTotalCurrencyInput = document.getElementById("ledger-total-currency-input");

      function setStatus(message) {
        statusEl.textContent = message || "";
      }

      function renderState(state) {
        networkStateEl.innerHTML = "";
        const rows = [
          ["Current slot", String(state.currentSlot)],
          ["Blockchain length", String(state.blockchainLength)],
          ["Total currency", String(state.totalCurrency)],
          ["Staking ledger hash", String(state.stakingEpochDataLedgerHash)],
          ["Staking ledger total currency", String(state.stakingEpochDataLedgerTotalCurrency)],
          ["Submitted transactions", String(state.submittedTransactions)],
        ];
        rows.forEach(([label, value]) => {
          const div = document.createElement("div");
          div.className = "stat";
          div.innerHTML = "<span>" + label + "</span><code>" + value + "</code>";
          networkStateEl.appendChild(div);
        });
        setSlotInput.value = String(state.currentSlot);
        ledgerHashInput.value = String(state.stakingEpochDataLedgerHash);
        ledgerTotalCurrencyInput.value = String(state.stakingEpochDataLedgerTotalCurrency);

        accountsBodyEl.innerHTML = "";
        for (const account of state.testAccounts || []) {
          const row = document.createElement("tr");
          row.innerHTML =
            "<td><code>" + account.publicKey + "</code></td>" +
            "<td><code>" + account.privateKey + "</code></td>" +
            "<td><code>" + account.balance + "</code></td>";
          accountsBodyEl.appendChild(row);
        }
      }

      function renderTransactions(payload) {
        transactionsBodyEl.innerHTML = "";
        const receipts = Array.isArray(payload && payload.receipts) ? payload.receipts : [];
        if (receipts.length === 0) {
          const row = document.createElement("tr");
          row.innerHTML = '<td colspan="5"><code>No transactions submitted yet.</code></td>';
          transactionsBodyEl.appendChild(row);
          return;
        }
        for (const receipt of [...receipts].reverse()) {
          const row = document.createElement("tr");
          row.innerHTML =
            "<td><code>" + receipt.hash + "</code></td>" +
            "<td><code>" + receipt.status + "</code></td>" +
            "<td><code>" + receipt.slotBefore + "</code></td>" +
            "<td><code>" + receipt.slotAfter + "</code></td>" +
            "<td><code>" + (receipt.label || "-") + "</code></td>";
          transactionsBodyEl.appendChild(row);
        }
      }

      async function fetchState() {
        const response = await fetch("/admin/state");
        if (!response.ok) throw new Error("Failed to fetch admin state");
        const payload = await response.json();
        renderState(payload);
        return payload;
      }

      async function fetchTransactions() {
        const response = await fetch("/admin/transactions");
        if (!response.ok) throw new Error("Failed to fetch transactions");
        const payload = await response.json();
        renderTransactions(payload);
        return payload;
      }

      async function refreshPage() {
        await Promise.all([fetchState(), fetchTransactions()]);
      }

      async function postJson(url, body) {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Request failed");
        }
        return payload;
      }

      setSlotForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          await postJson("/admin/slot/set", { slot: Number(setSlotInput.value) });
          await refreshPage();
          setStatus("Updated current slot.");
        } catch (error) {
          setStatus(error.message);
        }
      });

      incrementSlotForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          await postJson("/admin/slot/increment", { by: Number(incrementSlotInput.value) });
          await refreshPage();
          setStatus("Incremented current slot.");
        } catch (error) {
          setStatus(error.message);
        }
      });

      networkStateForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          await postJson("/admin/network-state", {
            stakingEpochDataLedgerHash: ledgerHashInput.value,
            stakingEpochDataLedgerTotalCurrency: ledgerTotalCurrencyInput.value,
          });
          await refreshPage();
          setStatus("Updated staking epoch network state.");
        } catch (error) {
          setStatus(error.message);
        }
      });

      refreshButton.addEventListener("click", async () => {
        try {
          await refreshPage();
          setStatus("Refreshed.");
        } catch (error) {
          setStatus(error.message);
        }
      });

      refreshPage().catch((error) => setStatus(error.message));
    </script>
  </body>
</html>`;
}

export async function createLocalBlockchainHttpServer(
  options: LocalBlockchainHttpServerOptions,
): Promise<LocalBlockchainHttpServer> {
  const runtime = await LocalBlockchainRuntime.create(options);
  const host = options.host ?? "127.0.0.1";
  const server: Server = createServer(async (request, response) => {
    try {
      applyCorsHeaders(response);
      const url = new URL(request.url ?? "/", `http://${host}:${options.port}`);
      if (request.method === "OPTIONS") {
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.method === "GET" && url.pathname === "/healthz") {
        writeJson(response, 200, { ok: true });
        return;
      }
      if (request.method === "GET" && url.pathname === "/admin") {
        writeHtml(response, 200, renderAdminPage());
        return;
      }
      if (request.method === "GET" && url.pathname === "/admin/state") {
        const networkState = runtime.getNetworkStateSummary();
        writeJson(response, 200, {
          ok: true,
          proofsEnabled: runtime.proofsEnabled,
          ...networkState,
          testAccounts: runtime.getTestAccounts(),
          submittedTransactions: runtime.getReceipts().length,
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/admin/transactions") {
        writeJson(response, 200, {
          ok: true,
          receipts: runtime.getReceipts(),
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/admin/slot/set") {
        const body = (await readJsonBody(request)) as { slot?: unknown };
        if (!Number.isInteger(body.slot) || Number(body.slot) < 0) {
          writeJson(response, 400, {
            error: "slot must be a non-negative integer",
          });
          return;
        }
        writeJson(response, 200, {
          ok: true,
          ...runtime.setCurrentSlot(Number(body.slot)),
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/admin/slot/increment") {
        const body = (await readJsonBody(request)) as { by?: unknown };
        if (!Number.isInteger(body.by) || Number(body.by) <= 0) {
          writeJson(response, 400, {
            error: "by must be a positive integer",
          });
          return;
        }
        writeJson(response, 200, {
          ok: true,
          ...runtime.incrementCurrentSlot(Number(body.by)),
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/admin/network-state") {
        const body = (await readJsonBody(request)) as UpdateNetworkStateInput;
        writeJson(response, 200, {
          ok: true,
          ...runtime.updateNetworkState(body),
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/graphql") {
        await handleGraphqlRequest(runtime, request, response);
        return;
      }
      if (request.method === "POST" && url.pathname === "/admin/transactions") {
        const body = (await readJsonBody(request)) as Partial<SubmitTransactionInput>;
        if (typeof body.transactionJson !== "string" || body.transactionJson.length === 0) {
          writeJson(response, 400, {
            error: "transactionJson must be a non-empty string",
          });
          return;
        }
        const result = await runtime.submitTransaction({
          transactionJson: body.transactionJson,
          waitForInclusion: body.waitForInclusion,
          label: body.label,
        });
        writeJson(response, 200, {
          ok: true,
          receipt: result.receipt,
        });
        return;
      }
      writeJson(response, 404, { error: "Not found" });
    } catch (error) {
      writeJson(response, 500, {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  return {
    runtime,
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
