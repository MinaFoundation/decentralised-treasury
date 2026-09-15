import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrivateKey } from "o1js";
import {
  createServiceControls,
  serviceNames,
} from "../../../../devops/test/local-e2e-services.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const loader = join(root, "packages/sdk/node_modules/ts-node/esm.mjs");
export type LocalAccount = { publicKey: string; privateKey: string };
export type AdminState = {
  proofsEnabled: boolean;
  currentSlot: number;
  submittedTransactions: number;
  testAccounts: LocalAccount[];
};

export function proofMode(): "false" | "true" {
  const value = process.env.PROOFS_ENABLED;
  if (value !== "false" && value !== "true") {
    throw new Error(
      "Set PROOFS_ENABLED to exactly false or true for this lane.",
    );
  }
  return value;
}

export async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Cannot allocate a local port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

export async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`GET ${url}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

export async function waitForUrl(url: string, timeout = 60_000): Promise<void> {
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Service did not become ready at ${url}: ${String(lastError)}`,
  );
}

export function parseCliJson<T>(output: string, key: string): T {
  for (const line of output.split(/\r?\n/).reverse()) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object" && key in value) return value as T;
    } catch {
      /* CLI logs can contain non-JSON lines. */
    }
  }
  throw new Error(`CLI output did not contain JSON field ${key}.`);
}

/** Fresh chain, keys, database and service processes for each mode and suite. */
export async function startLocalTreasuryStack(
  options: {
    startBackend?: boolean;
    withdrawalPermission?: "proof" | "proofOrSignature";
  } = {},
) {
  const mode = proofMode();
  const artifactRoot =
    process.env.E2E_ARTIFACT_DIRECTORY ??
    process.env.E2E_ARTIFACTS_DIR ??
    tmpdir();
  await mkdir(artifactRoot, { recursive: true });
  const artifactDirectory = await mkdtemp(
    join(artifactRoot, `web-stack-${mode}-`),
  );
  const cliWorkingDirectory = join(artifactDirectory, "cli-workdir");
  await mkdir(join(cliWorkingDirectory, "cache"), { recursive: true });
  const children: ChildProcess[] = [];
  const logs: Array<() => Promise<void>> = [];
  let databaseContainer: string | undefined;
  const commandTimeout = Number(
    process.env.E2E_COMMAND_TIMEOUT_MS ?? 1_800_000,
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PROOFS_ENABLED: mode,
    NODE_NO_WARNINGS: "1",
    SQLITE_DATA_DIRECTORY: join(artifactDirectory, "sqlite"),
    MINA_NETWORK_ID: "devnet",
  };
  await mkdir(env.SQLITE_DATA_DIRECTORY!, { recursive: true });

  function launch(
    name: string,
    executable: string,
    args: string[],
    cwd: string,
    extra = {},
  ) {
    console.log(
      `[local-treasury-stack] start ${name}; proofs=${mode}; artifacts=${artifactDirectory}`,
    );
    const child = spawn(executable, args, {
      cwd,
      env: { ...env, ...extra },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });
    logs.push(() =>
      writeFile(
        join(artifactDirectory, `${name}.log`),
        output.replace(/EK[A-Za-z0-9]{40,}/g, "[local private key]"),
      ),
    );
    child.once("exit", () => {
      void writeFile(
        join(artifactDirectory, `${name}.log`),
        output.replace(/EK[A-Za-z0-9]{40,}/g, "[local private key]"),
      );
    });
    return { child, output: () => output };
  }

  async function run(
    name: string,
    executable: string,
    args: string[],
    cwd = root,
    extraEnv: Partial<NodeJS.ProcessEnv> = {},
  ) {
    const running = launch(name, executable, args, cwd, extraEnv);
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        running.child.kill("SIGTERM");
        reject(
          new Error(
            `${name} timed out after ${commandTimeout}ms. Artifacts: ${artifactDirectory}`,
          ),
        );
      }, commandTimeout);
      running.child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      running.child.once("exit", (code, signal) => {
        clearTimeout(timer);
        if (code === 0) resolve(running.output());
        else
          reject(
            new Error(
              `${name} failed (${signal ?? code}). ${running
                .output()
                .slice(-4_000)
                .replace(/EK[A-Za-z0-9]{40,}/g, "[local private key]")}`,
            ),
          );
      });
    });
  }

  let cliSequence = 0;
  const serviceStarts = new Map<string, number>();
  const services = createServiceControls((entry) => {
    if (options.startBackend === false)
      throw new Error("Backend services are disabled for this fixture.");
    const attempt = (serviceStarts.get(entry) ?? 0) + 1;
    serviceStarts.set(entry, attempt);
    return launch(
      attempt === 1 ? entry : `${entry}-restart-${attempt}`,
      process.execPath,
      ["--loader", loader, `src/${entry}.ts`],
      join(root, "apps/api"),
    ).child;
  });
  const cli = (args: string[]) =>
    run(
      `cli-${++cliSequence}-${args[0]}`,
      process.execPath,
      ["--loader", loader, join(root, "apps/cli/src/cli.ts"), ...args],
      cliWorkingDirectory,
      { TS_NODE_PROJECT: join(root, "apps/cli/tsconfig.json") },
    );

  const dispose = async () => {
    for (const child of [...children].reverse()) {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGTERM");
    }
    await Promise.all(
      children.map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null)
              return resolve();
            const timer = setTimeout(() => {
              child.kill("SIGKILL");
              resolve();
            }, 5_000);
            child.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
          }),
      ),
    );
    if (databaseContainer) {
      await run("postgres-stop", "docker", [
        "stop",
        "--time",
        "5",
        databaseContainer,
      ]).catch(() => undefined);
    }
    await Promise.all(logs.map((save) => save()));
  };

  try {
    const nodePort = await availablePort();
    const archivePort = await availablePort();
    const baseUrl = `http://127.0.0.1:${nodePort}`;
    const minaNodeUrl = `${baseUrl}/graphql`;
    const archiveUrl = `http://127.0.0.1:${archivePort}/graphql`;
    Object.assign(env, {
      MINA_NODE_URL: minaNodeUrl,
      ARCHIVE_NODE_URL: archiveUrl,
    });
    launch(
      "local-blockchain",
      process.execPath,
      ["--loader", loader, "src/server.ts"],
      join(root, "packages/local-blockchain"),
      {
        MINA_NODE_PORT: String(nodePort),
        MINA_ARCHIVE_PORT: String(archivePort),
      },
    );
    await waitForUrl(`${baseUrl}/healthz`);
    const state = await readJson<AdminState>(`${baseUrl}/admin/state`);
    if (state.proofsEnabled !== (mode === "true"))
      throw new Error("The node proof mode does not match PROOFS_ENABLED.");
    const [proposer, voter1, voter2, recipient] = state.testAccounts;
    if (!proposer || !voter1 || !voter2 || !recipient)
      throw new Error("The local chain must provide four funded accounts.");
    const keypair = (): LocalAccount => {
      const key = PrivateKey.random();
      return {
        privateKey: key.toBase58(),
        publicKey: key.toPublicKey().toBase58(),
      };
    };
    const treasury = keypair();
    const pauseController = keypair();
    const participants = Array.from({ length: 5 }, keypair);
    const lifecyclePeriodDuration = "200";
    if (options.startBackend !== false) {
      const snapshotPath = join(artifactDirectory, "staking-ledger.json");
      const output = await cli([
        "staking-ledger",
        "create-development-snapshot",
        "--output-path",
        snapshotPath,
        "--treasury-owner-public-key",
        treasury.publicKey,
        ...state.testAccounts
          .slice(0, 5)
          .flatMap((account, index) => [
            `--voter-${index + 1}-public-key`,
            account.publicKey,
          ]),
      ]);
      const snapshot = JSON.parse(
        output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1),
      );
      await cli([
        "staking-ledger",
        "from-file",
        "--lifecycle-id",
        "0",
        "--staking-ledger-path",
        snapshotPath,
      ]);
      await cli([
        "staking-ledger-to-voting-ledger",
        "trace-digest",
        "--lifecycle-id",
        "0",
      ]);
      const response = await fetch(`${baseUrl}/admin/network-state`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stakingEpochDataLedgerHash: snapshot.stakingEpochDataLedgerHash,
          stakingEpochDataLedgerTotalCurrency:
            snapshot.stakingEpochDataLedgerTotalCurrency,
        }),
      });
      if (!response.ok)
        throw new Error(
          "Cannot set the initial staking snapshot on the local chain.",
        );
    }
    const compile = parseCliJson<{ browserEnv: Record<string, string> }>(
      await cli([
        "treasury-owner",
        "compile",
        "--lifecycle-period-duration",
        lifecyclePeriodDuration,
      ]),
      "browserEnv",
    );
    await cli([
      "treasury-owner",
      "deploy",
      "--sender-private-key",
      proposer.privateKey,
      "--treasury-owner-private-key",
      treasury.privateKey,
      "--pause-controller-private-key",
      pauseController.privateKey,
      "--treasury-deployed-at-slot",
      String(state.currentSlot),
      "--multisig-participants-public-keys",
      participants.map((p) => p.publicKey).join(","),
      "--lifecycle-period-duration",
      lifecyclePeriodDuration,
      "--withdrawal-permission",
      options.withdrawalPermission ?? "proof",
      "--fee",
      "100000000",
      "--wait",
      "true",
    ]);
    if (options.startBackend !== false) {
      await cli([
        "treasury-owner",
        "fund-treasury",
        "--sender-private-key",
        proposer.privateKey,
        "--treasury-owner-public-key",
        treasury.publicKey,
        "--amount",
        "100000000000",
        "--lifecycle-period-duration",
        lifecyclePeriodDuration,
        "--fee",
        "100000000",
        "--wait",
        "true",
      ]);
    }
    const apiPort = await availablePort();
    const indexerPort = await availablePort();
    const processorPort = await availablePort();
    const treasuryApiUrl = `http://127.0.0.1:${apiPort}`;
    const indexerApiUrl = `http://127.0.0.1:${indexerPort}`;
    const processorApiUrl = `http://127.0.0.1:${processorPort}`;
    const runtimeEnv: Record<string, string> = {
      ...compile.browserEnv,
      NEXT_PUBLIC_PROOFS_ENABLED: mode,
      NEXT_PUBLIC_NETWORK_ID: "DEVNET",
      NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS: treasury.publicKey,
      NEXT_PUBLIC_MULTISIG_PARTICIPANTS_PUBLIC_KEYS: participants
        .map((p) => p.publicKey)
        .join(","),
      NEXT_PUBLIC_TREASURY_API_URL: treasuryApiUrl,
      NEXT_PUBLIC_INDEXER_API_URL: indexerApiUrl,
      NEXT_PUBLIC_PROCESSOR_API_URL: processorApiUrl,
      NEXT_PUBLIC_MINA_NODE_URL: minaNodeUrl,
      NEXT_PUBLIC_SLOT_DURATION_MS: "1000",
    };
    if (options.startBackend !== false) {
      const dbPort = await availablePort();
      databaseContainer = `treasury-web-e2e-${mode}-${nodePort}`;
      await run("postgres-start", "docker", [
        "run",
        "--rm",
        "-d",
        "--name",
        databaseContainer,
        "--label",
        `treasury.local-e2e.run=${process.env.E2E_RESOURCE_ID ?? databaseContainer}`,
        "-p",
        `127.0.0.1:${dbPort}:5432`,
        "-e",
        "POSTGRES_PASSWORD=local_test_password",
        "-e",
        "POSTGRES_DB=treasury_e2e",
        "postgres:16",
      ]);
      Object.assign(env, {
        DATABASE_URL: `postgres://postgres:local_test_password@127.0.0.1:${dbPort}/treasury_e2e`,
        DATABASE_SCHEMA: "public",
        TREASURY_OWNER_CONTRACT_ADDRESS: treasury.publicKey,
        API_PORT: String(apiPort),
        API_URL: treasuryApiUrl,
        INDEXER_API_PORT: String(indexerPort),
        INDEXER_API_URL: indexerApiUrl,
        PROCESSOR_API_PORT: String(processorPort),
        PROCESSOR_API_URL: processorApiUrl,
        CORS_ALLOWED_ORIGINS: "*",
        POLL_PENDING_INTERVAL_MS: "250",
        POLL_CANONICAL_INTERVAL_MS: "250",
        PROCESSOR_POLL_INTERVAL_MS: "250",
      });
      const readyDeadline = Date.now() + 30_000;
      while (true) {
        try {
          await run("postgres-ready", "docker", [
            "exec",
            databaseContainer,
            "pg_isready",
            "-U",
            "postgres",
          ]);
          break;
        } catch (error) {
          if (Date.now() > readyDeadline) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await run(
        "migrations",
        "pnpm",
        ["run", "migration:run"],
        join(root, "apps/api"),
      );
      for (const entry of serviceNames) services.start(entry);
      await waitForUrl(`${treasuryApiUrl}/healthz`);
      await waitForUrl(`${indexerApiUrl}/healthz`);
      await waitForUrl(`http://127.0.0.1:${processorPort}/healthz`);
    }
    await writeFile(
      join(artifactDirectory, "public-stack.json"),
      JSON.stringify(
        {
          mode,
          cliWorkingDirectory,
          baseUrl,
          minaNodeUrl,
          archiveUrl,
          treasuryApiUrl,
          treasuryOwnerPublicKey: treasury.publicKey,
          participants: participants.map((p) => p.publicKey),
        },
        null,
        2,
      ),
    );
    return {
      baseUrl,
      adminUrl: `${baseUrl}/admin`,
      minaNodeUrl,
      archiveUrl,
      treasuryApiUrl,
      indexerApiUrl,
      processorApiUrl,
      treasuryOwnerPublicKey: treasury.publicKey,
      treasuryOwner: treasury,
      pauseControllerPublicKey: pauseController.publicKey,
      proposer,
      voter1,
      voter2,
      participants,
      recipientPublicKey: recipient.publicKey,
      proposalAmount: "1",
      proofsEnabled: mode === "true",
      runtimeEnv,
      artifactDirectory,
      cliWorkingDirectory,
      cli,
      services,
      dispose,
      startApp: async (app: "web" | "backoffice", port: number) => {
        launch(
          app,
          process.execPath,
          [
            join(root, `apps/${app}/node_modules/next/dist/bin/next`),
            "dev",
            "--hostname",
            "127.0.0.1",
            "--port",
            String(port),
          ],
          join(root, `apps/${app}`),
          { ...runtimeEnv, E2E_BROWSER_COVERAGE: "true" },
        );
        const url = `http://127.0.0.1:${port}`;
        await waitForUrl(url, 180_000);
        return url;
      },
    };
  } catch (error) {
    await dispose();
    throw new Error(
      `Local stack setup failed. Artifacts: ${artifactDirectory}`,
      { cause: error },
    );
  }
}

export type LocalTreasuryStack = Awaited<
  ReturnType<typeof startLocalTreasuryStack>
>;
