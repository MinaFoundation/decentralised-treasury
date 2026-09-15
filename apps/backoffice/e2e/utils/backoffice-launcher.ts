import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestInfo } from "@playwright/test";
import {
  availablePort,
  waitForUrl,
  type LocalTreasuryStack,
} from "../../../web/e2e/utils/local-treasury-stack";

/** Restart only Backoffice; keep the deployed chain, backend, and SQLite data. */
export async function createBackofficeLauncher(
  stack: LocalTreasuryStack,
  info: TestInfo,
) {
  const appRoot = fileURLToPath(new URL("../../", import.meta.url));
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  let output = "";
  let attempt = 0;
  const stop = async () => {
    const running = child;
    if (!running) return;
    child = undefined;
    if (running.exitCode === null && running.signalCode === null) {
      await new Promise<void>((resolve, reject) => {
        let forceTimer: ReturnType<typeof setTimeout>;
        const timer = setTimeout(() => {
          running.kill("SIGKILL");
          forceTimer = setTimeout(
            () => reject(new Error("Backoffice did not stop.")),
            5_000,
          );
        }, 5_000);
        running.once("close", () => {
          clearTimeout(timer);
          clearTimeout(forceTimer);
          resolve();
        });
        running.kill("SIGTERM");
      });
    }
    await info.attach(`backoffice-restart-${attempt}.log`, {
      body: output.replace(/EK[A-Za-z0-9]{40,}/g, "[private key redacted]"),
      contentType: "text/plain",
    });
  };
  return {
    url,
    stop,
    async start(participants: string[]) {
      if (child)
        throw new Error("Stop Backoffice before changing its configuration.");
      output = "";
      attempt++;
      child = spawn(
        process.execPath,
        [
          join(appRoot, "node_modules/next/dist/bin/next"),
          "dev",
          "--hostname",
          "127.0.0.1",
          "--port",
          String(port),
        ],
        {
          cwd: appRoot,
          env: {
            ...process.env,
            ...stack.runtimeEnv,
            PROOFS_ENABLED: String(stack.proofsEnabled),
            NEXT_PUBLIC_PROOFS_ENABLED: String(stack.proofsEnabled),
            NEXT_PUBLIC_MULTISIG_PARTICIPANTS_PUBLIC_KEYS:
              participants.join(","),
            E2E_BROWSER_COVERAGE: "true",
            BACKOFFICE_BUILD_DIR: ".next",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout?.on("data", (chunk) => {
        output += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        output += String(chunk);
      });
      let spawnError: Error | undefined;
      child.once("error", (error) => {
        spawnError = error;
      });
      try {
        await waitForUrl(url, 180_000);
        if (spawnError || child.exitCode !== null || child.signalCode !== null)
          throw new Error(
            `Backoffice startup failed: ${spawnError?.message ?? "process exited"}`,
          );
      } catch (error) {
        await stop();
        throw error;
      }
      return url;
    },
  };
}
