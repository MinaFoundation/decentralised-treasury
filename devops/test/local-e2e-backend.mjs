import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createServiceControls, serviceNames } from "./local-e2e-services.mjs";
import { TEST_CONTAINER_LABEL } from "./local-e2e-process.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const apiDirectory = join(root, "apps/api");
const loader = join(root, "packages/sdk/node_modules/ts-node/esm.mjs");

async function availablePort() {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function positiveTimeout(value, name) {
  assert.ok(
    Number.isSafeInteger(value) && value > 0,
    `${name} must be a positive integer`,
  );
  return value;
}

function endpoint(value, name) {
  const url = new URL(value);
  assert.ok(
    ["http:", "https:"].includes(url.protocol),
    `${name} must be HTTP(S)`,
  );
  assert.ok(
    !url.username && !url.password,
    `${name} must not contain credentials`,
  );
  return url.href;
}

/** Injectable process boundaries support focused tests without a chain or Docker. */
export function createLocalE2EBackendLauncher(dependencies = {}) {
  const launchChild = dependencies.spawn ?? spawn;
  const request = dependencies.fetch ?? fetch;
  const allocatePort = dependencies.availablePort ?? availablePort;

  return async function startLocalE2EBackend(options) {
    assert.equal(
      typeof options.proofsEnabled,
      "boolean",
      "proofsEnabled must be an explicit boolean",
    );
    assert.ok(
      isAbsolute(options.runDirectory),
      "runDirectory must be absolute",
    );
    assert.match(
      options.treasuryOwnerPublicKey,
      /^B62[1-9A-HJ-NP-Za-km-z]{52}$/,
      "Invalid Treasury Owner public key",
    );
    const minaNodeUrl = endpoint(options.minaNodeUrl, "minaNodeUrl");
    const archiveNodeUrl = endpoint(options.archiveNodeUrl, "archiveNodeUrl");
    const mode = String(options.proofsEnabled);
    const inherited = { ...process.env, ...options.env };
    if (inherited.PROOFS_ENABLED !== undefined)
      assert.equal(
        inherited.PROOFS_ENABLED,
        mode,
        "PROOFS_ENABLED differs from proofsEnabled",
      );
    const startupTimeoutMs = positiveTimeout(
      options.startupTimeoutMs ?? 90_000,
      "startupTimeoutMs",
    );
    const commandTimeoutMs = positiveTimeout(
      options.commandTimeoutMs ?? 60_000,
      "commandTimeoutMs",
    );
    const resourceId =
      options.resourceId ??
      inherited.E2E_RESOURCE_ID ??
      `backend-${mode}-${randomBytes(8).toString("hex")}`;
    assert.match(resourceId, /^[a-zA-Z0-9_-]+$/, "Invalid backend resource ID");
    await mkdir(options.runDirectory, { recursive: true });
    const artifactDirectory = await mkdtemp(
      join(options.runDirectory, `backend-${mode}-`),
    );
    const sqliteDirectory = join(artifactDirectory, "sqlite");
    await mkdir(sqliteDirectory);
    const container = `treasury-backend-${mode}-${randomBytes(8).toString("hex")}`;
    const password = randomBytes(24).toString("hex");
    const env = {
      ...inherited,
      PROOFS_ENABLED: mode,
      MINA_NETWORK_ID: inherited.MINA_NETWORK_ID ?? "devnet",
      MINA_NODE_URL: minaNodeUrl,
      ARCHIVE_NODE_URL: archiveNodeUrl,
      TREASURY_OWNER_CONTRACT_ADDRESS: options.treasuryOwnerPublicKey,
      SQLITE_DATA_DIRECTORY: sqliteDirectory,
      TS_NODE_PROJECT: join(apiDirectory, "tsconfig.json"),
      NODE_NO_WARNINGS: "1",
      DATABASE_SCHEMA: "public",
      CORS_ALLOWED_ORIGINS: "*",
      POLL_PENDING_INTERVAL_MS: "250",
      POLL_CANONICAL_INTERVAL_MS: "250",
      PROCESSOR_POLL_INTERVAL_MS: "250",
      E2E_RESOURCE_ID: resourceId,
    };
    const secrets = [
      password,
      ...Object.entries(env)
        .filter(
          ([key, value]) =>
            /secret|token|password|private.*key|database_url/i.test(key) &&
            typeof value === "string" &&
            value.length >= 4,
        )
        .map(([, value]) => value),
    ];
    function redact(value) {
      let text = String(value).replace(
        /EK[A-Za-z0-9]{40,}/g,
        "[private key redacted]",
      );
      for (const secret of secrets)
        text = text.split(secret).join("[redacted]");
      return text.replace(
        /postgres(?:ql)?:\/\/[^@\s]+@/g,
        "postgres://[redacted]@",
      );
    }

    function safeError(error) {
      if (error instanceof AggregateError)
        return new AggregateError(
          error.errors.map(safeError),
          redact(error.message),
        );
      // Spawn errors can contain the complete Docker argument list. Do not retain it.
      return new Error(redact(error instanceof Error ? error.message : error));
    }

    const children = new Set();
    const logs = [];
    const starts = new Map();
    let commandSequence = 0;
    let containerAttempted = false;
    let disposePromise;
    let disposed = false;
    const active = (child) =>
      child.exitCode === null && child.signalCode === null;

    function launch(name, executable, args) {
      const stream = createWriteStream(join(artifactDirectory, `${name}.log`), {
        flags: "wx",
        mode: 0o600,
      });
      let pending = "";
      let droppingLine = false;
      let output = "";
      let logBytes = 0;
      let truncated = false;
      let logError;
      stream.on("error", (error) => {
        logError = error;
      });
      const append = (line) => {
        const safe = redact(line);
        if (logBytes + Buffer.byteLength(safe) <= 4_194_304) {
          stream.write(safe);
          logBytes += Buffer.byteLength(safe);
        } else if (!truncated) {
          stream.write("[log limit reached; later output omitted]\n");
          truncated = true;
        }
        output = (output + safe).slice(-1_000_000);
      };
      const consume = (chunk) => {
        pending += chunk.toString();
        let newline;
        while ((newline = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, newline + 1);
          pending = pending.slice(newline + 1);
          if (!droppingLine) append(line);
          droppingLine = false;
        }
        if (pending.length > 65_536) {
          if (!droppingLine) append("[oversized log line omitted]\n");
          pending = "";
          droppingLine = true;
        }
      };
      let child;
      try {
        child = launchChild(executable, args, {
          cwd: apiDirectory,
          env: { ...env },
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        stream.end();
        throw error;
      }
      children.add(child);
      child.stdout?.on("data", consume);
      child.stderr?.on("data", consume);
      let spawnError;
      child.once("error", (error) => {
        spawnError = error;
      });
      const finished = new Promise((resolve) =>
        child.once("close", () => {
          if (!droppingLine) append(pending);
          stream.end(resolve);
        }),
      );
      logs.push(finished);
      return {
        child,
        output: () => output,
        error: () => spawnError ?? logError,
      };
    }

    async function run(name, executable, args, timeoutMs = commandTimeoutMs) {
      const running = launch(`${name}-${++commandSequence}`, executable, args);
      let timer;
      let killTimer;
      let timedOut = false;
      return await new Promise((resolve, reject) => {
        const finish = (error, value) => {
          clearTimeout(timer);
          clearTimeout(killTimer);
          error ? reject(safeError(error)) : resolve(value);
        };
        running.child.once("error", (error) => finish(error));
        running.child.once("close", (code, signal) => {
          if (timedOut)
            return finish(new Error(`${name} timed out after ${timeoutMs}ms`));
          if (running.error()) return finish(running.error());
          if (code !== 0)
            return finish(
              new Error(
                `${name} failed (${signal ?? code}): ${running.output().slice(-4_000)}`,
              ),
            );
          finish(undefined, running.output());
        });
        timer = setTimeout(() => {
          timedOut = true;
          running.child.kill("SIGTERM");
          killTimer = setTimeout(() => {
            running.child.kill("SIGKILL");
            finish(new Error(`${name} did not stop after its timeout`));
          }, 5_000);
        }, timeoutMs);
      });
    }

    const serviceProcesses = new Map();
    const services = createServiceControls((name) => {
      if (disposed) throw new Error("Backend fixture is disposed");
      const attempt = (starts.get(name) ?? 0) + 1;
      starts.set(name, attempt);
      const running = launch(`${name}-${attempt}`, process.execPath, [
        "--loader",
        loader,
        join(apiDirectory, "src", `${name}.ts`),
      ]);
      serviceProcesses.set(name, running);
      return running.child;
    });

    const dispose = () =>
      (disposePromise ??= (async () => {
        disposed = true;
        const errors = [];
        const results = await Promise.allSettled(
          [...serviceNames].reverse().map((name) => services.stop(name)),
        );
        errors.push(
          ...results
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason),
        );
        for (const child of children) if (active(child)) child.kill("SIGKILL");
        if (containerAttempted) {
          try {
            const label = await run("postgres-owner", "docker", [
              "inspect",
              "--format",
              `{{ index .Config.Labels "${TEST_CONTAINER_LABEL}" }}`,
              container,
            ]);
            assert.equal(
              label.trim(),
              resourceId,
              "Refusing to remove another run's database",
            );
            await run("postgres-stop", "docker", ["rm", "--force", container]);
          } catch (error) {
            if (!/No such (object|container)/i.test(String(error)))
              errors.push(error);
          }
        }
        let logTimer;
        try {
          await Promise.race([
            Promise.all(logs),
            new Promise((_, reject) => {
              logTimer = setTimeout(
                () => reject(new Error("Backend logs did not close")),
                10_000,
              );
            }),
          ]);
        } catch (error) {
          errors.push(error);
        } finally {
          clearTimeout(logTimer);
        }
        if (errors.length)
          throw new AggregateError(
            errors.map(safeError),
            "Backend cleanup failed",
          );
      })());

    try {
      const ports = new Set();
      for (let attempt = 0; ports.size < 3 && attempt < 20; attempt++) {
        const port = await allocatePort();
        assert.ok(
          Number.isSafeInteger(port) && port > 0 && port <= 65_535,
          "Invalid backend port",
        );
        ports.add(port);
      }
      assert.equal(ports.size, 3, "Could not allocate distinct backend ports");
      const [apiPort, indexerPort, processorPort] = [...ports];
      const appApiUrl = `http://127.0.0.1:${apiPort}`;
      const indexerApiUrl = `http://127.0.0.1:${indexerPort}`;
      const processorApiUrl = `http://127.0.0.1:${processorPort}`;
      Object.assign(env, {
        API_PORT: String(apiPort),
        API_URL: appApiUrl,
        INDEXER_API_PORT: String(indexerPort),
        INDEXER_API_URL: indexerApiUrl,
        PROCESSOR_API_PORT: String(processorPort),
        PROCESSOR_API_URL: processorApiUrl,
      });
      containerAttempted = true;
      await run("postgres-start", "docker", [
        "run",
        "--rm",
        "-d",
        "--name",
        container,
        "--label",
        `${TEST_CONTAINER_LABEL}=${resourceId}`,
        "-p",
        "127.0.0.1::5432",
        "-e",
        `POSTGRES_PASSWORD=${password}`,
        "-e",
        "POSTGRES_DB=treasury_e2e",
        "postgres:16",
      ]);
      const mapping = await run("postgres-port", "docker", [
        "port",
        container,
        "5432/tcp",
      ]);
      const match = /^127\.0\.0\.1:(\d+)\s*$/.exec(mapping);
      assert.ok(
        match && Number(match[1]) > 0 && Number(match[1]) <= 65_535,
        "Invalid isolated PostgreSQL port mapping",
      );
      env.DATABASE_URL = `postgres://postgres:${password}@127.0.0.1:${match[1]}/treasury_e2e`;
      const deadline = Date.now() + startupTimeoutMs;
      let lastError;
      let databaseReady = false;
      while (Date.now() < deadline) {
        try {
          await run(
            "postgres-ready",
            "docker",
            ["exec", container, "pg_isready", "-U", "postgres"],
            Math.max(1, Math.min(commandTimeoutMs, deadline - Date.now())),
          );
          lastError = undefined;
          databaseReady = true;
          break;
        } catch (error) {
          lastError = error;
        }
        await delay(100);
      }
      if (!databaseReady)
        throw new Error(`PostgreSQL readiness timed out: ${redact(lastError)}`);
      await run("migrations", process.execPath, [
        "--loader",
        loader,
        join(apiDirectory, "node_modules/typeorm/cli.js"),
        "-d",
        join(apiDirectory, "src/db/typeorm-cli-data-source.ts"),
        "migration:run",
      ]);
      for (const name of serviceNames) services.start(name);
      const readyDeadline = Date.now() + startupTimeoutMs;
      const pending = new Set([appApiUrl, indexerApiUrl, processorApiUrl]);
      while (pending.size && Date.now() < readyDeadline) {
        for (const [name, running] of serviceProcesses) {
          if (running.error() || !active(running.child))
            throw new Error(
              `${name} stopped before backend readiness: ${running.error() ?? running.output().slice(-4_000)}`,
            );
        }
        await Promise.all(
          [...pending].map(async (url) => {
            try {
              const response = await request(`${url}/readyz`, {
                signal: AbortSignal.timeout(
                  Math.max(1, Math.min(5_000, readyDeadline - Date.now())),
                ),
              });
              if (response.ok) pending.delete(url);
              else lastError = `${url}/readyz: HTTP ${response.status}`;
            } catch (error) {
              lastError = error;
            }
          }),
        );
        if (pending.size) await delay(100);
      }
      if (pending.size)
        throw new Error(`Backend readiness timed out: ${redact(lastError)}`);
      for (const [name, running] of serviceProcesses) {
        if (running.error() || !active(running.child))
          throw new Error(
            `${name} stopped before backend readiness: ${running.error() ?? running.output().slice(-4_000)}`,
          );
      }
      const result = {
        appApiUrl,
        indexerApiUrl,
        processorApiUrl,
        artifactDirectory,
        sqliteDirectory,
        resourceId,
        services,
        dispose,
      };
      await writeFile(
        join(artifactDirectory, "public-backend.json"),
        JSON.stringify(
          {
            proofsEnabled: options.proofsEnabled,
            minaNodeUrl,
            archiveNodeUrl,
            treasuryOwnerPublicKey: options.treasuryOwnerPublicKey,
            appApiUrl,
            indexerApiUrl,
            processorApiUrl,
            artifactDirectory,
            sqliteDirectory,
            resourceId,
          },
          null,
          2,
        ) + "\n",
      );
      return result;
    } catch (error) {
      try {
        await dispose();
      } catch (cleanupError) {
        throw new AggregateError(
          [safeError(error), safeError(cleanupError)],
          `Backend startup and cleanup failed. Logs: ${artifactDirectory}`,
        );
      }
      throw new Error(`${redact(error)}. Logs: ${artifactDirectory}`, {
        cause: safeError(error),
      });
    }
  };
}

/** Start real services for an existing deployment. This function does not submit Mina transactions. */
export const startLocalE2EBackend = createLocalE2EBackendLauncher();
