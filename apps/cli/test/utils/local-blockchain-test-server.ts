import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const LOCAL_BLOCKCHAIN_DIRECTORY = fileURLToPath(
  new URL("../../../../packages/local-blockchain/", import.meta.url),
);
const LOCAL_BLOCKCHAIN_SERVER_ENTRY = fileURLToPath(
  new URL(
    "../../../../packages/local-blockchain/src/server.ts",
    import.meta.url,
  ),
);
const LOCAL_BLOCKCHAIN_TS_NODE_LOADER = fileURLToPath(
  new URL(
    "../../../../packages/sdk/node_modules/ts-node/esm.mjs",
    import.meta.url,
  ),
);

const DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 10_000;
const DEFAULT_FORCED_SHUTDOWN_TIMEOUT_MS = 5_000;

export interface LocalBlockchainTestServerOptions {
  nodePort: number;
  archivePort: number;
  proofsEnabled: boolean;
  envOverrides?: Record<string, string>;
  gracefulShutdownTimeoutMs?: number;
  forcedShutdownTimeoutMs?: number;
}

export interface LocalBlockchainTestServerCloseResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  graceful: boolean;
}

export interface LocalBlockchainTestServer {
  child: ChildProcess;
  stop(): Promise<LocalBlockchainTestServerCloseResult>;
}

interface ChildCloseResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  spawnError?: Error;
}

function positiveTimeout(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Local blockchain shutdown timeout must be positive");
  }
  return value;
}

function requireCleanClose(result: ChildCloseResult): ChildCloseResult {
  if (result.spawnError) throw result.spawnError;
  if (result.code !== 0 || result.signal !== null) {
    throw new Error(
      `Local blockchain closed unexpectedly (code=${String(result.code)}, signal=${String(result.signal)})`,
    );
  }
  return result;
}

async function waitForClose(
  closePromise: Promise<ChildCloseResult>,
  timeoutMs: number,
  phase: string,
): Promise<ChildCloseResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      closePromise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Local blockchain ${phase} timed out`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function startLocalBlockchainTestServer(
  options: LocalBlockchainTestServerOptions,
): LocalBlockchainTestServer {
  const gracefulShutdownTimeoutMs = positiveTimeout(
    options.gracefulShutdownTimeoutMs,
    DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  );
  const forcedShutdownTimeoutMs = positiveTimeout(
    options.forcedShutdownTimeoutMs,
    DEFAULT_FORCED_SHUTDOWN_TIMEOUT_MS,
  );
  const child = spawn(
    process.execPath,
    [
      "--loader",
      LOCAL_BLOCKCHAIN_TS_NODE_LOADER,
      LOCAL_BLOCKCHAIN_SERVER_ENTRY,
    ],
    {
      cwd: LOCAL_BLOCKCHAIN_DIRECTORY,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: "1",
        ...options.envOverrides,
        MINA_NODE_PORT: String(options.nodePort),
        MINA_ARCHIVE_PORT: String(options.archivePort),
        PROOFS_ENABLED: String(options.proofsEnabled),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let closed = false;
  let closeResult: ChildCloseResult | undefined;
  let spawnError: Error | undefined;
  const closePromise = new Promise<ChildCloseResult>((resolve) => {
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code, signal) => {
      closed = true;
      closeResult = { code, signal, spawnError };
      resolve(closeResult);
    });
  });

  let stopPromise: Promise<LocalBlockchainTestServerCloseResult> | undefined;
  const stop = async (): Promise<LocalBlockchainTestServerCloseResult> => {
    if (stopPromise) return await stopPromise;
    stopPromise = (async () => {
      if (closed && closeResult) {
        return { ...requireCleanClose(closeResult), graceful: true };
      }

      child.kill("SIGTERM");
      let result: ChildCloseResult;
      try {
        result = await waitForClose(
          closePromise,
          gracefulShutdownTimeoutMs,
          "graceful shutdown",
        );
      } catch (gracefulError) {
        if (!closed) child.kill("SIGKILL");
        let forcedResult: ChildCloseResult;
        try {
          forcedResult = await waitForClose(
            closePromise,
            forcedShutdownTimeoutMs,
            "forced shutdown",
          );
        } catch (forcedError) {
          throw new AggregateError(
            [gracefulError, forcedError],
            "Local blockchain did not close after SIGTERM or SIGKILL",
          );
        }
        throw new AggregateError(
          [
            gracefulError,
            ...(forcedResult.spawnError ? [forcedResult.spawnError] : []),
          ],
          `Local blockchain required SIGKILL after it did not close within ${gracefulShutdownTimeoutMs}ms`,
        );
      }
      return { ...requireCleanClose(result), graceful: true };
    })();
    return await stopPromise;
  };

  return { child, stop };
}
