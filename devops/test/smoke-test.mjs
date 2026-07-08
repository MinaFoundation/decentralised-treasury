const DEFAULT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_000;

const timeoutMs = Number.parseInt(
  process.env.TEST_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS),
  10,
);

function readUrlEnv(name, fallback) {
  const value = process.env[name] ?? fallback;
  return value.replace(/\/+$/u, "");
}

function log(message) {
  console.log(`[compose-smoke] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(name, probe, timeout = timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeout) {
    try {
      await probe();
      log(`${name} is ready`);
      return;
    } catch (error) {
      lastError = error;
      await sleep(POLL_INTERVAL_MS);
    }
  }

  const detail =
    lastError instanceof Error ? lastError.message : JSON.stringify(lastError);
  throw new Error(`Timed out waiting for ${name}: ${detail}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

async function expectOkJson(url) {
  const payload = await fetchJson(url);
  if (payload?.ok !== true) {
    throw new Error(`${url} did not return { ok: true }`);
  }
  return payload;
}

async function expectWeb(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  const text = await response.text();
  if (!text.includes("<html")) {
    throw new Error(`${url} did not return an HTML document`);
  }
}

const localBlockchainUrl = readUrlEnv(
  "LOCAL_BLOCKCHAIN_URL",
  "http://127.0.0.1:8080",
);
const apiUrl = readUrlEnv("API_URL", "http://127.0.0.1:4100");
const indexerApiUrl = readUrlEnv("INDEXER_API_URL", "http://127.0.0.1:4101");
const processorApiUrl = readUrlEnv(
  "PROCESSOR_API_URL",
  "http://127.0.0.1:4102",
);
const webUrl = readUrlEnv("WEB_URL", "http://127.0.0.1:3100");

await waitFor("local-blockchain health", () =>
  expectOkJson(`${localBlockchainUrl}/healthz`),
);
await waitFor("app API health", () => expectOkJson(`${apiUrl}/healthz`));
await waitFor("indexer API health", () =>
  expectOkJson(`${indexerApiUrl}/healthz`),
);
await waitFor("processor API health", () =>
  expectOkJson(`${processorApiUrl}/healthz`),
);
await waitFor("web HTTP response", () => expectWeb(webUrl));

await waitFor("indexer API status", async () => {
  const payload = await expectOkJson(`${indexerApiUrl}/status`);
  if (!payload.archive) {
    throw new Error("indexer status did not include archive heights");
  }
});

await waitFor("processor API status", async () => {
  const payload = await expectOkJson(`${processorApiUrl}/status`);
  if (typeof payload.remainingEvents !== "number") {
    throw new Error("processor status did not include remainingEvents");
  }
});

log("smoke test passed");
