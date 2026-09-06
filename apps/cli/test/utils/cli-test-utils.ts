import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

export const CLI_ENTRY_PATH = fileURLToPath(
  new URL("../../src/cli.ts", import.meta.url),
);
export const CLI_PACKAGE_DIRECTORY = fileURLToPath(
  new URL("../..", import.meta.url),
);
export const SDK_PACKAGE_DIRECTORY = fileURLToPath(
  new URL("../../../../packages/sdk", import.meta.url),
);
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const MINA_NODE_URL =
  process.env.MINA_NODE_URL ?? "http://127.0.0.1:8080/graphql";
export const ARCHIVE_NODE_URL =
  process.env.ARCHIVE_NODE_URL ?? "http://127.0.0.1:8282";
export const LIGHTNET_ACCOUNT_MANAGER_ENDPOINT =
  process.env.LIGHTNET_ACCOUNT_MANAGER_ENDPOINT ?? "http://127.0.0.1:8181";
export const SLOT_TIME_MS = readNumberEnv("SLOT_TIME_MS", 3000);

interface RunCliOptions {
  cwd?: string;
  envOverrides?: Record<string, string>;
  timeoutMs?: number;
  streamOutput?: boolean;
  streamLabel?: string;
}

interface SpawnCliWorkerOptions {
  cwd?: string;
  redisHost: string;
  redisPort: number;
  stdio?: "pipe" | "inherit";
  envOverrides?: Record<string, string>;
}

export function logTestStep(
  testName: string,
  message: string,
  details?: unknown,
): void {
  const timestamp = new Date().toISOString();
  if (details === undefined) {
    console.log(`[${testName} ${timestamp}] ${message}`);
    return;
  }
  console.log(`[${testName} ${timestamp}] ${message}`, details);
}

function writeStreamChunk(
  chunk: string,
  stream: NodeJS.WriteStream,
  streamLabel: string | undefined,
  channel: "stdout" | "stderr",
): void {
  if (!streamLabel) {
    stream.write(chunk);
    return;
  }

  const prefix = `[${streamLabel}:${channel}] `;
  const prefixedChunk = chunk
    .split("\n")
    .map((line, index, lines) => {
      if (line.length === 0 && index === lines.length - 1) {
        return "";
      }
      return `${prefix}${line}`;
    })
    .join("\n");
  stream.write(prefixedChunk);
}

export async function runCli(
  args: string[],
  options: RunCliOptions = {},
): Promise<string> {
  const cwd = options.cwd ?? CLI_PACKAGE_DIRECTORY;
  const envOverrides = options.envOverrides ?? {};
  const timeoutMs = options.timeoutMs ?? 180_000;
  const streamOutput = options.streamOutput ?? false;
  const streamLabel = options.streamLabel;

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(
      "node",
      ["--loader", "ts-node/esm", CLI_ENTRY_PATH, ...args],
      {
        cwd,
        env: {
          ...process.env,
          NODE_NO_WARNINGS: "1",
          ...envOverrides,
        },
      },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;
    child.stdout.on("data", (chunk) => {
      const output = chunk.toString();
      stdout += output;
      if (streamOutput) {
        writeStreamChunk(output, process.stdout, streamLabel, "stdout");
      }
    });
    child.stderr.on("data", (chunk) => {
      const output = chunk.toString();
      stderr += output;
      if (streamOutput) {
        writeStreamChunk(output, process.stderr, streamLabel, "stderr");
      }
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(
        new Error(
          `CLI timed out after ${timeoutMs}ms: node --loader ts-node/esm ${CLI_ENTRY_PATH} ${args.join(
            " ",
          )}\n${stdout}\n${stderr}`,
        ),
      );
    }, timeoutMs);

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(`${stdout}\n${stderr}`);
        return;
      }
      reject(new Error(`CLI exited with code ${code}: ${stderr}`));
    });
  });
}

export function spawnCliWorker(
  queueName: string,
  options: SpawnCliWorkerOptions,
): ChildProcess {
  const cwd = options.cwd ?? CLI_PACKAGE_DIRECTORY;
  const { redisHost, redisPort } = options;
  const stdio = options.stdio ?? "pipe";
  const envOverrides = options.envOverrides ?? {};

  return spawn(
    "node",
    [
      "--loader",
      "ts-node/esm",
      CLI_ENTRY_PATH,
      "worker",
      "start",
      "--queue-name",
      queueName,
      "--redis-host",
      redisHost,
      "--redis-port",
      String(redisPort),
    ],
    {
      cwd,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: "1",
        ...envOverrides,
      },
      stdio,
    },
  );
}

export async function waitForOutput(
  child: ChildProcess,
  expectedFragment: string,
  timeoutMs: number,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let output = "";

    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(expectedFragment)) {
        cleanup();
        resolve(output);
      }
    };

    const onExit = (code: number | null) => {
      cleanup();
      reject(
        new Error(`Process exited early with code ${String(code)}: ${output}`),
      );
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for output containing "${expectedFragment}". Current output: ${output}`,
        ),
      );
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", onExit);
  });
}

export async function waitForExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for process exit"));
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function ensureLightnetReady(
  timeoutMs = 600_000,
): Promise<ChildProcess | undefined> {
  // Always start from a clean lightnet state for deterministic e2e runs.
  await runLightnetStopForcefully();

  const lightnetStartCommandArgs = [
    "--filter",
    "@repo/sdk",
    "exec",
    "zkapp-cli",
    "lightnet",
    "start",
    "--mina-branch",
    "mesa",
    "--slot-time",
    String(SLOT_TIME_MS),
  ];

  const lightnetStartProcess = spawn("pnpm", lightnetStartCommandArgs, {
    cwd: REPO_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });

  let lightnetOutput = "";
  lightnetStartProcess.stdout?.on("data", (chunk) => {
    lightnetOutput += chunk.toString();
  });
  lightnetStartProcess.stderr?.on("data", (chunk) => {
    lightnetOutput += chunk.toString();
  });

  const status = await waitForLightnetReadyOrExit(
    lightnetStartProcess,
    timeoutMs,
  );
  if (status === "ready") {
    return lightnetStartProcess;
  }

  const output = lightnetOutput.trim();
  const dockerHint = looksLikeDockerNotRunning(output)
    ? "\nDocker does not appear to be running. Start Docker Desktop (or the Docker daemon) and retry."
    : "";
  const reason =
    status === "exited"
      ? `Lightnet start process exited early with code ${String(lightnetStartProcess.exitCode)}.`
      : "Lightnet did not become ready within timeout.";
  throw new Error(
    `${reason}${dockerHint}\nTry running 'pnpm --filter @repo/sdk run lightnet:start' manually.\n${output}`,
  );
}

async function runLightnetStopForcefully(): Promise<void> {
  try {
    await runLightnetStop();
  } catch {
    // Best-effort stop; continue with docker-level cleanup below.
  }

  try {
    const containerIds = await getLightnetContainerIds();
    await Promise.all(
      containerIds.map((id) =>
        runCommand("docker", ["rm", "-f", id], { rejectOnFailure: false }),
      ),
    );
  } catch {
    // Best-effort cleanup only.
  }
}

async function runLightnetStop(): Promise<void> {
  await runCommand(
    "pnpm",
    ["--filter", "@repo/sdk", "exec", "zkapp-cli", "lightnet", "stop"],
    { rejectOnFailure: true },
  );
}

async function getLightnetContainerIds(): Promise<string[]> {
  const output = await runCommand(
    "docker",
    ["ps", "--filter", "name=lightnet", "--format", "{{.ID}}"],
    { rejectOnFailure: false },
  );
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function runCommand(
  command: string,
  args: string[],
  options: { rejectOnFailure: boolean },
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: { ...process.env },
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (options.rejectOnFailure) {
        reject(error);
        return;
      }
      resolve("");
    });

    child.on("close", (code) => {
      if (code === 0 || !options.rejectOnFailure) {
        resolve(stdout);
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed: ${stderr}`));
    });
  });
}

export async function getCurrentGlobalSlot(): Promise<number> {
  const response = await fetch(MINA_NODE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `
        query GetCurrentSlot {
          bestChain(maxLength: 1) {
            protocolState {
              consensusState {
                slotSinceGenesis
              }
            }
          }
        }
      `,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to query slot: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: {
      bestChain?: Array<{
        protocolState?: {
          consensusState?: {
            slotSinceGenesis?: string;
          };
        };
      }>;
    };
    errors?: { message: string }[];
  };

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  const slotValue =
    payload.data?.bestChain?.[0]?.protocolState?.consensusState
      ?.slotSinceGenesis;
  if (!slotValue) {
    throw new Error("Unable to read current global slot from lightnet");
  }

  return Number.parseInt(slotValue, 10);
}

export async function waitForGlobalSlot(
  targetSlot: number,
  timeoutMs = 180_000,
): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const currentSlot = await getCurrentGlobalSlot();
    if (currentSlot >= targetSlot) {
      return currentSlot;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for global slot ${targetSlot}`);
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseLightnetAccount(
  output: string,
): { publicKey: string; privateKey: string; balance: string } | undefined {
  return parseMarkerJson(output, "LIGHTNET_ACCOUNT_JSON:") as
    | { publicKey: string; privateKey: string; balance: string }
    | undefined;
}

export function parseGeneratedKeypairs(
  output: string,
): { privateKey: string; publicKey: string }[] {
  const parsed = parseMarkerJson(output, "KEYPAIRS_JSON:") as
    | { keypairs?: { privateKey: string; publicKey: string }[] }
    | undefined;
  return parsed?.keypairs ?? [];
}

export function parseGeneratedKeypair(
  output: string,
): { privateKey: string; publicKey: string } | undefined {
  return parseMarkerJson(output, "KEYPAIR_JSON:") as
    | { privateKey: string; publicKey: string }
    | undefined;
}

export function parseTreasuryProposalResult(output: string):
  | {
      proposalAddress: string;
      proposalTokenId: string;
      proposalTxHash?: string;
    }
  | undefined {
  return parseMarkerJson(output, "TREASURY_PROPOSAL_JSON:") as
    | {
        proposalAddress: string;
        proposalTokenId: string;
        proposalTxHash?: string;
      }
    | undefined;
}

export function parseTreasuryProposalVoteResult(
  output: string,
): { proposalAddress: string; voteTxHash?: string } | undefined {
  return parseMarkerJson(output, "TREASURY_PROPOSAL_VOTE_JSON:") as
    | { proposalAddress: string; voteTxHash?: string }
    | undefined;
}

export function parseTreasuryProposalActionsResult(output: string):
  | {
      count: number;
      outputPath?: string;
      proposalPublicKey: string;
      actionStateHistoryTarget?: Record<string, string>;
      voteActions: unknown[];
    }
  | undefined {
  return parseMarkerJson(output, "TREASURY_PROPOSAL_ACTIONS_JSON:") as
    | {
        count: number;
        outputPath?: string;
        proposalPublicKey: string;
        actionStateHistoryTarget?: Record<string, string>;
        voteActions: unknown[];
      }
    | undefined;
}

export function parseTreasuryProposalTallyResult(
  output: string,
): { proposalAddress: string; tallyTxHash?: string } | undefined {
  return parseMarkerJson(output, "TREASURY_PROPOSAL_TALLY_JSON:") as
    | { proposalAddress: string; tallyTxHash?: string }
    | undefined;
}

export function parseTreasuryProposalExecuteResult(output: string):
  | {
      proposalAddress: string;
      recipientPublicKey: string;
      amountToPayOut: string;
      executeTxHash?: string;
    }
  | undefined {
  return parseMarkerJson(output, "TREASURY_PROPOSAL_EXECUTE_JSON:") as
    | {
        proposalAddress: string;
        recipientPublicKey: string;
        amountToPayOut: string;
        executeTxHash?: string;
      }
    | undefined;
}

export function parseTreasuryProposalStateResult(output: string):
  | {
      proposalAddress: string;
      recipientHash: string;
      amount: string;
      lifecycleId: string;
      stakingEpochDataLedgerHash: string;
      stakingEpochDataLedgerTotalCurrency: string;
      status: string;
      statusField: string;
      paidOutAmount: string;
    }
  | undefined {
  return parseMarkerJson(output, "TREASURY_PROPOSAL_STATE_JSON:") as
    | {
        proposalAddress: string;
        recipientHash: string;
        amount: string;
        lifecycleId: string;
        stakingEpochDataLedgerHash: string;
        stakingEpochDataLedgerTotalCurrency: string;
        status: string;
        statusField: string;
        paidOutAmount: string;
      }
    | undefined;
}

export function parseTreasuryOwnerDeployResult(output: string):
  | {
      pauseControllerAddress: string;
      treasuryOwnerAddress: string;
      withdrawalPermission: "proof" | "proofOrSignature";
      pauseControllerTxHash?: string;
      treasuryOwnerTxHash?: string;
    }
  | undefined {
  return parseMarkerJson(output, "TREASURY_OWNER_DEPLOY_JSON:") as
    | {
        pauseControllerAddress: string;
        treasuryOwnerAddress: string;
        withdrawalPermission: "proof" | "proofOrSignature";
        pauseControllerTxHash?: string;
        treasuryOwnerTxHash?: string;
      }
    | undefined;
}

export function parseTreasuryOwnerCompileResult(output: string):
  | {
      lifecyclePeriodDuration: string;
      compiled: {
        voteReducerVerificationKey: boolean;
        stakingLedgerToVotingLedgerVerificationKey: boolean;
        treasuryProposalVerificationKey: boolean;
        treasuryPauseControllerVerificationKey: boolean;
        treasuryOwnerVerificationKey: boolean;
      };
    }
  | undefined {
  return parseMarkerJson(output, "TREASURY_OWNER_COMPILE_JSON:") as
    | {
        lifecyclePeriodDuration: string;
        compiled: {
          voteReducerVerificationKey: boolean;
          stakingLedgerToVotingLedgerVerificationKey: boolean;
          treasuryProposalVerificationKey: boolean;
          treasuryPauseControllerVerificationKey: boolean;
          treasuryOwnerVerificationKey: boolean;
        };
      }
    | undefined;
}

export function parseTreasuryOwnerStateResult(output: string):
  | {
      treasuryOwnerAddress: string;
      treasuryOwnerTokenId: string;
      treasuryDeployedAtSlot: string;
      pauseControllerPublicKey: string;
      withdrawalPermission: "proof" | "proofOrSignature" | "custom";
      accessPermission: string;
      sendPermission: string;
      currentLifecyclePeriod?: {
        treasuryOwnerAddress: string;
        currentGlobalSlot: string;
        treasuryDeployedAtSlot: string;
        lifecyclePeriodDuration: string;
        lifecycleStarted: boolean;
        lifecycleId: string;
        period: "proposal" | "exploration" | "voting" | "cooldown";
        periodStartSlot: string;
        periodEndSlot: string;
      };
    }
  | undefined {
  return parseMarkerJson(output, "TREASURY_OWNER_STATE_JSON:") as
    | {
        treasuryOwnerAddress: string;
        treasuryOwnerTokenId: string;
        treasuryDeployedAtSlot: string;
        pauseControllerPublicKey: string;
        withdrawalPermission: "proof" | "proofOrSignature" | "custom";
        accessPermission: string;
        sendPermission: string;
        currentLifecyclePeriod?: {
          treasuryOwnerAddress: string;
          currentGlobalSlot: string;
          treasuryDeployedAtSlot: string;
          lifecyclePeriodDuration: string;
          lifecycleStarted: boolean;
          lifecycleId: string;
          period: "proposal" | "exploration" | "voting" | "cooldown";
          periodStartSlot: string;
          periodEndSlot: string;
        };
      }
    | undefined;
}

export function parseTreasuryFundTreasuryResult(output: string):
  | {
      sender?: string;
      fundingAccount?: string;
      from: string;
      to: string;
      amount: string;
      transferTxHash?: string;
    }
  | undefined {
  return parseMarkerJson(output, "TREASURY_FUND_TREASURY_JSON:") as
    | {
        sender?: string;
        fundingAccount?: string;
        from: string;
        to: string;
        amount: string;
        transferTxHash?: string;
      }
    | undefined;
}

export function parseTreasuryEmergencyWithdrawResult(output: string):
  | {
      authorization: "treasury-owner-signature";
      sender: string;
      from: string;
      to: string;
      amount: string;
      emergencyWithdrawalTxHash?: string;
    }
  | undefined {
  return parseMarkerJson(output, "TREASURY_OWNER_EMERGENCY_WITHDRAW_JSON:") as
    | {
        authorization: "treasury-owner-signature";
        sender: string;
        from: string;
        to: string;
        amount: string;
        emergencyWithdrawalTxHash?: string;
      }
    | undefined;
}

export function parseTransferResult(output: string):
  | {
      sender?: string;
      fundingAccount?: string;
      from: string;
      to: string;
      amount: string;
      transferTxHash?: string;
    }
  | undefined {
  return parseMarkerJson(output, "MINA_TRANSFER_JSON:") as
    | {
        sender?: string;
        fundingAccount?: string;
        from: string;
        to: string;
        amount: string;
        transferTxHash?: string;
      }
    | undefined;
}

export function parsePauseControllerCompileResult(
  output: string,
): { compiled: { pauseControllerVerificationKey: boolean } } | undefined {
  return parseMarkerJson(output, "PAUSE_CONTROLLER_COMPILE_JSON:") as
    | { compiled: { pauseControllerVerificationKey: boolean } }
    | undefined;
}

export function parsePauseControllerDeployResult(output: string):
  | {
      pauseControllerAddress: string;
      pauseControllerTxHash?: string;
      multisigCommitment?: string;
    }
  | undefined {
  return parseMarkerJson(output, "PAUSE_CONTROLLER_DEPLOY_JSON:") as
    | {
        pauseControllerAddress: string;
        pauseControllerTxHash?: string;
        multisigCommitment?: string;
      }
    | undefined;
}

export function parsePauseControllerStateResult(output: string):
  | {
      pauseControllerAddress: string;
      multisigCommitment: string;
      paused: boolean;
      nonce: string;
    }
  | undefined {
  return parseMarkerJson(output, "PAUSE_CONTROLLER_STATE_JSON:") as
    | {
        pauseControllerAddress: string;
        multisigCommitment: string;
        paused: boolean;
        nonce: string;
      }
    | undefined;
}

export function parsePauseTreasuryResult(output: string):
  | {
      pauseControllerAddress: string;
      paused: boolean;
      nonce: string;
      pauseTxHash?: string;
    }
  | undefined {
  return parseMarkerJson(output, "PAUSE_CONTROLLER_PAUSE_JSON:") as
    | {
        pauseControllerAddress: string;
        paused: boolean;
        nonce: string;
        pauseTxHash?: string;
      }
    | undefined;
}

export function parseUnpauseTreasuryResult(output: string):
  | {
      pauseControllerAddress: string;
      paused: boolean;
      nonce: string;
      unpauseTxHash?: string;
    }
  | undefined {
  return parseMarkerJson(output, "PAUSE_CONTROLLER_UNPAUSE_JSON:") as
    | {
        pauseControllerAddress: string;
        paused: boolean;
        nonce: string;
        unpauseTxHash?: string;
      }
    | undefined;
}

export function parseTogglePauseProposalResult(output: string):
  | {
      pauseControllerAddress: string;
      proposalPublicKey: string;
      nonce: string;
      togglePauseProposalTxHash?: string;
    }
  | undefined {
  return parseMarkerJson(output, "PAUSE_CONTROLLER_TOGGLE_PROPOSAL_JSON:") as
    | {
        pauseControllerAddress: string;
        proposalPublicKey: string;
        nonce: string;
        togglePauseProposalTxHash?: string;
      }
    | undefined;
}

export function parseRotateMultisigKeysResult(output: string):
  | {
      pauseControllerAddress: string;
      nonce: string;
      previousMultisigCommitment: string;
      newMultisigCommitment: string;
      rotateMultisigKeysTxHash?: string;
    }
  | undefined {
  return parseMarkerJson(output, "PAUSE_CONTROLLER_ROTATE_KEYS_JSON:") as
    | {
        pauseControllerAddress: string;
        nonce: string;
        previousMultisigCommitment: string;
        newMultisigCommitment: string;
        rotateMultisigKeysTxHash?: string;
      }
    | undefined;
}

export function parseMultisigSignResult(output: string):
  | {
      type: string;
      nonce: string;
      dataHash: string;
      multisigCommitment: string;
      multisigParticipantsPublicKeys: string[];
      signerPublicKey: string;
      signerParticipantIndex: number;
      signature: string;
      validSignaturesCount: number;
      proposalPublicKey?: string;
      previousMultisigCommitment?: string;
      newMultisigCommitment?: string;
    }
  | undefined {
  return parseMarkerJson(output, "MULTISIG_SIGN_JSON:") as
    | {
        type: string;
        nonce: string;
        dataHash: string;
        multisigCommitment: string;
        multisigParticipantsPublicKeys: string[];
        signerPublicKey: string;
        signerParticipantIndex: number;
        signature: string;
        validSignaturesCount: number;
        proposalPublicKey?: string;
        previousMultisigCommitment?: string;
        newMultisigCommitment?: string;
      }
    | undefined;
}

function parseMarkerJson(output: string, marker: string): unknown {
  const markerIndex = output.lastIndexOf(marker);
  if (markerIndex !== -1) {
    const jsonLine = output
      .slice(markerIndex + marker.length)
      .split("\n")[0]
      ?.trim();
    if (!jsonLine) {
      return undefined;
    }

    try {
      return JSON.parse(jsonLine);
    } catch {
      return undefined;
    }
  }

  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Keep scanning for the most recent parseable JSON line.
    }
  }

  return undefined;
}

async function isLightnetReady(): Promise<boolean> {
  try {
    const response = await fetch(MINA_NODE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ daemonStatus { chainId } }" }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForLightnetReadyOrExit(
  process: ChildProcess,
  timeoutMs: number,
): Promise<"ready" | "exited" | "timeout"> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isLightnetReady()) return "ready";
    if (process.exitCode !== null) return "exited";
    await sleep(2000);
  }
  return "timeout";
}

function looksLikeDockerNotRunning(output: string): boolean {
  return (
    /cannot connect to the docker daemon/i.test(output) ||
    /is the docker daemon running/i.test(output) ||
    /docker desktop.*(not running|stopped)/i.test(output) ||
    /error.*docker/i.test(output)
  );
}
