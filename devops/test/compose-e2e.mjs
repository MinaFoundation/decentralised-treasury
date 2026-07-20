import { spawn } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 300_000;
const CLI_TIMEOUT_MS = 900_000;
const POLL_INTERVAL_MS = 1_000;
const LIFECYCLE_PERIOD_DURATION = process.env.LIFECYCLE_PERIOD_DURATION ?? "20";
const PROPOSAL_AMOUNT = process.env.PROPOSAL_AMOUNT ?? "100000000000";
const TREASURY_FUNDING_AMOUNT =
  process.env.TREASURY_FUNDING_AMOUNT ?? "200000000000";
const PROPOSAL_TITLE = "Compose E2E Treasury Proposal";
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const webRequire = createRequire(
  join(REPO_ROOT, "apps", "web", "package.json"),
);
const TEST_DATA_DIRECTORY = join(REPO_ROOT, "devops", ".data", "e2e");
const ARTIFACTS_DIRECTORY = join(REPO_ROOT, "devops", ".data", "e2e-artifacts");
const PROPOSAL_CONTENT_FILE = join(TEST_DATA_DIRECTORY, "proposal.md");
const APP_IMAGE = "decentralized-treasury:devops";
const COMPOSE_PROJECT_NAME =
  process.env.COMPOSE_E2E_PROJECT_NAME ?? "decentralized-treasury-e2e";
const shouldBuildComposeImage = process.env.COMPOSE_E2E_NO_BUILD !== "1";
const COMPOSE_FILES = ["-f", "devops/compose.yml"];
const STACK_SERVICES = [
  "postgres",
  "api",
  "indexer-api",
  "processor-api",
  "indexer",
  "processor",
  "web",
  "reverse-proxy",
];

const timeoutMs = Number.parseInt(
  process.env.TEST_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS),
  10,
);

const localBlockchainUrl = stripTrailingSlash(
  process.env.LOCAL_BLOCKCHAIN_URL ??
    `http://127.0.0.1:${parseHostPort("MINA_NODE_PORT", "8080")}`,
);
const localArchiveUrl = stripTrailingSlash(
  process.env.LOCAL_ARCHIVE_URL ??
    `http://127.0.0.1:${parseHostPort("MINA_ARCHIVE_PORT", "8282")}/graphql`,
);
const minaNodeUrl = stripTrailingSlash(
  process.env.MINA_NODE_URL ??
    `http://127.0.0.1:${parseHostPort("MINA_NODE_PORT", "8080")}/graphql`,
);
const apiUrl = stripTrailingSlash(
  process.env.API_URL ??
    `http://127.0.0.1:${parseHostPort("PROXY_API_PORT", "4100")}`,
);
const indexerApiUrl = stripTrailingSlash(
  process.env.INDEXER_API_URL ??
    `http://127.0.0.1:${parseHostPort("PROXY_INDEXER_PORT", "4101")}`,
);
const processorApiUrl = stripTrailingSlash(
  process.env.PROCESSOR_API_URL ??
    `http://127.0.0.1:${parseHostPort("PROXY_PROCESSOR_PORT", "4102")}`,
);
const webUrl = stripTrailingSlash(
  process.env.WEB_URL ??
    `http://127.0.0.1:${parseHostPort("PROXY_WEB_PORT", "3100")}`,
);

function stripTrailingSlash(value) {
  return value.replace(/\/+$/u, "");
}

function log(message) {
  console.log(`[compose-e2e] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(command, args, options = {}) {
  const timeout = options.timeoutMs ?? timeoutMs;
  const env = {
    ...process.env,
    NODE_NO_WARNINGS: "1",
    ...options.env,
  };
  const label = options.label ?? [command, ...args].join(" ");

  return new Promise((resolve, reject) => {
    log(`running ${label}`);
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (!options.quiet) {
        process.stdout.write(text);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (!options.quiet) {
        process.stderr.write(text);
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${label} timed out after ${timeout}ms`));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(
        `${label} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`,
      );
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function dockerCompose(args, env) {
  return run(
    "docker",
    [
      "compose",
      "-p",
      COMPOSE_PROJECT_NAME,
      ...COMPOSE_FILES,
      "--profile",
      "proxy",
      ...args,
    ],
    {
      env: {
        ...baseComposeEnv(),
        ...env,
      },
      timeoutMs: CLI_TIMEOUT_MS,
      label: `docker compose ${args.join(" ")}`,
    },
  );
}

function baseComposeEnv() {
  const postgresUser = "postgres";
  const postgresPassword = "compose_e2e_postgres";
  const postgresDb = "treasury_api";
  return {
    POSTGRES_USER: postgresUser,
    POSTGRES_PASSWORD: postgresPassword,
    POSTGRES_DB: postgresDb,
    DATABASE_URL: `postgres://${postgresUser}:${postgresPassword}@postgres:5432/${postgresDb}`,
    DATABASE_SCHEMA: "public",
  };
}

async function buildComposeImageIfNeeded() {
  if (!shouldBuildComposeImage) {
    return;
  }
  await dockerCompose(["build"]);
}

function parseHostPort(name, fallback) {
  const rawPort = process.env[name] ?? fallback;
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Preflight failed: ${name} must be a valid TCP port`);
  }
  return port;
}

function checkPortAvailable({ name, port }) {
  return new Promise((resolve, reject) => {
    const server = createNetServer()
      .once("error", (error) => {
        reject(
          new Error(
            `Preflight failed: ${name} port ${port} is not available (${error.message})`,
          ),
        );
      })
      .once("listening", () => {
        server.close(resolve);
      })
      .listen(port, "127.0.0.1");
  });
}

async function checkCommand(label, command, args) {
  try {
    await run(command, args, {
      label: `preflight ${label}`,
      quiet: true,
      timeoutMs: 60_000,
    });
  } catch (error) {
    const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
    const stdout = typeof error.stdout === "string" ? error.stdout.trim() : "";
    const detail =
      stderr || stdout || (error instanceof Error ? error.message : "");
    throw new Error(`Preflight failed: ${label} is not available. ${detail}`);
  }
}

async function ensureComposeImageAvailable() {
  if (shouldBuildComposeImage) {
    return;
  }
  try {
    await run("docker", ["image", "inspect", APP_IMAGE], {
      label: `preflight docker image ${APP_IMAGE}`,
      quiet: true,
      timeoutMs: 60_000,
    });
  } catch {
    throw new Error(
      `Preflight failed: ${APP_IMAGE} does not exist. Run pnpm compose:e2e without COMPOSE_E2E_NO_BUILD=1 first, or run docker compose -f devops/compose.yml build.`,
    );
  }
}

async function ensureHostPortsAvailable() {
  if (process.env.COMPOSE_E2E_SKIP_PORT_CHECK === "1") {
    log("skipping host port preflight because COMPOSE_E2E_SKIP_PORT_CHECK=1");
    return;
  }

  const ports = [
    { name: "local Mina node", port: parseHostPort("MINA_NODE_PORT", "8080") },
    { name: "local archive", port: parseHostPort("MINA_ARCHIVE_PORT", "8282") },
    {
      name: "reverse proxy web",
      port: parseHostPort("PROXY_WEB_PORT", "3100"),
    },
    {
      name: "reverse proxy API",
      port: parseHostPort("PROXY_API_PORT", "4100"),
    },
    {
      name: "reverse proxy indexer API",
      port: parseHostPort("PROXY_INDEXER_PORT", "4101"),
    },
    {
      name: "reverse proxy processor API",
      port: parseHostPort("PROXY_PROCESSOR_PORT", "4102"),
    },
  ];

  for (const port of ports) {
    await checkPortAvailable(port);
  }
}

async function ensurePlaywrightBrowserAvailable() {
  if (process.env.COMPOSE_E2E_SKIP_BROWSER === "1") {
    log(
      "skipping Playwright browser preflight because COMPOSE_E2E_SKIP_BROWSER=1",
    );
    return;
  }

  try {
    const { chromium } = webRequire("@playwright/test");
    await access(chromium.executablePath());
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Preflight failed: Playwright Chromium is not installed. Run pnpm --dir apps/web exec playwright install chromium, or set COMPOSE_E2E_SKIP_BROWSER=1 to skip the browser assertion. ${detail}`,
    );
  }
}

async function runPreflight() {
  log("running preflight checks");
  await checkCommand("Docker CLI", "docker", ["--version"]);
  await checkCommand("Docker daemon", "docker", ["info"]);
  await checkCommand("Docker Compose", "docker", ["compose", "version"]);
  await checkCommand("pnpm", "pnpm", ["--version"]);
  await ensureComposeImageAvailable();
  await ensureHostPortsAvailable();
  await ensurePlaywrightBrowserAvailable();
  log("preflight checks passed");
}

function buildLocalBlockchainEnv() {
  return {
    MINA_NODE_HOST: "0.0.0.0",
    MINA_NODE_PORT: String(parseHostPort("MINA_NODE_PORT", "8080")),
    MINA_ARCHIVE_PORT: String(parseHostPort("MINA_ARCHIVE_PORT", "8282")),
    MINA_NETWORK_ID: "LOCALNET",
    PROOFS_ENABLED: "false",
  };
}

function hostArchiveUrlForContainers() {
  return `http://host.docker.internal:${parseHostPort("MINA_ARCHIVE_PORT", "8282")}/graphql`;
}

async function stopLocalBlockchain(runtime) {
  if (!runtime || runtime.stopped) {
    return;
  }

  runtime.stopped = true;
  log("stopping external local-blockchain");
  const child = runtime.child;
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const exited = new Promise((resolve) => {
    child.once("exit", resolve);
  });
  try {
    assert(child.pid, "local-blockchain process did not expose a pid");
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }

  const didExit = await Promise.race([
    exited.then(() => true),
    sleep(10_000).then(() => false),
  ]);
  if (!didExit) {
    try {
      assert(child.pid, "local-blockchain process did not expose a pid");
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    await exited;
  }
}

async function startLocalBlockchain() {
  const runtime = {
    child: null,
    stdout: "",
    stderr: "",
    stopped: false,
  };
  const env = {
    ...process.env,
    NODE_NO_WARNINGS: "1",
    ...buildLocalBlockchainEnv(),
  };

  log("starting external local-blockchain");
  const child = spawn(
    "pnpm",
    ["--dir", "packages/local-blockchain", "run", "start"],
    {
      cwd: REPO_ROOT,
      detached: true,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  runtime.child = child;

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    runtime.stdout += text;
    process.stdout.write(text);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    runtime.stderr += text;
    process.stderr.write(text);
  });

  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (!runtime.stopped) {
        reject(
          new Error(
            `external local-blockchain exited early with ${
              signal ? `signal ${signal}` : `exit code ${code}`
            }`,
          ),
        );
      } else {
        resolve();
      }
    });
  });

  try {
    await Promise.race([
      waitFor("external local-blockchain health", () =>
        expectOkJson(`${localBlockchainUrl}/healthz`),
      ),
      exited,
    ]);
  } catch (error) {
    await stopLocalBlockchain(runtime).catch(() => null);
    throw error;
  }

  return runtime;
}

function runCli(args, env = {}, options = {}) {
  return run("pnpm", ["--dir", "apps/cli", "run", "dev", ...args], {
    env: {
      MINA_NODE_URL: minaNodeUrl,
      PROOFS_ENABLED: "false",
      ...env,
    },
    timeoutMs: options.timeoutMs ?? CLI_TIMEOUT_MS,
    label: `mina-treasury ${args.join(" ")}`,
  });
}

function parseLastJsonObject(output, description) {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines.reverse()) {
    if (!line.startsWith("{")) {
      continue;
    }
    try {
      return JSON.parse(line);
    } catch {}
  }

  throw new Error(`Unable to parse ${description} JSON output`);
}

async function waitFor(name, probe, timeout = timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeout) {
    try {
      const result = await probe();
      log(`${name} is ready`);
      return result;
    } catch (error) {
      lastError = error;
      await sleep(POLL_INTERVAL_MS);
    }
  }

  const detail =
    lastError instanceof Error ? lastError.message : JSON.stringify(lastError);
  throw new Error(`Timed out waiting for ${name}: ${detail}`);
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `${url} returned ${response.status}${text ? ` ${text}` : ""}`,
    );
  }
  return response.json();
}

async function postJson(url, body) {
  return fetchJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function expectOkJson(url) {
  const payload = await fetchJson(url);
  if (payload?.ok !== true) {
    throw new Error(`${url} did not return { ok: true }`);
  }
  return payload;
}

async function fetchArchiveHeights() {
  const payload = await fetchJson(localArchiveUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query {
        networkState {
          maxBlockHeight {
            canonicalMaxBlockHeight
            pendingMaxBlockHeight
          }
        }
      }`,
    }),
  });
  const heights = payload?.data?.networkState?.maxBlockHeight;
  if (
    !Number.isFinite(heights?.canonicalMaxBlockHeight) ||
    !Number.isFinite(heights?.pendingMaxBlockHeight)
  ) {
    throw new Error("archive response did not include max block heights");
  }
  return heights;
}

async function expectWebBootstrap() {
  const response = await fetch(webUrl);
  if (!response.ok) {
    throw new Error(`${webUrl} returned ${response.status}`);
  }
  const text = await response.text();
  if (!text.includes("<html") || !text.includes("__next")) {
    throw new Error(`${webUrl} did not return a Next.js HTML document`);
  }
}

function extractItems(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }
  if (Array.isArray(payload.items)) {
    return payload.items;
  }
  if (Array.isArray(payload.data)) {
    return payload.data;
  }
  return [];
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function startMockProposalContentApi() {
  const requests = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const match = url.pathname.match(/^\/proposals\/([^/]+)\/content$/u);
      if (request.method !== "POST" || !match) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "not found" }));
        return;
      }

      const rawBody = await readRequestBody(request);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const proposalPublicKey = decodeURIComponent(match[1]);
      const contents = String(payload.contents ?? "");
      requests.push({ proposalPublicKey, contents });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: true,
          contentChars: contents.length,
          proposalPublicKey,
          zkAppUri: "mock://compose-e2e",
          zkAppUriHash: "mock",
        }),
      );
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(
    address && typeof address !== "string",
    "mock proposal content API did not bind a port",
  );
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

async function fetchProjectedProposal(proposalPublicKey) {
  const payload = await fetchJson(`${processorApiUrl}/proposals?limit=50`);
  return (
    extractItems(payload).find(
      (proposal) => proposal.proposalPublicKey === proposalPublicKey,
    ) ?? null
  );
}

async function fetchAppProposal(proposalPublicKey) {
  const payload = await fetchJson(`${apiUrl}/proposals?limit=50`);
  return (
    extractItems(payload).find(
      (proposal) => proposal.proposalPublicKey === proposalPublicKey,
    ) ?? null
  );
}

async function fetchIndexedProposalCreatedEvent(txHash) {
  const payload = await fetchJson(
    `${indexerApiUrl}/events?eventTypes=proposalCreated&limit=50`,
  );
  return extractItems(payload).find((event) => event.txHash === txHash) ?? null;
}

async function submitProposalContentsToApp(proposalPublicKey, contents) {
  const payload = await postJson(
    `${apiUrl}/proposals/${proposalPublicKey}/content`,
    {
      contents,
    },
  );
  assert(payload?.ok === true, "app API proposal content submission failed");
  return payload;
}

async function verifyWebShowsProposal(title) {
  await expectWebBootstrap();
  if (process.env.COMPOSE_E2E_SKIP_BROWSER === "1") {
    log("skipping browser UI assertion because COMPOSE_E2E_SKIP_BROWSER=1");
    return;
  }

  let browser = null;
  try {
    const { chromium } = webRequire("@playwright/test");
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByText(title, { exact: false }).waitFor({ timeout: 90_000 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `web UI did not render the created proposal. Install Playwright browsers or set COMPOSE_E2E_SKIP_BROWSER=1 to skip this browser assertion. ${detail}`,
    );
  } finally {
    await browser?.close().catch(() => null);
  }
}

function artifactTimestamp() {
  return new Date().toISOString().replace(/[:.]/gu, "-");
}

async function writeArtifact(directory, name, contents) {
  await writeFile(join(directory, name), contents, "utf8");
}

async function captureCommandArtifact(directory, name, command, args, env) {
  try {
    const output = await run(command, args, {
      env,
      label: `capture ${name}`,
      quiet: true,
      timeoutMs: 60_000,
    });
    await writeArtifact(
      directory,
      name,
      [
        `$ ${[command, ...args].join(" ")}`,
        "",
        output.stdout,
        output.stderr,
      ].join("\n"),
    );
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    await writeArtifact(
      directory,
      name,
      [
        `$ ${[command, ...args].join(" ")}`,
        "",
        error instanceof Error ? (error.stack ?? error.message) : String(error),
        "",
        stdout,
        stderr,
      ].join("\n"),
    );
  }
}

async function captureHttpArtifact(directory, name, url, init) {
  try {
    const response = await fetch(url, init);
    const body = await response.text();
    await writeArtifact(
      directory,
      name,
      JSON.stringify(
        {
          url,
          status: response.status,
          ok: response.ok,
          headers: Object.fromEntries(response.headers.entries()),
          body,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await writeArtifact(
      directory,
      name,
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  }
}

async function captureBrowserArtifact(directory) {
  if (process.env.COMPOSE_E2E_SKIP_BROWSER === "1") {
    await writeArtifact(
      directory,
      "web-browser.txt",
      "Skipped because COMPOSE_E2E_SKIP_BROWSER=1",
    );
    return;
  }

  let browser = null;
  try {
    const { chromium } = webRequire("@playwright/test");
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.screenshot({
      path: join(directory, "web-ui.png"),
      fullPage: true,
    });
    await writeArtifact(directory, "web-ui.html", await page.content());
  } catch (error) {
    await writeArtifact(
      directory,
      "web-browser.txt",
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  } finally {
    await browser?.close().catch(() => null);
  }
}

async function captureFailureArtifacts(error, env, localBlockchainRuntime) {
  await mkdir(ARTIFACTS_DIRECTORY, { recursive: true });
  const directory = join(ARTIFACTS_DIRECTORY, artifactTimestamp());
  await mkdir(directory, { recursive: true });

  await writeArtifact(
    directory,
    "error.txt",
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  if (localBlockchainRuntime) {
    await writeArtifact(
      directory,
      "local-blockchain-process.log",
      [
        "stdout:",
        localBlockchainRuntime.stdout,
        "",
        "stderr:",
        localBlockchainRuntime.stderr,
      ].join("\n"),
    );
  }

  const composeArgs = [
    "compose",
    "-p",
    COMPOSE_PROJECT_NAME,
    ...COMPOSE_FILES,
    "--profile",
    "proxy",
  ];
  await captureCommandArtifact(
    directory,
    "docker-compose-ps.txt",
    "docker",
    [...composeArgs, "ps", "--all"],
    env,
  );
  await captureCommandArtifact(
    directory,
    "docker-compose-logs.txt",
    "docker",
    [...composeArgs, "logs", "--no-color", "--timestamps", "--tail", "500"],
    env,
  );

  await captureHttpArtifact(
    directory,
    "local-blockchain-health.json",
    `${localBlockchainUrl}/healthz`,
  );
  await captureHttpArtifact(
    directory,
    "local-blockchain-admin-state.json",
    `${localBlockchainUrl}/admin/state`,
  );
  await captureHttpArtifact(directory, "api-health.json", `${apiUrl}/healthz`);
  await captureHttpArtifact(
    directory,
    "api-proposals.json",
    `${apiUrl}/proposals?limit=50`,
  );
  await captureHttpArtifact(
    directory,
    "indexer-health.json",
    `${indexerApiUrl}/healthz`,
  );
  await captureHttpArtifact(
    directory,
    "indexer-status.json",
    `${indexerApiUrl}/status`,
  );
  await captureHttpArtifact(
    directory,
    "indexer-events.json",
    `${indexerApiUrl}/events?limit=50`,
  );
  await captureHttpArtifact(
    directory,
    "processor-health.json",
    `${processorApiUrl}/healthz`,
  );
  await captureHttpArtifact(
    directory,
    "processor-status.json",
    `${processorApiUrl}/status`,
  );
  await captureHttpArtifact(
    directory,
    "processor-proposals.json",
    `${processorApiUrl}/proposals?limit=50`,
  );
  await captureHttpArtifact(
    directory,
    "archive-heights.json",
    localArchiveUrl,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `query {
          networkState {
            maxBlockHeight {
              canonicalMaxBlockHeight
              pendingMaxBlockHeight
            }
          }
        }`,
      }),
    },
  );
  await captureHttpArtifact(directory, "web-bootstrap.html.json", webUrl);
  await captureBrowserArtifact(directory);

  log(`failure artifacts written to ${directory}`);
}

async function generateKeypairs(count) {
  const output = await runCli(["generate-keypairs", String(count), "--json"]);
  const result = parseLastJsonObject(output.stdout, "generate-keypairs");
  assert(
    Array.isArray(result.keypairs),
    "generate-keypairs output missing keypairs",
  );
  assert(
    result.keypairs.length >= count,
    "generate-keypairs returned too few keys",
  );
  return result.keypairs;
}

async function deployTreasury(adminState) {
  const sender = adminState.testAccounts?.[1] ?? adminState.testAccounts?.[0];
  assert(
    sender?.privateKey,
    "local-blockchain admin state did not include a sender",
  );

  const keys = await generateKeypairs(9);
  const treasuryOwner = keys[0];
  const pauseController = keys[1];
  const multisigParticipants = keys.slice(2, 7);
  const proposal = keys[7];
  const recipient = keys[8];
  const currentSlot = Number(adminState.currentSlot ?? 0);
  const deployedAtSlot =
    currentSlot + Number.parseInt(LIFECYCLE_PERIOD_DURATION, 10);

  const deploymentEnv = {
    SENDER_PRIVATE_KEY: sender.privateKey,
    TREASURY_OWNER_PRIVATE_KEY: treasuryOwner.privateKey,
    PAUSE_CONTROLLER_PRIVATE_KEY: pauseController.privateKey,
    TREASURY_DEPLOYED_AT_SLOT: String(deployedAtSlot),
    MULTISIG_PARTICIPANTS_PUBLIC_KEYS: multisigParticipants
      .map((keypair) => keypair.publicKey)
      .join(","),
    LIFECYCLE_PERIOD_DURATION,
    TX_WAIT: "true",
  };

  const deployOutput = await runCli(
    ["treasury-owner", "deploy"],
    deploymentEnv,
  );
  const deployResult = parseLastJsonObject(
    deployOutput.stdout,
    "treasury-owner deploy",
  );
  assert(
    deployResult.treasuryOwnerAddress === treasuryOwner.publicKey,
    "deploy output treasuryOwnerAddress did not match generated keypair",
  );

  await runCli(["treasury-owner", "fund-treasury"], {
    SENDER_PRIVATE_KEY: sender.privateKey,
    FUNDING_PRIVATE_KEY: sender.privateKey,
    TREASURY_OWNER_PUBLIC_KEY: treasuryOwner.publicKey,
    TRANSFER_AMOUNT: TREASURY_FUNDING_AMOUNT,
    LIFECYCLE_PERIOD_DURATION,
    TX_WAIT: "true",
  });

  const stateOutput = await runCli(["treasury-owner", "read-state"], {
    TREASURY_OWNER_PUBLIC_KEY: treasuryOwner.publicKey,
    LIFECYCLE_PERIOD_DURATION,
  });
  const stateResult = parseLastJsonObject(
    stateOutput.stdout,
    "treasury-owner read-state",
  );
  assert(
    stateResult.treasuryOwnerTokenId,
    "read-state output missing token id",
  );

  return {
    sender,
    treasuryOwner,
    proposal,
    recipient,
    deployResult,
    stateResult,
    deployedAtSlot,
  };
}

async function createProposal({ sender, treasuryOwner, proposal, recipient }) {
  await mkdir(TEST_DATA_DIRECTORY, { recursive: true });
  const proposalContents = [
    `# ${PROPOSAL_TITLE}`,
    "",
    "This proposal is created by the Docker Compose e2e test.",
    "",
  ].join("\n");
  await writeFile(PROPOSAL_CONTENT_FILE, proposalContents, "utf8");

  const contentApi = await startMockProposalContentApi();
  const createOutput = await runCli(["proposal", "create"], {
    TREASURY_API_URL: contentApi.url,
    SENDER_PRIVATE_KEY: sender.privateKey,
    TREASURY_OWNER_PUBLIC_KEY: treasuryOwner.publicKey,
    PROPOSAL_PRIVATE_KEY: proposal.privateKey,
    PROPOSAL_LIFECYCLE_ID: "0",
    RECIPIENT_PUBLIC_KEY: recipient.publicKey,
    PROPOSAL_AMOUNT,
    PROPOSAL_CONTENT_FILE,
    LIFECYCLE_PERIOD_DURATION,
    TX_WAIT: "true",
  }).finally(async () => {
    await contentApi.close();
  });
  const createResult = parseLastJsonObject(
    createOutput.stdout,
    "proposal create",
  );
  assert(
    createResult.proposalAddress === proposal.publicKey,
    "proposal create output proposalAddress did not match generated keypair",
  );
  assert(createResult.proposalTxHash, "proposal create output missing tx hash");
  assert(
    contentApi.requests.length === 1,
    "proposal create did not submit contents",
  );
  return { ...createResult, proposalContents };
}

async function ensureLocalSlotAtLeast(targetSlot) {
  const state = await fetchJson(`${localBlockchainUrl}/admin/state`);
  const currentSlot = Number(state.currentSlot ?? 0);
  if (currentSlot >= targetSlot) {
    log(
      `local-blockchain slot=${currentSlot} already reached target=${targetSlot}`,
    );
    return;
  }

  const by = targetSlot - currentSlot;
  await postJson(`${localBlockchainUrl}/admin/slot/increment`, { by });
  const advancedState = await fetchJson(`${localBlockchainUrl}/admin/state`);
  assert(
    Number(advancedState.currentSlot ?? 0) >= targetSlot,
    `local-blockchain slot did not advance to ${targetSlot}`,
  );
  log(
    `advanced local-blockchain slot from ${currentSlot} to ${advancedState.currentSlot}`,
  );
}

async function ensureProposalCreationPeriod(treasury) {
  await ensureLocalSlotAtLeast(Number(treasury.deployedAtSlot));
}

async function verifyStackHealth() {
  await waitFor("app API health", () => expectOkJson(`${apiUrl}/healthz`));
  await waitFor("indexer API health", () =>
    expectOkJson(`${indexerApiUrl}/healthz`),
  );
  await waitFor("processor API health", () =>
    expectOkJson(`${processorApiUrl}/healthz`),
  );
  await waitFor("web bootstrap", expectWebBootstrap);
}

async function verifyProposalPipeline({ createResult, recipient }) {
  const initialState = await fetchJson(`${localBlockchainUrl}/admin/state`);
  const initialHeights = await fetchArchiveHeights();
  log(
    `initial slot=${initialState.currentSlot} blockHeight=${initialState.blockchainLength}`,
  );

  await postJson(`${localBlockchainUrl}/admin/slot/increment`, { by: 3 });
  const advancedState = await fetchJson(`${localBlockchainUrl}/admin/state`);
  if (advancedState.currentSlot < initialState.currentSlot + 3) {
    throw new Error("local-blockchain slot did not advance");
  }
  log(`advanced slot=${advancedState.currentSlot}`);

  const archiveHeights = await fetchArchiveHeights();
  if (
    archiveHeights.canonicalMaxBlockHeight <
      initialHeights.canonicalMaxBlockHeight ||
    archiveHeights.pendingMaxBlockHeight < initialHeights.pendingMaxBlockHeight
  ) {
    throw new Error(
      "archive heights regressed after local-blockchain slot advance",
    );
  }

  await waitFor("indexer status", async () => {
    const status = await expectOkJson(`${indexerApiUrl}/status`);
    if (!status.archive) {
      throw new Error("missing archive status");
    }
    if (
      status.archive.pendingMaxBlockHeight <
      archiveHeights.pendingMaxBlockHeight
    ) {
      throw new Error("indexer status is behind archive pending head");
    }
    if (
      status.archive.canonicalMaxBlockHeight <
      archiveHeights.canonicalMaxBlockHeight
    ) {
      throw new Error("indexer status is behind archive canonical head");
    }
    return status;
  });

  await waitFor("indexed proposalCreated event", async () => {
    const event = await fetchIndexedProposalCreatedEvent(
      createResult.proposalTxHash,
    );
    if (!event) {
      throw new Error("proposalCreated event is not indexed yet");
    }
    return event;
  });

  const projectedProposal = await waitFor(
    "processor proposal projection",
    async () => {
      const proposal = await fetchProjectedProposal(
        createResult.proposalAddress,
      );
      if (!proposal) {
        throw new Error("proposal row is not projected yet");
      }
      return proposal;
    },
  );
  assert(projectedProposal.lifecycleId === 0, "projected lifecycleId mismatch");
  assert(
    projectedProposal.amount === PROPOSAL_AMOUNT,
    "projected amount mismatch",
  );
  assert(
    projectedProposal.recipient === recipient.publicKey,
    "projected recipient mismatch",
  );

  await waitFor("processor status", async () => {
    const status = await expectOkJson(`${processorApiUrl}/status`);
    if (typeof status.remainingEvents !== "number") {
      throw new Error("missing processor remainingEvents");
    }
    return status;
  });

  await waitFor("app API proposal content submission", () =>
    submitProposalContentsToApp(
      createResult.proposalAddress,
      createResult.proposalContents,
    ),
  );

  const appProposal = await waitFor("app API proposal listing", async () => {
    const proposal = await fetchAppProposal(createResult.proposalAddress);
    if (!proposal) {
      throw new Error("proposal is not listed by app API yet");
    }
    return proposal;
  });
  assert(
    String(appProposal.contents ?? "").includes(PROPOSAL_TITLE),
    "app API proposal listing is missing submitted proposal contents",
  );

  await verifyWebShowsProposal(PROPOSAL_TITLE);
  log("web proposal rendering is ready");
}

async function main() {
  const keepStack = process.env.COMPOSE_E2E_KEEP_STACK === "1";
  let stackEnv = {};
  let localBlockchainRuntime = null;

  try {
    await rm(TEST_DATA_DIRECTORY, { recursive: true, force: true });
    await dockerCompose(["down", "-v"]).catch(() => null);
    await runPreflight();
    await buildComposeImageIfNeeded();
    localBlockchainRuntime = await startLocalBlockchain();
    await dockerCompose(["up", "--no-build", "--wait", "-d", "postgres"]);

    const adminState = await waitFor(
      "local-blockchain admin state",
      async () => {
        const state = await fetchJson(`${localBlockchainUrl}/admin/state`);
        assert(
          Array.isArray(state.testAccounts) && state.testAccounts.length >= 2,
          "admin state missing funded test accounts",
        );
        return state;
      },
    );

    const treasury = await deployTreasury(adminState);
    log(
      `deployed treasury owner ${treasury.deployResult.treasuryOwnerAddress} token=${treasury.stateResult.treasuryOwnerTokenId}`,
    );
    await ensureProposalCreationPeriod(treasury);

    stackEnv = {
      TREASURY_OWNER_CONTRACT_ADDRESS:
        treasury.deployResult.treasuryOwnerAddress,
      NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS:
        treasury.deployResult.treasuryOwnerAddress,
      NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION: LIFECYCLE_PERIOD_DURATION,
      NEXT_PUBLIC_MINA_NODE_URL: minaNodeUrl,
      NEXT_PUBLIC_TREASURY_API_URL: apiUrl,
      NEXT_PUBLIC_INDEXER_API_URL: indexerApiUrl,
      NEXT_PUBLIC_PROCESSOR_API_URL: processorApiUrl,
      CORS_ALLOWED_ORIGINS: "http://127.0.0.1:3100,http://localhost:3100",
      NEXT_PUBLIC_PROOFS_ENABLED: "false",
      NEXT_PUBLIC_NETWORK_ID: "LOCALNET",
      ARCHIVE_NODE_URL: hostArchiveUrlForContainers(),
      PROOFS_ENABLED: "false",
      POLL_PENDING_INTERVAL_MS: "500",
      POLL_CANONICAL_INTERVAL_MS: "500",
      PROCESSOR_POLL_INTERVAL_MS: "500",
      LIFECYCLE_PERIOD_DURATION,
    };

    await dockerCompose(
      ["up", "--no-build", "--wait", "-d", ...STACK_SERVICES],
      stackEnv,
    );
    await verifyStackHealth();

    const createResult = await createProposal(treasury);
    log(
      `created proposal ${createResult.proposalAddress} tx=${createResult.proposalTxHash}`,
    );

    await verifyProposalPipeline({
      createResult,
      recipient: treasury.recipient,
    });

    log(
      [
        "compose e2e passed",
        "verified real treasury deployment, treasury funding, proposal creation, indexer event ingestion, processor projection, app API content, and web UI rendering.",
      ].join("\n"),
    );
  } catch (error) {
    await captureFailureArtifacts(
      error,
      stackEnv,
      localBlockchainRuntime,
    ).catch((artifactError) => {
      console.error(
        "[compose-e2e] failed to capture failure artifacts",
        artifactError,
      );
    });
    throw error;
  } finally {
    if (keepStack) {
      log("leaving compose stack running because COMPOSE_E2E_KEEP_STACK=1");
      log(
        "leaving external local-blockchain running because COMPOSE_E2E_KEEP_STACK=1",
      );
    } else {
      await dockerCompose(["down", "-v"], stackEnv).catch((error) => {
        console.error("[compose-e2e] failed to tear down compose stack", error);
      });
      await stopLocalBlockchain(localBlockchainRuntime).catch((error) => {
        console.error(
          "[compose-e2e] failed to stop external local-blockchain",
          error,
        );
      });
    }
  }
}

main().catch((error) => {
  console.error("[compose-e2e] failed", error);
  process.exit(1);
});
