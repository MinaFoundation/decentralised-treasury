import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 1_000;
const LIFECYCLE_PERIOD_DURATION = process.env.LIFECYCLE_PERIOD_DURATION ?? "20";
const PROPOSAL_AMOUNT = process.env.PROPOSAL_AMOUNT ?? "100000000000";
const TREASURY_FUNDING_AMOUNT =
  process.env.TREASURY_FUNDING_AMOUNT ?? "200000000000";
const VOTER_FUNDING_AMOUNT = process.env.VOTER_FUNDING_AMOUNT ?? "2000000000";
const PROPOSAL_TITLE = "Compose E2E Treasury Proposal";
const SIGNING_NETWORK_ID = "devnet";
const DEFAULT_TOKEN_ID_BASE58 =
  "wSHV2S4qX9jFsLjQo8r1BsMLH2ZRKsZx6EJd1sbozGPieEC4Jf";
const PROOF_MODE = process.env.PROOFS_ENABLED ?? "false";
if (PROOF_MODE !== "false" && PROOF_MODE !== "true") {
  throw new Error("PROOFS_ENABLED must be exactly false or true");
}
const proofsEnabled = PROOF_MODE === "true";
const CLI_TIMEOUT_MS = proofsEnabled ? 3_600_000 : 900_000;
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const webRequire = createRequire(
  join(REPO_ROOT, "apps", "web", "package.json"),
);
const cliRequire = createRequire(
  join(REPO_ROOT, "apps", "cli", "package.json"),
);
const RUN_ID = parseRunId(
  process.env.COMPOSE_E2E_RUN_ID ??
    `${new Date().toISOString().replace(/[-:.]/gu, "")}-${process.pid}`,
);
const RUN_DIRECTORY = join(REPO_ROOT, "devops", ".data", "e2e", "runs", RUN_ID);
const TEST_DATA_DIRECTORY = join(RUN_DIRECTORY, `proofs-${PROOF_MODE}`);
const SQLITE_DATA_DIRECTORY = join(TEST_DATA_DIRECTORY, "sqlite");
const PROOF_ARTIFACTS_DIRECTORY = join(TEST_DATA_DIRECTORY, "proof-artifacts");
const CLI_WORK_DIRECTORY = join(TEST_DATA_DIRECTORY, "host-cli");
const CLI_CACHE_DIRECTORY = join(CLI_WORK_DIRECTORY, "cache");
const RUN_LAYOUT_FILE = join(TEST_DATA_DIRECTORY, "run-layout.json");
const CLI_ENTRY = join(REPO_ROOT, "apps", "cli", "src", "cli.ts");
const CLI_TYPESCRIPT_PROJECT = join(REPO_ROOT, "apps", "cli", "tsconfig.json");
const CLI_TYPESCRIPT_LOADER = cliRequire.resolve("ts-node/esm");
const LOCAL_BLOCKCHAIN_DIRECTORY = join(
  REPO_ROOT,
  "packages",
  "local-blockchain",
);
const LOCAL_BLOCKCHAIN_ENTRY = join(
  LOCAL_BLOCKCHAIN_DIRECTORY,
  "src",
  "server.ts",
);
const LOCAL_BLOCKCHAIN_TYPESCRIPT_PROJECT = join(
  LOCAL_BLOCKCHAIN_DIRECTORY,
  "tsconfig.json",
);
const LOCAL_BLOCKCHAIN_TYPESCRIPT_LOADER = join(
  REPO_ROOT,
  "packages",
  "sdk",
  "node_modules",
  "ts-node",
  "esm.mjs",
);
const ARTIFACTS_DIRECTORY = join(
  REPO_ROOT,
  "devops",
  ".data",
  "e2e-artifacts",
  "runs",
  RUN_ID,
  `proofs-${PROOF_MODE}`,
);
const PROPOSAL_CONTENT_FILE = join(TEST_DATA_DIRECTORY, "proposal.md");
const STAKING_SNAPSHOT_FILE = join(
  PROOF_ARTIFACTS_DIRECTORY,
  "staking-ledger.json",
);
const STAKING_PROOF_FILE = join(
  PROOF_ARTIFACTS_DIRECTORY,
  "staking-ledger-proof.json",
);
const VOTE_ACTIONS_FILE = join(PROOF_ARTIFACTS_DIRECTORY, "vote-actions.json");
const VOTE_PROOF_FILE = join(
  PROOF_ARTIFACTS_DIRECTORY,
  "vote-reducer-proof.json",
);
const APP_IMAGE = process.env.APP_IMAGE ?? "decentralized-treasury:devops";
const WEB_IMAGE = process.env.WEB_IMAGE ?? "decentralized-treasury:devops-web";
const BACKOFFICE_IMAGE =
  process.env.BACKOFFICE_IMAGE ?? "decentralized-treasury:devops-backoffice";
const REQUIRED_COMPOSE_IMAGES = [APP_IMAGE, WEB_IMAGE, BACKOFFICE_IMAGE];
const COMPOSE_PROJECT_NAME =
  process.env.COMPOSE_E2E_PROJECT_NAME ??
  `decentralized-treasury-e2e-proofs-${PROOF_MODE}`;
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
  "backoffice",
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
const backofficeUrl = stripTrailingSlash(
  process.env.BACKOFFICE_URL ??
    `http://127.0.0.1:${parseHostPort("PROXY_BACKOFFICE_PORT", "3200")}`,
);
let activeProposalPublicKey = null;
const deferredFailures = [];

function stripTrailingSlash(value) {
  return value.replace(/\/+$/u, "");
}

function parseRunId(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(value)) {
    throw new Error(
      "COMPOSE_E2E_RUN_ID must contain 1-100 letters, digits, dots, underscores, or hyphens and must start with a letter or digit",
    );
  }
  return value;
}

function checkHttpUrl(name, value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Preflight failed: ${name} must be a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Preflight failed: ${name} must use HTTP or HTTPS`);
  }
  return parsed;
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
      cwd: options.cwd ?? REPO_ROOT,
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
    TREASURY_OWNER_CONTRACT_ADDRESS: "compose-e2e-bootstrap",
    PROOFS_ENABLED: PROOF_MODE,
    NEXT_PUBLIC_PROOFS_ENABLED: PROOF_MODE,
    SQLITE_DATA_HOST_PATH: SQLITE_DATA_DIRECTORY,
    SQLITE_DATA_DIRECTORY: "/data/sqlite",
    MINA_NODE_PROXY_UPSTREAM: `http://host.docker.internal:${parseHostPort("MINA_NODE_PORT", "8080")}`,
    ARCHIVE_NODE_PROXY_UPSTREAM: `http://host.docker.internal:${parseHostPort("MINA_ARCHIVE_PORT", "8282")}`,
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
  for (const image of REQUIRED_COMPOSE_IMAGES) {
    try {
      await run("docker", ["image", "inspect", image], {
        label: `preflight docker image ${image}`,
        quiet: true,
        timeoutMs: 60_000,
      });
    } catch {
      throw new Error(
        `Preflight failed: ${image} does not exist. Run pnpm compose:e2e without COMPOSE_E2E_NO_BUILD=1 first, or run docker compose -f devops/compose.yml build.`,
      );
    }
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
      name: "reverse proxy backoffice",
      port: parseHostPort("PROXY_BACKOFFICE_PORT", "3200"),
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
  log(`running preflight checks with PROOFS_ENABLED=${PROOF_MODE}`);
  checkHttpUrl("Backoffice URL", backofficeUrl);
  await access(CLI_ENTRY);
  await access(CLI_TYPESCRIPT_PROJECT);
  await access(CLI_TYPESCRIPT_LOADER);
  await access(LOCAL_BLOCKCHAIN_ENTRY);
  await access(LOCAL_BLOCKCHAIN_TYPESCRIPT_PROJECT);
  await access(LOCAL_BLOCKCHAIN_TYPESCRIPT_LOADER);
  await checkCommand("Docker CLI", "docker", ["--version"]);
  await checkCommand("Docker daemon", "docker", ["info"]);
  await checkCommand("Docker Compose", "docker", ["compose", "version"]);
  await checkCommand("pnpm", "pnpm", ["--version"]);
  await ensureComposeImageAvailable();
  await ensureHostPortsAvailable();
  await ensurePlaywrightBrowserAvailable();
  await runCli(["--help"], {}, { quiet: true, timeoutMs: 120_000 });
  log("preflight checks passed");
}

function buildLocalBlockchainEnv() {
  return {
    MINA_NODE_HOST: "0.0.0.0",
    MINA_NODE_PORT: String(parseHostPort("MINA_NODE_PORT", "8080")),
    MINA_ARCHIVE_PORT: String(parseHostPort("MINA_ARCHIVE_PORT", "8282")),
    MINA_NETWORK_ID: "LOCALNET",
    PROOFS_ENABLED: PROOF_MODE,
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
    if (runtime.detached) process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
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
      if (runtime.detached) process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    await exited;
  }
}

async function startLocalBlockchain() {
  const detached = process.env.COMPOSE_E2E_ORDERED_RUN !== "1";
  const command = detached ? "pnpm" : process.execPath;
  const args = detached
    ? ["--dir", "packages/local-blockchain", "run", "start"]
    : ["--loader", LOCAL_BLOCKCHAIN_TYPESCRIPT_LOADER, LOCAL_BLOCKCHAIN_ENTRY];
  const runtime = {
    child: null,
    detached,
    stdout: "",
    stderr: "",
    stopped: false,
  };
  const env = {
    ...process.env,
    NODE_NO_WARNINGS: "1",
    ...buildLocalBlockchainEnv(),
    ...(detached
      ? {}
      : { TS_NODE_PROJECT: LOCAL_BLOCKCHAIN_TYPESCRIPT_PROJECT }),
  };

  log(
    `starting external local-blockchain processGroup=${detached ? "standalone" : "inherited"}`,
  );
  const child = spawn(command, args, {
    cwd: detached ? REPO_ROOT : LOCAL_BLOCKCHAIN_DIRECTORY,
    detached,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
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
  return run(
    process.execPath,
    ["--loader", CLI_TYPESCRIPT_LOADER, CLI_ENTRY, ...args],
    {
      cwd: CLI_WORK_DIRECTORY,
      env: {
        MINA_NODE_URL: minaNodeUrl,
        MINA_NETWORK_ID: SIGNING_NETWORK_ID,
        PROOFS_ENABLED: PROOF_MODE,
        SQLITE_DATA_DIRECTORY,
        TS_NODE_PROJECT: CLI_TYPESCRIPT_PROJECT,
        ...env,
      },
      timeoutMs: options.timeoutMs ?? CLI_TIMEOUT_MS,
      quiet: options.quiet,
      label: `mina-treasury ${args.join(" ")}`,
    },
  );
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

function parseLastJsonDocument(output, description) {
  const lines = output.split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]?.trim() !== "{") {
      continue;
    }
    try {
      return JSON.parse(lines.slice(index).join("\n"));
    } catch {}
  }
  throw new Error(`Unable to parse ${description} JSON document`);
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

async function fetchMinaAccountBalance(publicKey) {
  const payload = await fetchJson(minaNodeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query ComposeE2EAccountBalance {
        account(publicKey: "${publicKey}") {
          balance { total }
        }
      }`,
    }),
  });
  return BigInt(payload?.data?.account?.balance?.total ?? "0");
}

async function verifyMinaProxyOwnerAccount(treasury) {
  const query = `query ComposeE2EOwnerAccount {
    account(
      publicKey: "${treasury.treasuryOwner.publicKey}"
      token: "${DEFAULT_TOKEN_ID_BASE58}"
    ) {
      publicKey
      token
      nonce
      balance { total }
      zkappState
    }
  }`;
  const request = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  };
  const direct = await fetchJson(minaNodeUrl, request);
  const proxied = await fetchJson(`${backofficeUrl}/mina/graphql`, request);
  assert(
    direct?.data?.account?.publicKey === treasury.treasuryOwner.publicKey,
    "direct Mina query did not return the deployed Treasury Owner",
  );
  assert(
    proxied?.data?.account?.publicKey === treasury.treasuryOwner.publicKey,
    "Backoffice Mina proxy did not return the deployed Treasury Owner",
  );
  assert(
    JSON.stringify(proxied.data.account) ===
      JSON.stringify(direct.data.account),
    "Backoffice Mina proxy account response differs from the direct Mina response",
  );
  log("direct and Backoffice-proxied Treasury Owner account reads match");
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

async function expectBackofficeBootstrap() {
  const response = await fetch(backofficeUrl);
  if (!response.ok) {
    throw new Error(`${backofficeUrl} returned ${response.status}`);
  }
  const text = await response.text();
  if (
    !text.includes("<html") ||
    !text.includes("__next") ||
    !text.includes("backoffice-runtime-config")
  ) {
    throw new Error(
      `${backofficeUrl} did not return a Backoffice Next.js HTML document`,
    );
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
  return fetchIndexedEvent("proposalCreated", txHash);
}

async function fetchIndexedEvent(eventType, txHash) {
  const payload = await fetchJson(
    `${indexerApiUrl}/events?eventTypes=${encodeURIComponent(eventType)}&limit=100`,
  );
  return extractItems(payload).find((event) => event.txHash === txHash) ?? null;
}

async function fetchProposalVotes(baseUrl, proposalPublicKey) {
  return fetchJson(`${baseUrl}/proposals/${proposalPublicKey}/votes?limit=20`);
}

async function fetchProposalExecutions(baseUrl, proposalPublicKey) {
  return fetchJson(
    `${baseUrl}/proposals/${proposalPublicKey}/executions?limit=20`,
  );
}

async function verifyBrowserSmoke({
  title,
  treasury,
  proposalPublicKey,
  expectFullyPaid = false,
}) {
  await expectWebBootstrap();
  await expectBackofficeBootstrap();
  if (process.env.COMPOSE_E2E_SKIP_BROWSER === "1") {
    log("skipping browser UI assertion because COMPOSE_E2E_SKIP_BROWSER=1");
    return;
  }

  let browser = null;
  const browserDiagnostics = [];
  const recordBrowserDiagnostic = (entry) => {
    browserDiagnostics.push(entry);
    if (browserDiagnostics.length > 200) browserDiagnostics.shift();
  };
  try {
    const { chromium } = webRequire("@playwright/test");
    browser = await chromium.launch();
    const webPage = await browser.newPage();
    webPage.on("console", (message) => {
      recordBrowserDiagnostic(
        `[web-console:${message.type()}] ${message.text()}`,
      );
    });
    webPage.on("pageerror", (error) => {
      recordBrowserDiagnostic(`[web-pageerror] ${error.message}`);
    });
    webPage.on("requestfailed", (request) => {
      recordBrowserDiagnostic(
        `[web-requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown error"}`,
      );
    });
    webPage.on("response", (response) => {
      if (
        [apiUrl, indexerApiUrl, processorApiUrl, localBlockchainUrl].some(
          (baseUrl) => response.url().startsWith(baseUrl),
        )
      ) {
        recordBrowserDiagnostic(
          `[web-response] ${response.status()} ${response.request().method()} ${response.url()}`,
        );
      }
    });
    const webTargetUrl = expectFullyPaid
      ? `${webUrl}/proposals/${encodeURIComponent(proposalPublicKey)}`
      : webUrl;
    await webPage.goto(webTargetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await webPage
      .getByText(title, { exact: false })
      .waitFor({ timeout: 90_000 });
    const webRuntimeConfig = await webPage.evaluate(
      () => globalThis.__TREASURY_RUNTIME_CONFIG__,
    );
    assert(
      webRuntimeConfig?.networkId === SIGNING_NETWORK_ID,
      "web runtime config did not use the devnet signing domain",
    );
    assert(
      webRuntimeConfig?.proofsEnabled === PROOF_MODE,
      "web runtime config did not expose the selected proof mode",
    );
    assert(
      webRuntimeConfig?.treasuryOwnerContractAddress ===
        treasury.deployResult.treasuryOwnerAddress,
      "web runtime config did not contain the deployed treasury owner",
    );

    if (expectFullyPaid) {
      assert(proposalPublicKey, "final web smoke is missing proposal address");
      const fullyPaidButton = webPage.getByRole("button", {
        name: "Fully paid out",
        exact: true,
      });
      await fullyPaidButton.waitFor({ timeout: 90_000 });
      assert(
        await fullyPaidButton.isDisabled(),
        "web fully-paid action was not disabled",
      );
      const paidOutHeroLabel = webPage
        .locator("p")
        .filter({ hasText: /^Paid out amount$/u })
        .first();
      await paidOutHeroLabel.waitFor({ timeout: 90_000 });
      await paidOutHeroLabel
        .locator("..")
        .locator("..")
        .getByText("110 MINA", { exact: true })
        .waitFor({ timeout: 90_000 });
      await webPage
        .getByText("Votes", { exact: true })
        .first()
        .waitFor({ timeout: 90_000 });
    }

    const backofficePage = await browser.newPage();
    backofficePage.on("console", (message) => {
      recordBrowserDiagnostic(`[console:${message.type()}] ${message.text()}`);
    });
    backofficePage.on("pageerror", (error) => {
      recordBrowserDiagnostic(`[pageerror] ${error.message}`);
    });
    backofficePage.on("requestfailed", (request) => {
      recordBrowserDiagnostic(
        `[requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown error"}`,
      );
    });
    backofficePage.on("request", (request) => {
      if (request.url().includes("/mina/")) {
        recordBrowserDiagnostic(
          `[mina-request] ${request.method()} ${request.url()} ${request.postData()?.slice(0, 2_000) ?? ""}`,
        );
      }
    });
    backofficePage.on("response", (response) => {
      if (response.url().includes("/mina/")) {
        void response
          .text()
          .then((body) => {
            recordBrowserDiagnostic(
              `[mina-response] ${response.status()} ${response.request().method()} ${response.url()} ${body.slice(0, 4_000)}`,
            );
          })
          .catch((error) => {
            recordBrowserDiagnostic(
              `[mina-response-error] ${response.url()} ${error instanceof Error ? error.message : String(error)}`,
            );
          });
      }
    });
    await backofficePage.goto(backofficeUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await backofficePage
      .getByRole("heading", { name: "Break-glass operations" })
      .waitFor({ timeout: 90_000 });
    await backofficePage
      .getByText("Verified", { exact: true })
      .waitFor({ timeout: 90_000 });
    await backofficePage
      .getByText("Active", { exact: true })
      .waitFor({ timeout: 90_000 });
    await backofficePage
      .getByText(SIGNING_NETWORK_ID, { exact: true })
      .waitFor({ timeout: 90_000 });
    await backofficePage
      .getByRole("tab", { name: "Pause treasury" })
      .waitFor({ state: "visible", timeout: 90_000 });
    assert(
      await backofficePage
        .getByRole("tab", { name: "Pause treasury" })
        .isEnabled(),
      "Backoffice pause action was not enabled",
    );

    const runtimeConfig = await backofficePage.evaluate(
      () => globalThis.__TREASURY_BACKOFFICE_CONFIG__,
    );
    assert(
      runtimeConfig?.treasuryOwnerAddress ===
        treasury.deployResult.treasuryOwnerAddress,
      "Backoffice runtime config did not contain the deployed treasury owner",
    );
    assert(
      runtimeConfig?.multisigParticipants ===
        treasury.multisigParticipants
          .map((participant) => participant.publicKey)
          .join(","),
      "Backoffice runtime config did not contain the ordered multisig participants",
    );
    assert(
      runtimeConfig?.proofsEnabled === proofsEnabled,
      "Backoffice runtime config did not expose the selected proof mode",
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        "browser smoke did not show the proposal and configured Backoffice state. Install Playwright browsers or set COMPOSE_E2E_SKIP_BROWSER=1 to skip this browser assertion.",
        detail,
        browserDiagnostics.length > 0
          ? `Browser diagnostics:\n${browserDiagnostics.join("\n")}`
          : "Browser diagnostics: no console, page, request, or relevant service response events were emitted.",
      ].join("\n"),
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

async function captureFileArtifact(directory, name, sourcePath) {
  try {
    const contents = await readFile(sourcePath, "utf8");
    const limit = 1_000_000;
    await writeArtifact(
      directory,
      name,
      contents.length <= limit
        ? contents
        : `${contents.slice(0, limit)}\n[truncated at ${limit} characters]\n`,
    );
  } catch (error) {
    await writeArtifact(
      directory,
      `${name}.txt`,
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
    const capturePage = async (name, url) => {
      const page = await browser.newPage();
      const diagnostics = [];
      page.on("console", (message) => {
        diagnostics.push(`[console:${message.type()}] ${message.text()}`);
      });
      page.on("pageerror", (error) => {
        diagnostics.push(`[pageerror] ${error.message}`);
      });
      page.on("requestfailed", (request) => {
        diagnostics.push(
          `[requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown error"}`,
        );
      });
      page.on("response", (response) => {
        if (response.url().includes("/mina/")) {
          diagnostics.push(
            `[mina-response] ${response.status()} ${response.request().method()} ${response.url()}`,
          );
        }
      });
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page.screenshot({
          path: join(directory, `${name}.png`),
          fullPage: true,
        });
        await writeArtifact(directory, `${name}.html`, await page.content());
        await writeArtifact(
          directory,
          `${name}-browser.log`,
          diagnostics.slice(-200).join("\n"),
        );
      } catch (error) {
        await writeArtifact(
          directory,
          `${name}.txt`,
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
        );
      } finally {
        await page.close().catch(() => null);
      }
    };
    await capturePage("web-ui", webUrl);
    await capturePage("backoffice-ui", backofficeUrl);
    await capturePage(
      "local-blockchain-admin-ui",
      `${localBlockchainUrl}/admin`,
    );
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
  for (const stream of ["stdout", "stderr"]) {
    const contents = error?.[stream];
    if (typeof contents === "string" && contents.length > 0) {
      const limit = 1_000_000;
      await writeArtifact(
        directory,
        `failed-command-${stream}.txt`,
        contents.length <= limit
          ? contents
          : `${contents.slice(-limit)}\n[kept final ${limit} characters]\n`,
      );
    }
  }
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
    { ...baseComposeEnv(), ...env },
  );
  await captureCommandArtifact(
    directory,
    "docker-compose-logs.txt",
    "docker",
    [...composeArgs, "logs", "--no-color", "--timestamps", "--tail", "500"],
    { ...baseComposeEnv(), ...env },
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
  await captureHttpArtifact(
    directory,
    "local-blockchain-transactions.json",
    `${localBlockchainUrl}/admin/transactions`,
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
    "indexer-lifecycle-events.json",
    `${indexerApiUrl}/events?eventTypes=proposalCreated,proposalVoteDispatched,proposalVotesTallied,proposalExecuted&limit=100`,
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
  if (activeProposalPublicKey) {
    await captureHttpArtifact(
      directory,
      "processor-proposal-votes.json",
      `${processorApiUrl}/proposals/${activeProposalPublicKey}/votes?limit=20`,
    );
    await captureHttpArtifact(
      directory,
      "processor-proposal-executions.json",
      `${processorApiUrl}/proposals/${activeProposalPublicKey}/executions?limit=20`,
    );
    await captureHttpArtifact(
      directory,
      "app-proposal-votes.json",
      `${apiUrl}/proposals/${activeProposalPublicKey}/votes?limit=20`,
    );
    await captureHttpArtifact(
      directory,
      "app-proposal-executions.json",
      `${apiUrl}/proposals/${activeProposalPublicKey}/executions?limit=20`,
    );
  }
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
  await captureHttpArtifact(
    directory,
    "backoffice-bootstrap.html.json",
    backofficeUrl,
  );
  await captureBrowserArtifact(directory);
  await captureFileArtifact(
    directory,
    "staking-ledger.json",
    STAKING_SNAPSHOT_FILE,
  );
  await captureFileArtifact(
    directory,
    "staking-ledger-proof.json",
    STAKING_PROOF_FILE,
  );
  await captureFileArtifact(directory, "vote-actions.json", VOTE_ACTIONS_FILE);
  await captureFileArtifact(
    directory,
    "vote-reducer-proof.json",
    VOTE_PROOF_FILE,
  );

  log(
    `failure artifacts for PROOFS_ENABLED=${PROOF_MODE} written to ${directory}`,
  );
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

async function withCliProvingWorker(label, callback) {
  const { RedisMemoryServer } = cliRequire("redis-memory-server");
  const redis = new RedisMemoryServer();
  const host = await redis.getHost();
  const port = await redis.getPort();
  const queueName = `compose-e2e-${PROOF_MODE}-${label}-${Date.now()}`;
  log(
    `starting ${label} CLI worker with cwd=${CLI_WORK_DIRECTORY} cache=${CLI_CACHE_DIRECTORY}`,
  );
  let output = "";
  const appendOutput = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-200_000);
  };
  const worker = spawn(
    process.execPath,
    [
      "--loader",
      CLI_TYPESCRIPT_LOADER,
      CLI_ENTRY,
      "worker",
      "start",
      "--redis-host",
      host,
      "--redis-port",
      String(port),
      "--queue-name",
      queueName,
    ],
    {
      cwd: CLI_WORK_DIRECTORY,
      env: {
        ...process.env,
        MINA_NODE_URL: minaNodeUrl,
        MINA_NETWORK_ID: SIGNING_NETWORK_ID,
        PROOFS_ENABLED: PROOF_MODE,
        SQLITE_DATA_DIRECTORY,
        TS_NODE_PROJECT: CLI_TYPESCRIPT_PROJECT,
        NODE_NO_WARNINGS: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  worker.stdout.on("data", appendOutput);
  worker.stderr.on("data", appendOutput);

  await sleep(1_000);
  assert(
    worker.exitCode === null && worker.signalCode === null,
    `${label} CLI worker exited before it became ready: ${output}`,
  );

  try {
    return await callback({ host, port, queueName });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} CLI worker flow failed: ${detail}\n${output}`);
  } finally {
    if (worker.exitCode === null && worker.signalCode === null) {
      worker.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => worker.once("exit", resolve)),
        sleep(5_000),
      ]);
      if (worker.exitCode === null && worker.signalCode === null) {
        worker.kill("SIGKILL");
      }
    }
    await redis.stop();
  }
}

async function assertProofArtifact(path, description) {
  const payload = JSON.parse(await readFile(path, "utf8"));
  assert(payload?.proof, `${description} is missing proof`);
  assert(payload?.publicInput, `${description} is missing publicInput`);
  assert(payload?.publicOutput, `${description} is missing publicOutput`);
  assert(
    payload?.maxProofsVerified !== undefined,
    `${description} is missing maxProofsVerified`,
  );
  return payload;
}

async function prepareStakingLedgerProof(treasury) {
  await mkdir(PROOF_ARTIFACTS_DIRECTORY, { recursive: true });
  const voterEnv = Object.fromEntries(
    treasury.multisigParticipants.map((participant, index) => [
      `VOTER${index + 1}_PUBLIC_KEY`,
      participant.publicKey,
    ]),
  );
  const snapshotOutput = await runCli(
    ["staking-ledger", "create-development-snapshot"],
    {
      STAKING_LEDGER_PATH: STAKING_SNAPSHOT_FILE,
      TREASURY_OWNER_PUBLIC_KEY: treasury.treasuryOwner.publicKey,
      DEVELOPMENT_TREASURY_OWNER_BALANCE: "100",
      DEVELOPMENT_VOTER_BALANCE: "100",
      ...voterEnv,
    },
  );
  const snapshot = parseLastJsonDocument(
    snapshotOutput.stdout,
    "development staking-ledger snapshot",
  );
  assert(
    snapshot.ledgerHashBase58,
    "staking snapshot is missing ledgerHashBase58",
  );
  assert(
    snapshot.stakingEpochDataLedgerHash,
    "staking snapshot is missing stakingEpochDataLedgerHash",
  );
  assert(
    snapshot.stakingEpochDataLedgerTotalCurrency === "600000000000",
    "staking snapshot total currency must equal 600 MINA",
  );

  await runCli(["staking-ledger", "from-file"], {
    LIFECYCLE_ID: "0",
    STAKING_LEDGER_PATH: STAKING_SNAPSHOT_FILE,
  });
  const rootOutput = await runCli(["staking-ledger", "get-root-hash"], {
    LIFECYCLE_ID: "0",
    EXPECTED_ROOT_HASH: snapshot.ledgerHashBase58,
    ROOT_HASH_OUTPUT_FORMAT: "json",
  });
  const root = parseLastJsonDocument(rootOutput.stdout, "staking-ledger root");
  assert(
    root.ledgerHashBase58 === snapshot.ledgerHashBase58,
    "hydrated staking-ledger root does not match the development snapshot",
  );

  await postJson(`${localBlockchainUrl}/admin/network-state`, {
    stakingEpochDataLedgerHash: snapshot.stakingEpochDataLedgerHash,
    stakingEpochDataLedgerTotalCurrency:
      snapshot.stakingEpochDataLedgerTotalCurrency,
  });
  const networkState = await fetchJson(`${localBlockchainUrl}/admin/state`);
  assert(
    networkState.stakingEpochDataLedgerHash ===
      snapshot.stakingEpochDataLedgerHash,
    "local Mina staking ledger hash does not match the hydrated snapshot",
  );
  assert(
    networkState.stakingEpochDataLedgerTotalCurrency ===
      snapshot.stakingEpochDataLedgerTotalCurrency,
    "local Mina staking total currency does not match the hydrated snapshot",
  );

  await runCli(["staking-ledger-to-voting-ledger", "compile"]);
  await runCli(["staking-ledger-to-voting-ledger", "trace-digest"], {
    LIFECYCLE_ID: "0",
  });
  await withCliProvingWorker("staking", async (redis) => {
    const redisEnv = {
      REDIS_HOST: redis.host,
      REDIS_PORT: String(redis.port),
      QUEUE_NAME: redis.queueName,
      LIFECYCLE_ID: "0",
    };
    await runCli(["staking-ledger-to-voting-ledger", "prove-digest"], redisEnv);
    await runCli(["staking-ledger-to-voting-ledger", "prove-merge"], redisEnv);
  });
  await runCli(["staking-ledger-to-voting-ledger", "prove-exhaust"], {
    LIFECYCLE_ID: "0",
    PROOF_OUTPUT_PATH: STAKING_PROOF_FILE,
  });
  await assertProofArtifact(STAKING_PROOF_FILE, "staking-ledger proof");
  return snapshot;
}

async function fundVoters(treasury) {
  for (const participant of treasury.multisigParticipants) {
    const output = await runCli(["transfer"], {
      SENDER_PRIVATE_KEY: treasury.sender.privateKey,
      RECIPIENT_PUBLIC_KEY: participant.publicKey,
      TRANSFER_AMOUNT: VOTER_FUNDING_AMOUNT,
      TX_WAIT: "true",
    });
    const result = parseLastJsonObject(output.stdout, "voter funding transfer");
    assert(result.transferTxHash, "voter funding transfer is missing tx hash");
    assert(
      result.to === participant.publicKey,
      "voter funding transfer recipient mismatch",
    );
  }
}

async function deployTreasury(adminState) {
  const sender = adminState.testAccounts?.[1] ?? adminState.testAccounts?.[0];
  assert(
    sender?.privateKey,
    "local-blockchain admin state did not include a sender",
  );

  const keys = await generateKeypairs(8);
  const treasuryOwner = keys[0];
  const pauseController = keys[1];
  const multisigParticipants = keys.slice(2, 7);
  const recipient = keys[7];
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
    multisigParticipants,
    recipient,
    deployResult,
    stateResult,
    deployedAtSlot,
  };
}

async function createProposal({ sender, treasuryOwner, recipient }) {
  await mkdir(TEST_DATA_DIRECTORY, { recursive: true });
  const proposalContents = [
    `# ${PROPOSAL_TITLE}`,
    "",
    "This proposal is created by the Docker Compose e2e test.",
    "",
  ].join("\n");
  await writeFile(PROPOSAL_CONTENT_FILE, proposalContents, "utf8");

  const createOutput = await runCli(["proposal", "create"], {
    TREASURY_API_URL: apiUrl,
    SENDER_PRIVATE_KEY: sender.privateKey,
    TREASURY_OWNER_PUBLIC_KEY: treasuryOwner.publicKey,
    PROPOSAL_LIFECYCLE_ID: "0",
    RECIPIENT_PUBLIC_KEY: recipient.publicKey,
    PROPOSAL_AMOUNT,
    PROPOSAL_CONTENT_FILE,
    LIFECYCLE_PERIOD_DURATION,
    TX_WAIT: "true",
  });
  const createResult = parseLastJsonObject(
    createOutput.stdout,
    "proposal create",
  );
  assert(
    createResult.proposalAddress,
    "proposal create output missing address",
  );
  assert(
    createOutput.stderr.includes(
      "The CLI generated an in-memory keypair for deployment and will discard the private key after this command",
    ),
    "proposal create did not warn about its generated deployment key",
  );
  assert(createResult.proposalTxHash, "proposal create output missing tx hash");
  const expectedZkAppUri = `urn:proposal-content:markdown:sha256:${createHash("sha256").update(proposalContents).digest("hex")}`;
  assert(
    createResult.contentSubmission?.ok === true,
    "proposal create did not publish contents through the app API",
  );
  assert(
    createResult.contentSubmission.proposalPublicKey ===
      createResult.proposalAddress,
    "proposal content response address mismatch",
  );
  assert(
    createResult.contentSubmission.contentChars ===
      Array.from(proposalContents).length,
    "proposal content response character count mismatch",
  );
  assert(
    createResult.contentSubmission.zkAppUri === expectedZkAppUri,
    "proposal content response zkAppUri mismatch",
  );
  assert(
    typeof createResult.contentSubmission.zkAppUriHash === "string" &&
      createResult.contentSubmission.zkAppUriHash.length > 0,
    "proposal content response is missing zkAppUriHash",
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

async function ensureLifecyclePeriod(treasury, period) {
  const duration = Number.parseInt(LIFECYCLE_PERIOD_DURATION, 10);
  await ensureLocalSlotAtLeast(
    Number(treasury.deployedAtSlot) + duration * period,
  );
}

async function castFiveVotes(treasury, createResult) {
  await ensureLifecyclePeriod(treasury, 2);
  const votes = [];
  for (const participant of treasury.multisigParticipants) {
    const output = await runCli(["proposal", "vote"], {
      SENDER_PRIVATE_KEY: participant.privateKey,
      TREASURY_OWNER_PUBLIC_KEY: treasury.treasuryOwner.publicKey,
      PROPOSAL_PUBLIC_KEY: createResult.proposalAddress,
      VOTER_PRIVATE_KEY: participant.privateKey,
      PROPOSAL_VOTE: "yay",
      LIFECYCLE_PERIOD_DURATION,
      TX_WAIT: "true",
    });
    const result = parseLastJsonObject(output.stdout, "proposal vote");
    assert(result.voteTxHash, "proposal vote output is missing tx hash");
    assert(
      result.proposalAddress === createResult.proposalAddress,
      "proposal vote output address mismatch",
    );
    votes.push({
      txHash: result.voteTxHash,
      voterPublicKey: participant.publicKey,
    });
  }
  assert(votes.length === 5, "operator flow did not submit five votes");
  return votes;
}

async function prepareVoteReducerProof(treasury, createResult) {
  await ensureLifecyclePeriod(treasury, 3);
  const actionsOutput = await runCli(["proposal", "fetch-actions"], {
    ARCHIVE_NODE_URL: localArchiveUrl,
    TREASURY_OWNER_PUBLIC_KEY: treasury.treasuryOwner.publicKey,
    PROPOSAL_PUBLIC_KEY: createResult.proposalAddress,
    PROPOSAL_ACTIONS_OUTPUT_PATH: VOTE_ACTIONS_FILE,
  });
  const actionsResult = parseLastJsonObject(
    actionsOutput.stdout,
    "proposal fetch-actions",
  );
  assert(actionsResult.count === 5, "Archive did not return five vote actions");
  assert(
    actionsResult.proposalPublicKey === createResult.proposalAddress,
    "Archive action proposal address mismatch",
  );

  const actions = JSON.parse(await readFile(VOTE_ACTIONS_FILE, "utf8"));
  assert(
    Array.isArray(actions.voteActions) && actions.voteActions.length === 5,
    "vote action artifact does not contain five actions",
  );
  assert(
    actions.voteActions.every((action) => action.vote === "1"),
    "vote action artifact contains a non-yay vote",
  );
  assert(
    actions.voteActions
      .map((action) => action.publicKey)
      .sort()
      .join(",") ===
      treasury.multisigParticipants
        .map((participant) => participant.publicKey)
        .sort()
        .join(","),
    "Archive vote action voters do not match the five funded participants",
  );

  await runCli(["vote-reducer", "compile"]);
  await runCli(["vote-reducer", "trace-run-batch"], {
    LIFECYCLE_ID: "0",
    VOTE_ACTIONS_PATH: VOTE_ACTIONS_FILE,
  });
  await withCliProvingWorker("vote-reducer", async (redis) => {
    const redisEnv = {
      REDIS_HOST: redis.host,
      REDIS_PORT: String(redis.port),
      QUEUE_NAME: redis.queueName,
      LIFECYCLE_ID: "0",
    };
    await runCli(["vote-reducer", "prove-run-batch"], redisEnv);
    await runCli(["vote-reducer", "prove-merge"], {
      ...redisEnv,
      PROOF_OUTPUT_PATH: VOTE_PROOF_FILE,
    });
  });
  await assertProofArtifact(VOTE_PROOF_FILE, "vote-reducer proof");
  return actions;
}

async function tallyAndExecuteProposal(treasury, createResult) {
  const tallyOutput = await runCli(["proposal", "tally-votes"], {
    SENDER_PRIVATE_KEY: treasury.sender.privateKey,
    TREASURY_OWNER_PUBLIC_KEY: treasury.treasuryOwner.publicKey,
    PROPOSAL_PUBLIC_KEY: createResult.proposalAddress,
    VOTE_REDUCER_PROOF_PATH: VOTE_PROOF_FILE,
    STAKING_LEDGER_TO_VOTING_LEDGER_PROOF_PATH: STAKING_PROOF_FILE,
    LIFECYCLE_ID: "0",
    LIFECYCLE_PERIOD_DURATION,
    TX_WAIT: "true",
  });
  const tallyResult = parseLastJsonObject(
    tallyOutput.stdout,
    "proposal tally-votes",
  );
  assert(tallyResult.tallyTxHash, "tally output is missing tx hash");
  assert(
    tallyResult.proposalAddress === createResult.proposalAddress,
    "tally output proposal address mismatch",
  );

  const approvedStateOutput = await runCli(["proposal", "read-state"], {
    TREASURY_OWNER_PUBLIC_KEY: treasury.treasuryOwner.publicKey,
    PROPOSAL_PUBLIC_KEY: createResult.proposalAddress,
  });
  const approvedState = parseLastJsonObject(
    approvedStateOutput.stdout,
    "approved proposal state",
  );
  assert(approvedState.status === "approved", "proposal was not approved");
  assert(approvedState.statusField === "1", "approved status field mismatch");
  assert(
    approvedState.paidOutAmount === "0",
    "proposal paid out before execute",
  );

  await ensureLifecyclePeriod(treasury, 4);
  const expectedPayoutAmount = (
    BigInt(PROPOSAL_AMOUNT) +
    BigInt(PROPOSAL_AMOUNT) / 10n
  ).toString();
  const recipientBalanceBefore = await fetchMinaAccountBalance(
    treasury.recipient.publicKey,
  );
  const treasuryBalanceBefore = await fetchMinaAccountBalance(
    treasury.treasuryOwner.publicKey,
  );
  const executeOutput = await runCli(["proposal", "execute"], {
    SENDER_PRIVATE_KEY: treasury.sender.privateKey,
    TREASURY_OWNER_PUBLIC_KEY: treasury.treasuryOwner.publicKey,
    PROPOSAL_PUBLIC_KEY: createResult.proposalAddress,
    RECIPIENT_PUBLIC_KEY: treasury.recipient.publicKey,
    EXECUTE_PROPOSAL_AMOUNT: expectedPayoutAmount,
    LIFECYCLE_PERIOD_DURATION,
    TX_WAIT: "true",
  });
  const executeResult = parseLastJsonObject(
    executeOutput.stdout,
    "proposal execute",
  );
  assert(executeResult.executeTxHash, "execute output is missing tx hash");
  assert(
    executeResult.proposalAddress === createResult.proposalAddress,
    "execute output proposal address mismatch",
  );
  assert(
    executeResult.recipientPublicKey === treasury.recipient.publicKey,
    "execute output recipient mismatch",
  );
  assert(
    executeResult.amountToPayOut === expectedPayoutAmount,
    "execute output payout mismatch",
  );

  const recipientBalanceAfter = await fetchMinaAccountBalance(
    treasury.recipient.publicKey,
  );
  const treasuryBalanceAfter = await fetchMinaAccountBalance(
    treasury.treasuryOwner.publicKey,
  );
  assert(
    recipientBalanceAfter - recipientBalanceBefore ===
      BigInt(expectedPayoutAmount),
    "recipient Mina balance did not increase by the payout amount",
  );
  assert(
    treasuryBalanceBefore - treasuryBalanceAfter ===
      BigInt(expectedPayoutAmount),
    "Treasury Owner Mina balance did not decrease by the payout amount",
  );

  const executedStateOutput = await runCli(["proposal", "read-state"], {
    TREASURY_OWNER_PUBLIC_KEY: treasury.treasuryOwner.publicKey,
    PROPOSAL_PUBLIC_KEY: createResult.proposalAddress,
  });
  const executedState = parseLastJsonObject(
    executedStateOutput.stdout,
    "executed proposal state",
  );
  assert(
    executedState.status === "approved",
    "executed proposal did not retain APPROVED status",
  );
  assert(executedState.statusField === "1", "executed status field mismatch");
  assert(
    executedState.paidOutAmount === expectedPayoutAmount,
    "executed proposal paidOutAmount mismatch",
  );

  return {
    tallyTxHash: tallyResult.tallyTxHash,
    executeTxHash: executeResult.executeTxHash,
    expectedPayoutAmount,
    recipientBalanceBefore,
    recipientBalanceAfter,
    treasuryBalanceBefore,
    treasuryBalanceAfter,
  };
}

async function incrementLocalSlotThroughAdminUi(by) {
  if (process.env.COMPOSE_E2E_SKIP_BROWSER === "1") {
    await postJson(`${localBlockchainUrl}/admin/slot/increment`, { by });
    return;
  }

  let browser = null;
  try {
    const { chromium } = webRequire("@playwright/test");
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(`${localBlockchainUrl}/admin`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.getByLabel("Increment by").fill(String(by));
    await page.getByRole("button", { name: "Increment Slot" }).click();
    await page
      .getByText("Incremented current slot.", { exact: true })
      .waitFor({ timeout: 60_000 });
  } finally {
    await browser?.close().catch(() => null);
  }
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
  await waitFor(
    "Backoffice health and runtime bootstrap",
    expectBackofficeBootstrap,
  );
}

async function verifyProposalPipeline({ createResult, recipient, treasury }) {
  const initialState = await fetchJson(`${localBlockchainUrl}/admin/state`);
  const initialHeights = await fetchArchiveHeights();
  log(
    `initial slot=${initialState.currentSlot} blockHeight=${initialState.blockchainLength}`,
  );

  await incrementLocalSlotThroughAdminUi(3);
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
  assert(
    projectedProposal.zkAppUriHash ===
      createResult.contentSubmission.zkAppUriHash,
    "processor proposal content hash does not match the CLI submission response",
  );

  await waitFor("processor status", async () => {
    const status = await expectOkJson(`${processorApiUrl}/status`);
    if (typeof status.remainingEvents !== "number") {
      throw new Error("missing processor remainingEvents");
    }
    return status;
  });

  const appProposal = await waitFor("app API proposal listing", async () => {
    const proposal = await fetchAppProposal(createResult.proposalAddress);
    if (!proposal) {
      throw new Error("proposal is not listed by app API yet");
    }
    return proposal;
  });
  assert(
    appProposal.contents === createResult.proposalContents,
    "app API proposal content readback does not match the submitted markdown",
  );
  assert(
    appProposal.zkAppUriHash === createResult.contentSubmission.zkAppUriHash,
    "app API proposal content hash does not match the CLI submission response",
  );

  try {
    await verifyBrowserSmoke({ title: PROPOSAL_TITLE, treasury });
    log("web proposal and configured Backoffice rendering are ready");
  } catch (error) {
    deferredFailures.push(error);
    log(
      `initial browser smoke failed; continuing the independent lifecycle checks: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assertCompletedProposalProjection(
  proposal,
  createResult,
  treasury,
  lifecycleResult,
  surface,
  { expectEnrichedPayout = false } = {},
) {
  assert(proposal, `${surface} does not contain the proposal`);
  assert(
    proposal.proposalPublicKey === createResult.proposalAddress,
    `${surface} proposal address mismatch`,
  );
  assert(proposal.contractStatus === "approved", `${surface} status mismatch`);
  assert(
    proposal.paidOutAmount === lifecycleResult.expectedPayoutAmount,
    `${surface} paidOutAmount mismatch`,
  );
  assert(
    proposal.recipient === treasury.recipient.publicKey,
    `${surface} recipient mismatch`,
  );
  assert(
    proposal.amount === PROPOSAL_AMOUNT,
    `${surface} proposal amount mismatch`,
  );
  assert(proposal.isPaused === false, `${surface} proposal is paused`);
  assert(
    proposal.stakingEpochDataLedgerTotalCurrency === "600000000000",
    `${surface} staking total mismatch`,
  );
  if (!expectEnrichedPayout) {
    return;
  }
  assert(
    proposal.totalPayoutAmount === lifecycleResult.expectedPayoutAmount,
    `${surface} total payout mismatch`,
  );
  assert(
    proposal.remainingPayoutAmount === "0",
    `${surface} remaining payout is not zero`,
  );
  assert(
    proposal.payoutAmountIntegrity === true,
    `${surface} payout integrity mismatch`,
  );
  assert(
    proposal.finalVoteTally?.createdByEventType === "proposalVotesTallied",
    `${surface} final tally source mismatch`,
  );
  assert(
    proposal.finalVoteTally?.voteResult === "approved",
    `${surface} final vote result mismatch`,
  );
  assert(
    proposal.finalVoteTally?.yayWeight === "500000000000",
    `${surface} yay weight mismatch`,
  );
  assert(
    proposal.finalVoteTally?.nayWeight === "0" &&
      proposal.finalVoteTally?.abstainWeight === "0",
    `${surface} non-yay weight is not zero`,
  );
}

function assertProjectedVotes(payload, treasury, surface) {
  assert(payload?.total === 5, `${surface} vote total is not five`);
  const votes = extractItems(payload);
  assert(votes.length === 5, `${surface} did not return five votes`);
  assert(
    votes.every(
      (vote) =>
        vote.vote === "yay" &&
        vote.voteWeight === "100000000000" &&
        vote.isNullified === false &&
        (vote.status === "pending" || vote.status === "canonical"),
    ),
    `${surface} vote projection mismatch`,
  );
  assert(
    votes
      .map((vote) => vote.voterPublicKey)
      .sort()
      .join(",") ===
      treasury.multisigParticipants
        .map((participant) => participant.publicKey)
        .sort()
        .join(","),
    `${surface} voter set mismatch`,
  );
}

function assertProjectedExecution(payload, treasury, lifecycleResult, surface) {
  assert(payload?.total === 1, `${surface} execution total is not one`);
  const executions = extractItems(payload);
  assert(executions.length === 1, `${surface} did not return one execution`);
  const execution = executions[0];
  assert(
    execution.recipient === treasury.recipient.publicKey,
    `${surface} execution recipient mismatch`,
  );
  assert(
    execution.amountToPayOut === lifecycleResult.expectedPayoutAmount,
    `${surface} execution payout mismatch`,
  );
  assert(
    execution.paidOutAmount === lifecycleResult.expectedPayoutAmount &&
      execution.remainingAmount === "0",
    `${surface} execution balance projection mismatch`,
  );
  assert(
    execution.status === "pending" || execution.status === "canonical",
    `${surface} execution status mismatch`,
  );
}

async function verifyCompletedLifecycle({
  treasury,
  createResult,
  votes,
  lifecycleResult,
}) {
  const expectedEvents = [
    ...votes.map((vote) => ({
      eventType: "proposalVoteDispatched",
      txHash: vote.txHash,
    })),
    {
      eventType: "proposalVotesTallied",
      txHash: lifecycleResult.tallyTxHash,
    },
    {
      eventType: "proposalExecuted",
      txHash: lifecycleResult.executeTxHash,
    },
  ];
  for (const expected of expectedEvents) {
    await waitFor(
      `indexed ${expected.eventType} event ${expected.txHash}`,
      async () => {
        const event = await fetchIndexedEvent(
          expected.eventType,
          expected.txHash,
        );
        if (!event) {
          throw new Error(`${expected.eventType} event is not indexed yet`);
        }
        assert(
          event.txHash === expected.txHash,
          "indexed transaction mismatch",
        );
        assert(
          event.eventType === expected.eventType,
          "indexed event type mismatch",
        );
        return event;
      },
    );
  }

  await waitFor("processor completed proposal projection", async () => {
    const proposal = await fetchProjectedProposal(createResult.proposalAddress);
    assertCompletedProposalProjection(
      proposal,
      createResult,
      treasury,
      lifecycleResult,
      "processor API",
    );
    return proposal;
  });

  await waitFor("app API completed proposal projection", async () => {
    const proposal = await fetchAppProposal(createResult.proposalAddress);
    assertCompletedProposalProjection(
      proposal,
      createResult,
      treasury,
      lifecycleResult,
      "app API",
      { expectEnrichedPayout: true },
    );
    assert(
      String(proposal.contents ?? "").includes(PROPOSAL_TITLE),
      "app API lost proposal contents",
    );
    return proposal;
  });
  const appVotes = await waitFor("app API five-vote projection", async () => {
    const payload = await fetchProposalVotes(
      apiUrl,
      createResult.proposalAddress,
    );
    assertProjectedVotes(payload, treasury, "app API");
    return payload;
  });
  const appExecutions = await waitFor(
    "app API execution projection",
    async () => {
      const payload = await fetchProposalExecutions(
        apiUrl,
        createResult.proposalAddress,
      );
      assertProjectedExecution(payload, treasury, lifecycleResult, "app API");
      return payload;
    },
  );
  assert(appVotes && appExecutions, "app API projections missing");

  const receipts = await fetchJson(`${localBlockchainUrl}/admin/transactions`);
  const includedReceipts = new Map(
    (receipts.receipts ?? []).map((receipt) => [receipt.hash, receipt]),
  );
  for (const expected of expectedEvents) {
    assert(
      includedReceipts.get(expected.txHash)?.status === "included",
      `local Mina receipt ${expected.txHash} is not included`,
    );
  }
  assert(
    lifecycleResult.recipientBalanceAfter -
      lifecycleResult.recipientBalanceBefore ===
      BigInt(lifecycleResult.expectedPayoutAmount),
    "reconciled recipient balance delta mismatch",
  );
  assert(
    lifecycleResult.treasuryBalanceBefore -
      lifecycleResult.treasuryBalanceAfter ===
      BigInt(lifecycleResult.expectedPayoutAmount),
    "reconciled Treasury Owner balance delta mismatch",
  );

  const adminState = await fetchJson(`${localBlockchainUrl}/admin/state`);
  assert(
    adminState.proofsEnabled === proofsEnabled,
    "local Mina effective proof mode mismatch",
  );
  try {
    await verifyBrowserSmoke({
      title: PROPOSAL_TITLE,
      treasury,
      proposalPublicKey: createResult.proposalAddress,
      expectFullyPaid: true,
    });
  } catch (error) {
    deferredFailures.push(error);
  }
}

async function main() {
  const keepStack = process.env.COMPOSE_E2E_KEEP_STACK === "1";
  let stackEnv = {};
  let localBlockchainRuntime = null;
  let workflowError = null;
  const cleanupErrors = [];

  try {
    await mkdir(RUN_DIRECTORY, { recursive: true });
    try {
      await mkdir(TEST_DATA_DIRECTORY);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error(
          `Run data already exists for COMPOSE_E2E_RUN_ID=${RUN_ID} and PROOFS_ENABLED=${PROOF_MODE}: ${TEST_DATA_DIRECTORY}`,
        );
      }
      throw error;
    }
    await mkdir(SQLITE_DATA_DIRECTORY, { recursive: true });
    await mkdir(PROOF_ARTIFACTS_DIRECTORY, { recursive: true });
    await mkdir(CLI_WORK_DIRECTORY, { recursive: true });
    await writeFile(
      RUN_LAYOUT_FILE,
      `${JSON.stringify(
        {
          runId: RUN_ID,
          proofsEnabled,
          dataDirectory: TEST_DATA_DIRECTORY,
          sqliteDirectory: SQLITE_DATA_DIRECTORY,
          proofArtifactsDirectory: PROOF_ARTIFACTS_DIRECTORY,
          failureArtifactsDirectory: ARTIFACTS_DIRECTORY,
          localBlockchain: {
            processGroup:
              process.env.COMPOSE_E2E_ORDERED_RUN === "1"
                ? "inherited"
                : "standalone",
            entry: LOCAL_BLOCKCHAIN_ENTRY,
            typescriptProject: LOCAL_BLOCKCHAIN_TYPESCRIPT_PROJECT,
            typescriptLoader: LOCAL_BLOCKCHAIN_TYPESCRIPT_LOADER,
          },
          hostCli: {
            cwd: CLI_WORK_DIRECTORY,
            cacheDirectory: CLI_CACHE_DIRECTORY,
            cacheResolution: "process.cwd()/cache",
            entry: CLI_ENTRY,
            typescriptProject: CLI_TYPESCRIPT_PROJECT,
            typescriptLoader: CLI_TYPESCRIPT_LOADER,
            compileAndWorkersShareCacheWithinRunMode: true,
            cacheSharedAcrossRunsOrModes: false,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    log(
      `run=${RUN_ID} data=${TEST_DATA_DIRECTORY} hostCliCwd=${CLI_WORK_DIRECTORY} hostCliCache=${CLI_CACHE_DIRECTORY}`,
    );
    log(
      `host CLI entry=${CLI_ENTRY} TypeScript project=${CLI_TYPESCRIPT_PROJECT} loader=${CLI_TYPESCRIPT_LOADER}`,
    );
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
        assert(
          state.proofsEnabled === proofsEnabled,
          `local-blockchain did not start with PROOFS_ENABLED=${PROOF_MODE}`,
        );
        return state;
      },
    );

    const treasury = await deployTreasury(adminState);
    log(
      `deployed treasury owner ${treasury.deployResult.treasuryOwnerAddress} token=${treasury.stateResult.treasuryOwnerTokenId}`,
    );
    await prepareStakingLedgerProof(treasury);
    await fundVoters(treasury);
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
      NEXT_PUBLIC_BACKOFFICE_MINA_NODE_URL: `${backofficeUrl}/mina/graphql`,
      NEXT_PUBLIC_MULTISIG_PARTICIPANTS_PUBLIC_KEYS:
        treasury.multisigParticipants
          .map((participant) => participant.publicKey)
          .join(","),
      CORS_ALLOWED_ORIGINS: [
        checkHttpUrl("web URL", webUrl).origin,
        `http://localhost:${parseHostPort("PROXY_WEB_PORT", "3100")}`,
        checkHttpUrl("Backoffice URL", backofficeUrl).origin,
        `http://localhost:${parseHostPort("PROXY_BACKOFFICE_PORT", "3200")}`,
      ].join(","),
      NEXT_PUBLIC_PROOFS_ENABLED: PROOF_MODE,
      NEXT_PUBLIC_NETWORK_ID: SIGNING_NETWORK_ID,
      ARCHIVE_NODE_URL: hostArchiveUrlForContainers(),
      PROOFS_ENABLED: PROOF_MODE,
      SQLITE_DATA_HOST_PATH: SQLITE_DATA_DIRECTORY,
      SQLITE_DATA_DIRECTORY: "/data/sqlite",
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
    await verifyMinaProxyOwnerAccount(treasury);

    const createResult = await createProposal(treasury);
    activeProposalPublicKey = createResult.proposalAddress;
    log(
      `created proposal ${createResult.proposalAddress} tx=${createResult.proposalTxHash}`,
    );

    await verifyProposalPipeline({
      createResult,
      recipient: treasury.recipient,
      treasury,
    });

    const votes = await castFiveVotes(treasury, createResult);
    log(`submitted ${votes.length} yay votes through the CLI`);
    await prepareVoteReducerProof(treasury, createResult);
    const lifecycleResult = await tallyAndExecuteProposal(
      treasury,
      createResult,
    );
    await verifyCompletedLifecycle({
      treasury,
      createResult,
      votes,
      lifecycleResult,
    });

    if (deferredFailures.length > 0) {
      throw deferredFailures.at(-1);
    }

    log(
      [
        `compose e2e passed with PROOFS_ENABLED=${PROOF_MODE}`,
        "verified treasury deployment, funding, creation, five votes, Archive actions, proof preparation, tally, execution, service projections, and both browser applications.",
      ].join("\n"),
    );
  } catch (error) {
    const reportedError =
      deferredFailures.length > 0 && !deferredFailures.includes(error)
        ? new Error(
            [
              error instanceof Error
                ? (error.stack ?? error.message)
                : String(error),
              "Deferred browser smoke failures:",
              ...deferredFailures.map((failure) =>
                failure instanceof Error
                  ? (failure.stack ?? failure.message)
                  : String(failure),
              ),
            ].join("\n\n"),
          )
        : error;
    if (reportedError !== error && reportedError instanceof Error) {
      reportedError.stdout = error?.stdout;
      reportedError.stderr = error?.stderr;
    }
    await captureFailureArtifacts(
      reportedError,
      stackEnv,
      localBlockchainRuntime,
    ).catch((artifactError) => {
      console.error(
        "[compose-e2e] failed to capture failure artifacts",
        artifactError,
      );
    });
    workflowError = reportedError;
  } finally {
    if (keepStack) {
      log("leaving compose stack running because COMPOSE_E2E_KEEP_STACK=1");
      log(
        "leaving external local-blockchain running because COMPOSE_E2E_KEEP_STACK=1",
      );
    } else {
      await dockerCompose(["down", "-v"], stackEnv).catch((error) => {
        cleanupErrors.push(error);
        console.error("[compose-e2e] failed to tear down compose stack", error);
      });
      await stopLocalBlockchain(localBlockchainRuntime).catch((error) => {
        cleanupErrors.push(error);
        console.error(
          "[compose-e2e] failed to stop external local-blockchain",
          error,
        );
      });
    }
  }

  if (workflowError && cleanupErrors.length > 0) {
    throw new AggregateError(
      [workflowError, ...cleanupErrors],
      "Compose E2E workflow and cleanup failed",
    );
  }
  if (workflowError) throw workflowError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "Compose E2E cleanup failed");
  }
}

main().catch((error) => {
  console.error("[compose-e2e] failed", error);
  process.exit(1);
});
