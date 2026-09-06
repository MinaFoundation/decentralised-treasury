import { spawn } from "node:child_process";
import { glob } from "node:fs/promises";
import { matchesGlob } from "node:path";

const PER_FILE_LINE_MINIMUM = 60;

function readOption(name) {
  const prefix = `${name}=`;
  const value = process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix));
  return value?.slice(prefix.length) ?? null;
}

const include = readOption("--include");
const testPattern = readOption("--test-pattern");
const excludes = process.argv
  .slice(2)
  .filter((argument) => argument.startsWith("--exclude="))
  .map((argument) => argument.slice("--exclude=".length));

if (!include || !testPattern) {
  console.error(
    "Usage: run-node-test-coverage.mjs --include=<glob> --test-pattern=<glob> [--exclude=<glob>]",
  );
  process.exit(2);
}

const expectedSourceFiles = new Set();
for await (const sourceFile of glob(include, { cwd: process.cwd() })) {
  if (!excludes.some((exclude) => matchesGlob(sourceFile, exclude))) {
    expectedSourceFiles.add(sourceFile.replaceAll("\\", "/"));
  }
}

if (expectedSourceFiles.size === 0) {
  console.error(
    `Coverage include pattern did not match source files: ${include}`,
  );
  process.exit(2);
}

const args = [
  "--loader",
  "ts-node/esm",
  "--experimental-test-coverage",
  `--test-coverage-include=${include}`,
  "--test-coverage-lines=80",
  "--test-coverage-functions=80",
  "--test-coverage-branches=75",
];

for (const exclude of excludes) {
  args.push(`--test-coverage-exclude=${exclude}`);
}

args.push("--test", testPattern);

const child = spawn(process.execPath, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"],
});

let output = "";

for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    output += chunk;
    const target = stream === child.stdout ? process.stdout : process.stderr;
    target.write(chunk);
  });
}

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("close", (code, signal) => {
  const belowMinimum = [];
  const reportedSourceFiles = new Set();
  const coveragePath = [];
  const coverageRow =
    /^.*?([^|]+?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|/;

  for (const line of output.split(/\r?\n/)) {
    const tableLine = line.replace(/^.*?ℹ /u, "");
    if (tableLine.includes("|")) {
      const rawPath = tableLine.split("|", 1)[0];
      const pathPart = rawPath?.trimEnd() ?? "";
      const name = pathPart.trim();
      const indentation = pathPart.length - pathPart.trimStart().length;
      if (name && !name.startsWith("-") && name !== "file") {
        if (!line.match(coverageRow)) {
          coveragePath[indentation] = name;
          coveragePath.length = indentation + 1;
        } else if (name !== "all files") {
          reportedSourceFiles.add(
            [...coveragePath.slice(0, indentation), name].join("/"),
          );
        }
      }
    }

    const match = line.match(coverageRow);
    if (!match) {
      continue;
    }
    const file = match[1].replace(/^.*?ℹ\s*/, "").trim();
    if (!file || file === "all files") {
      continue;
    }
    const lineCoverage = Number(match[2]);
    if (lineCoverage < PER_FILE_LINE_MINIMUM) {
      belowMinimum.push({ file, lineCoverage });
    }
  }

  if (belowMinimum.length > 0) {
    console.error(
      `Per-file line coverage must be at least ${PER_FILE_LINE_MINIMUM}%.`,
    );
    for (const result of belowMinimum) {
      console.error(`- ${result.file}: ${result.lineCoverage.toFixed(2)}%`);
    }
  }

  const missingSourceFiles = [...expectedSourceFiles].filter(
    (sourceFile) => !reportedSourceFiles.has(sourceFile),
  );
  if (missingSourceFiles.length > 0) {
    console.error(
      "Every included source file must have an explicit coverage row. " +
        "Exercise the file or add a justified --exclude pattern.",
    );
    for (const sourceFile of missingSourceFiles.sort()) {
      console.error(`- ${sourceFile}`);
    }
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(
    code === 0 && belowMinimum.length === 0 && missingSourceFiles.length === 0
      ? 0
      : code || 1,
  );
});
