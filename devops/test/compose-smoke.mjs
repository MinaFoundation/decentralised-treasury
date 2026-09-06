import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const COMPOSE_PROJECT_NAME =
  process.env.COMPOSE_TEST_PROJECT_NAME ?? "decentralized-treasury-smoke";
const CLI_TIMEOUT_MS = 900_000;
const COMPOSE_UP_BUILD_ARG =
  process.env.COMPOSE_TEST_NO_BUILD === "1" ? "--no-build" : "--build";

function log(message) {
  console.log(`[compose-smoke] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseHostPort(name, fallback) {
  const rawPort = process.env[name] ?? fallback;
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return port;
}

function run(command, args, options = {}) {
  const timeout = options.timeoutMs ?? CLI_TIMEOUT_MS;
  const label = options.label ?? [command, ...args].join(" ");
  return new Promise((resolve, reject) => {
    log(`running ${label}`);
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: "1",
        ...options.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);

    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
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
        resolve();
        return;
      }
      reject(
        new Error(
          `${label} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`,
        ),
      );
    });
  });
}

async function fetchOkJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  const payload = await response.json();
  if (payload?.ok !== true) {
    throw new Error(`${url} did not return { ok: true }`);
  }
  return payload;
}

async function waitFor(name, probe, timeoutMs = 120_000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await probe();
      log(`${name} is ready`);
      return result;
    } catch (error) {
      lastError = error;
      await sleep(1_000);
    }
  }
  const detail =
    lastError instanceof Error ? lastError.message : JSON.stringify(lastError);
  throw new Error(`Timed out waiting for ${name}: ${detail}`);
}

function startLocalBlockchain() {
  const env = {
    ...process.env,
    NODE_NO_WARNINGS: "1",
    MINA_NODE_HOST: "0.0.0.0",
    MINA_NODE_PORT: String(parseHostPort("MINA_NODE_PORT", "8080")),
    MINA_ARCHIVE_PORT: String(parseHostPort("MINA_ARCHIVE_PORT", "8282")),
    MINA_NETWORK_ID: "LOCALNET",
    PROOFS_ENABLED: "false",
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
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function stopLocalBlockchain(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  log("stopping external local-blockchain");
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    if (!child.pid) {
      throw new Error("local-blockchain process did not expose a pid");
    }
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
      if (!child.pid) {
        throw new Error("local-blockchain process did not expose a pid");
      }
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    await exited;
  }
}

function composeEnv() {
  const nodePort = parseHostPort("MINA_NODE_PORT", "8080");
  const archivePort = parseHostPort("MINA_ARCHIVE_PORT", "8282");
  const proxyWebPort = parseHostPort("PROXY_WEB_PORT", "3100");
  const proxyApiPort = parseHostPort("PROXY_API_PORT", "4100");
  const proxyIndexerPort = parseHostPort("PROXY_INDEXER_PORT", "4101");
  const proxyProcessorPort = parseHostPort("PROXY_PROCESSOR_PORT", "4102");
  const postgresUser = "postgres";
  const postgresPassword = "compose_smoke_postgres";
  const postgresDb = "treasury_api";
  return {
    POSTGRES_USER: postgresUser,
    POSTGRES_PASSWORD: postgresPassword,
    POSTGRES_DB: postgresDb,
    DATABASE_URL: `postgres://${postgresUser}:${postgresPassword}@postgres:5432/${postgresDb}`,
    DATABASE_SCHEMA: "public",
    ARCHIVE_NODE_URL: `http://host.docker.internal:${archivePort}/graphql`,
    TREASURY_OWNER_CONTRACT_ADDRESS:
      "B62qpExe8CAaGkR4HRxyXvkziQpE6Aq3U71MJLHivP8pCsiDk1BbU9Z",
    NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS:
      "B62qpExe8CAaGkR4HRxyXvkziQpE6Aq3U71MJLHivP8pCsiDk1BbU9Z",
    NEXT_PUBLIC_MINA_NODE_URL: `http://127.0.0.1:${nodePort}/graphql`,
    NEXT_PUBLIC_TREASURY_API_URL: `http://127.0.0.1:${proxyApiPort}`,
    NEXT_PUBLIC_INDEXER_API_URL: `http://127.0.0.1:${proxyIndexerPort}`,
    NEXT_PUBLIC_PROCESSOR_API_URL: `http://127.0.0.1:${proxyProcessorPort}`,
    CORS_ALLOWED_ORIGINS: `http://127.0.0.1:${proxyWebPort},http://localhost:${proxyWebPort}`,
    NEXT_PUBLIC_PROOFS_ENABLED: "false",
    NEXT_PUBLIC_NETWORK_ID: "LOCALNET",
    PROOFS_ENABLED: "false",
  };
}

async function dockerCompose(args, env) {
  await run(
    "docker",
    [
      "compose",
      "-p",
      COMPOSE_PROJECT_NAME,
      "-f",
      "devops/compose.yml",
      "--profile",
      "proxy",
      ...args,
    ],
    {
      env,
      label: `docker compose ${args.join(" ")}`,
    },
  );
}

async function main() {
  let localBlockchain = null;
  const env = composeEnv();
  try {
    await dockerCompose(["down", "-v"], env).catch(() => null);
    localBlockchain = startLocalBlockchain();
    await waitFor("external local-blockchain health", () =>
      fetchOkJson(
        `http://127.0.0.1:${parseHostPort("MINA_NODE_PORT", "8080")}/healthz`,
      ),
    );
    await dockerCompose(
      [
        "up",
        COMPOSE_UP_BUILD_ARG,
        "--wait",
        "-d",
        "postgres",
        "api",
        "indexer-api",
        "processor-api",
        "indexer",
        "processor",
        "web",
        "reverse-proxy",
      ],
      env,
    );
    await run("node", ["devops/test/smoke-test.mjs"], {
      env: {
        API_URL: `http://127.0.0.1:${parseHostPort("PROXY_API_PORT", "4100")}`,
        INDEXER_API_URL: `http://127.0.0.1:${parseHostPort(
          "PROXY_INDEXER_PORT",
          "4101",
        )}`,
        PROCESSOR_API_URL: `http://127.0.0.1:${parseHostPort(
          "PROXY_PROCESSOR_PORT",
          "4102",
        )}`,
        WEB_URL: `http://127.0.0.1:${parseHostPort("PROXY_WEB_PORT", "3100")}`,
        LOCAL_BLOCKCHAIN_URL: `http://127.0.0.1:${parseHostPort(
          "MINA_NODE_PORT",
          "8080",
        )}`,
      },
      label: "compose smoke probes",
      timeoutMs: 120_000,
    });
  } finally {
    await dockerCompose(["down", "-v"], env).catch((error) => {
      console.error("[compose-smoke] failed to tear down compose stack", error);
    });
    await stopLocalBlockchain(localBlockchain).catch((error) => {
      console.error(
        "[compose-smoke] failed to stop external local-blockchain",
        error,
      );
    });
  }
}

main().catch((error) => {
  console.error("[compose-smoke] failed", error);
  process.exit(1);
});
