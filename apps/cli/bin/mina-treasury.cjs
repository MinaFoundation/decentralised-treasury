#!/usr/bin/env node

const { spawn } = require("node:child_process");
const { dirname, resolve } = require("node:path");

const packageRoot = resolve(dirname(__filename), "..");
const cliEntry = resolve(packageRoot, "src", "cli.ts");
const cliArgs = [...process.argv.slice(2)];
if (cliArgs[0] === "--") {
  cliArgs.shift();
}

const child = spawn(
  process.execPath,
  ["--loader", require.resolve("ts-node/esm"), cliEntry, ...cliArgs],
  {
    stdio: "inherit",
    cwd: process.cwd(),
    env: {
      ...process.env,
      TS_NODE_PROJECT:
        process.env.TS_NODE_PROJECT ?? resolve(packageRoot, "tsconfig.json"),
    },
  },
);

const forwardTerm = () => child.kill("SIGTERM");
const forwardInt = () => child.kill("SIGINT");
process.on("SIGTERM", forwardTerm);
process.on("SIGINT", forwardInt);

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  process.removeListener("SIGTERM", forwardTerm);
  process.removeListener("SIGINT", forwardInt);
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
