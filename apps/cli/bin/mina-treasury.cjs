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
  ["--loader", "ts-node/esm", cliEntry, ...cliArgs],
  {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

