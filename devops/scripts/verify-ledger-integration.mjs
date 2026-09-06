import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const includeDevice = process.argv.includes("--device");
const includeLightnet = process.argv.includes("--lightnet");

const steps = [
  {
    name: "command-surface-and-index-contract",
    command: "node",
    args: [
      "--loader",
      "ts-node/esm",
      "--test",
      "test/ledger-command-surface.test.ts",
      "test/transaction-signer.test.ts",
      "test/multisig-sign.test.ts",
    ],
    cwd: resolve(repositoryRoot, "apps/cli"),
    required: true,
  },
  {
    name: "transport-neutral-sdk-signing",
    command: "node",
    args: [
      "--loader",
      "ts-node/esm",
      "--test",
      "test/signing/ledger-signing.test.ts",
    ],
    cwd: resolve(repositoryRoot, "packages/sdk"),
    required: true,
  },
  {
    name: "local-blockchain-software-ledger",
    command: "pnpm",
    args: ["run", "test:ledger:software"],
    cwd: resolve(repositoryRoot, "apps/cli"),
    required: true,
  },
  {
    name: "local-blockchain-apdu-mocker",
    command: "pnpm",
    args: ["run", "test:ledger:mocker"],
    cwd: resolve(repositoryRoot, "apps/cli"),
    required: true,
  },
  {
    name: "lightnet-software-ledger",
    command: "pnpm",
    args: ["run", "test:ledger:lightnet"],
    cwd: resolve(repositoryRoot, "apps/cli"),
    required: includeLightnet,
    enabled: includeLightnet,
    skipReason: "Use --lightnet with a running Lightnet network.",
  },
  {
    name: "physical-ledger",
    command: "pnpm",
    args: ["run", "test:ledger:device"],
    cwd: resolve(repositoryRoot, "apps/cli"),
    required: false,
    enabled: includeDevice,
    skipReason: "Use --device with an attached and authorized Ledger.",
  },
];

function runStep(step) {
  return new Promise((complete) => {
    const startedAt = Date.now();
    const child = spawn(step.command, step.args, {
      cwd: step.cwd,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", (error) => {
      complete({
        name: step.name,
        status: "FAIL",
        required: step.required,
        durationMs: Date.now() - startedAt,
        error: error.message,
      });
    });
    child.once("exit", (code, signal) => {
      complete({
        name: step.name,
        status: code === 0 ? "PASS" : "FAIL",
        required: step.required,
        durationMs: Date.now() - startedAt,
        exitCode: code,
        signal,
      });
    });
  });
}

const results = [];
for (const step of steps) {
  if (step.enabled === false) {
    results.push({
      name: step.name,
      status: "SKIP",
      required: step.required,
      reason: step.skipReason,
    });
    continue;
  }
  const result = await runStep(step);
  results.push(result);
  if (result.status === "FAIL" && step.required) break;
}

const requiredPassed = results.every(
  (result) => !result.required || result.status === "PASS",
);
console.log(
  JSON.stringify(
    {
      pipeline: "ledger-integration",
      network: includeLightnet
        ? "o1js LocalBlockchain and Docker Lightnet"
        : "o1js LocalBlockchain",
      requiredStatus: requiredPassed ? "PASS" : "FAIL",
      results,
    },
    null,
    2,
  ),
);
process.exitCode = requiredPassed ? 0 : 1;
