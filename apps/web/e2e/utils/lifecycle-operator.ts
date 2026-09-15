import { spawn, type ChildProcess } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  availablePort,
  parseCliJson,
  readJson,
  type AdminState,
  type LocalTreasuryStack,
} from "./local-treasury-stack.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

/** Documented simulator clock control. This does not change contract state. */
export async function setLifecycleSlot(
  stack: LocalTreasuryStack,
  slot: number,
) {
  const before = await readJson<AdminState>(`${stack.baseUrl}/admin/state`);
  if (slot < before.currentSlot)
    throw new Error("The lifecycle clock must advance.");
  const response = await fetch(`${stack.baseUrl}/admin/slot/set`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slot }),
  });
  if (!response.ok) throw new Error(`Cannot set slot: HTTP ${response.status}`);
  const after = await readJson<AdminState>(`${stack.baseUrl}/admin/state`);
  if (
    after.currentSlot !== slot ||
    after.submittedTransactions !== before.submittedTransactions
  )
    throw new Error("Clock control unexpectedly changed transaction state.");
}

async function command(executable: string, args: string[]) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(output) : reject(new Error(output));
    });
  });
}

async function stopWorker(worker: ChildProcess) {
  if (worker.exitCode !== null || worker.signalCode !== null) return;
  worker.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      worker.kill("SIGKILL");
    }, 5_000);
    worker.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Real CLI queue worker and Redis. Only operator proof preparation and tally run here. */
export async function tallyBrowserVotes(
  stack: LocalTreasuryStack,
  proposal: string,
  lifecycleId = "0",
) {
  if (!/^(0|[1-9][0-9]*)$/.test(lifecycleId))
    throw new Error("Lifecycle ID must be a non-negative integer.");
  const port = await availablePort();
  const name = `treasury-web-votes-${port}`;
  const queueArgs = [
    "--redis-host",
    "127.0.0.1",
    "--redis-port",
    String(port),
    "--queue-name",
    name,
  ];
  const prefix = lifecycleId === "0" ? "" : `lifecycle-${lifecycleId}-`;
  const stakingProof = join(
    stack.artifactDirectory,
    `${prefix}staking-exhausted.json`,
  );
  const voteActions = join(
    stack.artifactDirectory,
    `${prefix}browser-vote-actions.json`,
  );
  const voteProof = join(
    stack.artifactDirectory,
    `${prefix}browser-vote-reducer.json`,
  );
  let worker: ChildProcess | undefined;
  let workerLog = "";
  await command("docker", [
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "--label",
    `treasury.local-e2e.run=${process.env.E2E_RESOURCE_ID ?? name}`,
    "-p",
    `127.0.0.1:${port}:6379`,
    "redis:7-alpine",
  ]);
  try {
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        await command("docker", ["exec", name, "redis-cli", "ping"]);
        break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    worker = spawn(
      process.execPath,
      [
        "--loader",
        join(root, "packages/sdk/node_modules/ts-node/esm.mjs"),
        join(root, "apps/cli/src/cli.ts"),
        "worker",
        "start",
        ...queueArgs,
      ],
      {
        cwd: stack.cliWorkingDirectory,
        env: {
          ...process.env,
          PROOFS_ENABLED: String(stack.proofsEnabled),
          NODE_NO_WARNINGS: "1",
          TS_NODE_PROJECT: join(root, "apps/cli/tsconfig.json"),
          SQLITE_DATA_DIRECTORY: join(stack.artifactDirectory, "sqlite"),
          MINA_NODE_URL: stack.minaNodeUrl,
          ARCHIVE_NODE_URL: stack.archiveUrl,
          MINA_NETWORK_ID: "devnet",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    worker.stdout?.on("data", (chunk) => {
      workerLog += chunk;
    });
    worker.stderr?.on("data", (chunk) => {
      workerLog += chunk;
    });
    await stack.cli(["staking-ledger-to-voting-ledger", "compile"]);
    for (const action of ["prove-digest", "prove-merge"]) {
      await stack.cli([
        "staking-ledger-to-voting-ledger",
        action,
        "--lifecycle-id",
        lifecycleId,
        ...queueArgs,
      ]);
    }
    await stack.cli([
      "staking-ledger-to-voting-ledger",
      "prove-exhaust",
      "--lifecycle-id",
      lifecycleId,
      "--proof-output-path",
      stakingProof,
    ]);
    const fetched = parseCliJson<{ count: number }>(
      await stack.cli([
        "proposal",
        "fetch-actions",
        "--archive-node-url",
        stack.archiveUrl,
        "--treasury-owner-public-key",
        stack.treasuryOwnerPublicKey,
        "--proposal-public-key",
        proposal,
        "--output-path",
        voteActions,
      ]),
      "count",
    );
    if (fetched.count !== 5)
      throw new Error(
        `Expected five browser vote actions, got ${fetched.count}.`,
      );
    await stack.cli(["vote-reducer", "compile"]);
    await stack.cli([
      "vote-reducer",
      "trace-run-batch",
      "--lifecycle-id",
      lifecycleId,
      "--vote-actions-path",
      voteActions,
    ]);
    await stack.cli([
      "vote-reducer",
      "prove-run-batch",
      "--lifecycle-id",
      lifecycleId,
      ...queueArgs,
    ]);
    await stack.cli([
      "vote-reducer",
      "prove-merge",
      "--lifecycle-id",
      lifecycleId,
      ...queueArgs,
      "--proof-output-path",
      voteProof,
    ]);
    return parseCliJson<{ tallyTxHash: string }>(
      await stack.cli([
        "proposal",
        "tally-votes",
        "--sender-private-key",
        stack.proposer.privateKey,
        "--treasury-owner-public-key",
        stack.treasuryOwnerPublicKey,
        "--proposal-public-key",
        proposal,
        "--vote-reducer-proof-path",
        voteProof,
        "--staking-ledger-to-voting-ledger-proof-path",
        stakingProof,
        "--lifecycle-id",
        lifecycleId,
        "--lifecycle-period-duration",
        "200",
        "--fee",
        "100000000",
        "--wait",
        "true",
      ]),
      "tallyTxHash",
    );
  } finally {
    if (worker) await stopWorker(worker);
    await command("docker", ["stop", "--time", "5", name]);
    await writeFile(
      join(stack.artifactDirectory, `${prefix}lifecycle-worker.log`),
      workerLog.replace(/EK[A-Za-z0-9]{40,}/g, "[local private key]"),
    );
  }
}
