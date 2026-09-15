import assert from "node:assert/strict";
import { createServer as createNetServer } from "node:net";
import test from "node:test";
import {
  startLocalBlockchainTestServer,
  type LocalBlockchainTestServer,
} from "./utils/local-blockchain-test-server.js";
import { sleep } from "./utils/cli-test-utils.js";

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() =>
          reject(new Error("Could not allocate a local port")),
        );
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForHealth(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {}
    await sleep(50);
  }
  throw new Error("Local blockchain lifecycle fixture did not become ready");
}

function assertProcessDoesNotExist(pid: number): void {
  assert.throws(
    () => process.kill(pid, 0),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ESRCH",
    `Local blockchain process ${pid} must not remain after close`,
  );
}

async function assertLifecycle(proofsEnabled: boolean): Promise<void> {
  const nodePort = await getAvailablePort();
  let archivePort = await getAvailablePort();
  while (archivePort === nodePort) archivePort = await getAvailablePort();
  const server: LocalBlockchainTestServer = startLocalBlockchainTestServer({
    nodePort,
    archivePort,
    proofsEnabled,
  });
  const pid = server.child.pid;
  assert(pid, "Local blockchain process must have a PID");
  let output = "";
  let stdoutEnded = false;
  let stderrEnded = false;
  server.child.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  server.child.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });
  server.child.stdout?.once("end", () => {
    stdoutEnded = true;
  });
  server.child.stderr?.once("end", () => {
    stderrEnded = true;
  });

  let stopped = false;
  try {
    const baseUrl = `http://127.0.0.1:${nodePort}`;
    await waitForHealth(baseUrl);
    const response = await fetch(`${baseUrl}/admin/state`, {
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 200);
    const state = (await response.json()) as { proofsEnabled: boolean };
    assert.equal(state.proofsEnabled, proofsEnabled);
    assert.match(
      output,
      new RegExp(`proofs enabled: ${String(proofsEnabled)}`, "u"),
    );

    const result = await server.stop();
    stopped = true;
    assert.equal(result.graceful, true);
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.equal(stdoutEnded, true);
    assert.equal(stderrEnded, true);
    assert.equal(server.child.stdout?.readableEnded, true);
    assert.equal(server.child.stderr?.readableEnded, true);
    assertProcessDoesNotExist(pid);
  } finally {
    if (!stopped) await server.stop();
  }
}

test(
  "direct local blockchain test server runs proof-off before proof-on and closes each process",
  { timeout: 90_000 },
  async () => {
    await assertLifecycle(false);
    await assertLifecycle(true);
  },
);
