import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
import { finished } from "node:stream/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { convertBrowserCoverage } from "../scripts/convert-browser-coverage.mjs";
import {
  assertSameBrowserCases,
  readBrowserResults,
} from "./local-e2e-report.mjs";
import { readBrowserCoverageInputs } from "./local-e2e-browser-inputs.mjs";
import {
  assertSameNativeCases,
  readNativeResults,
} from "./local-e2e-native-results.mjs";
import {
  changedSourcePaths,
  dependencyPatchPattern,
  fingerprintSources,
} from "./local-e2e-sources.mjs";
import { assertCoveredSourceScopes } from "./local-e2e-coverage-scopes.mjs";
import { readRunOptions } from "./local-e2e-options.mjs";
import {
  cleanupTestContainers,
  signalProcessGroup,
  stopProcessGroup,
} from "./local-e2e-process.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const nativeNodeOptions = [process.env.NODE_OPTIONS, "--enable-source-maps"]
  .filter(Boolean)
  .join(" ");
const suites = {
  api: {
    directory: "apps/api",
    loader: "ts-node/esm",
    tests: ["test/e2e/proposal-created-local-blockchain.e2e.ts"],
    env: { RUN_LOCAL_BLOCKCHAIN_E2E: "true" },
  },
  "api-recovery": {
    directory: "apps/api",
    loader: "ts-node/esm",
    tests: ["test/e2e/operator-recovery.local-blockchain.e2e.ts"],
    managedServices: true,
  },
  "api-payout-recovery": {
    directory: "apps/api",
    loader: "ts-node/esm",
    tests: ["test/e2e/payout-recovery.local-blockchain.e2e.ts"],
    managedServices: true,
  },
  service: {
    directory: "packages/local-blockchain",
    loader: "../sdk/node_modules/ts-node/esm.mjs",
    tests: [
      "test/archive-range.test.ts",
      "test/local-blockchain-server.test.ts",
      "test/graphql-errors.test.ts",
    ],
  },
  "service-errors": {
    directory: "packages/local-blockchain",
    loader: "../sdk/node_modules/ts-node/esm.mjs",
    tests: ["test/graphql-errors.test.ts"],
  },
  cli: {
    directory: "apps/cli",
    loader: "ts-node/esm",
    tests: ["test/local-blockchain-cli.e2e.ts"],
    managedServices: true,
    coverageScopes: ["apps/cli/src/", "packages/sdk/src/", "apps/api/src/"],
  },
  "cli-negative": {
    directory: "apps/cli",
    loader: "ts-node/esm",
    tests: ["test/local-blockchain-cli-negative.e2e.ts"],
    managedServices: true,
    coverageScopes: ["apps/cli/src/", "packages/sdk/src/", "apps/api/src/"],
  },
  "cli-ledger": {
    directory: "apps/cli",
    loader: "ts-node/esm",
    tests: ["test/varied-staking-ledger.local-blockchain.e2e.ts"],
    managedServices: true,
    coverageScopes: ["apps/cli/src/", "packages/sdk/src/", "apps/api/src/"],
  },
  compose: {
    directory: ".",
    loader: "./apps/cli/node_modules/ts-node/esm.mjs",
    tests: ["devops/test/compose-e2e.node.test.mjs"],
    env: { RUN_COMPOSE_E2E: "true" },
    compose: true,
    coverageScopes: ["apps/cli/src/", "packages/sdk/src/"],
  },
  web: {
    directory: "apps/web",
    browser: true,
    report: "results.json",
  },
  backoffice: {
    directory: "apps/backoffice",
    browser: true,
    report: (mode) => `backoffice/proofs-${mode}/report.json`,
  },
};

const options = readRunOptions(process.argv.slice(2));
const selected =
  options.suites.length > 0
    ? options.suites
    : [
        "service",
        "api",
        "api-recovery",
        "api-payout-recovery",
        "cli",
        "cli-ledger",
        "cli-negative",
        "web",
        "backoffice",
        "compose",
      ];
if (selected.some((name) => !suites[name])) {
  console.error(`Select suites: ${Object.keys(suites).join(" ")}`);
  process.exit(2);
}
if (new Set(selected).size !== selected.length) {
  throw new Error("Each suite must be selected once");
}

const runId =
  process.env.E2E_RUN_ID ?? new Date().toISOString().replaceAll(/[:.]/g, "-");
if (!/^[a-zA-Z0-9_-]+$/.test(runId))
  throw new Error(
    "E2E_RUN_ID must contain only letters, digits, underscores, or hyphens",
  );
const runDirectory = join(root, "coverage/local-e2e", runId);
await mkdir(dirname(runDirectory), { recursive: true });
await mkdir(runDirectory);
const results = [];
const firstPassSources = new Map();
const firstPassBrowserCases = new Map();
const firstPassNativeCases = new Map();

async function sourceFingerprint(suite) {
  const paths = [];
  for await (const path of glob(
    [
      "packages/*/src/**/*.{ts,tsx,js,mjs}",
      "apps/cli/src/**/*.ts",
      "apps/api/src/**/*.ts",
      `${suite.directory}/src/**/*.ts`,
      `${suite.directory}/test/**/*.ts`,
      ...(suite.managedServices
        ? [
            "apps/web/e2e/utils/local-treasury-stack.ts",
            "apps/web/e2e/utils/lifecycle-operator.ts",
          ]
        : []),
      ...(suite.browser || suite.compose
        ? [
            "apps/{web,backoffice}/e2e/**/*.{ts,tsx}",
            "apps/{web,backoffice}/features/**/*.{ts,tsx}",
            "apps/{web,backoffice}/app/**/*.{ts,tsx}",
            "apps/{web,backoffice}/lib/**/*.{ts,tsx}",
            "apps/{web,backoffice}/components/**/*.{ts,tsx}",
            "apps/{web,backoffice}/workers/**/*.{ts,tsx}",
            "apps/{web,backoffice}/shims/**/*.{ts,tsx,js,mjs}",
            "apps/{web,backoffice}/{tailwind,postcss}.config.*",
            "apps/{web,backoffice}/next.config.*",
            "apps/{web,backoffice}/playwright.local-blockchain.config.ts",
            "apps/{web,backoffice}/package.json",
            "apps/{web,backoffice}/tsconfig.json",
          ]
        : []),
      ...(suite.compose
        ? [
            "devops/test/compose-e2e*.mjs",
            "devops/compose.yml",
            "devops/docker/**/*",
            "devops/proxy/**/*",
            ".dockerignore",
            ".npmrc",
            "turbo.json",
            "apps/docs/package.json",
          ]
        : []),
      "pnpm-lock.yaml",
      dependencyPatchPattern,
      "pnpm-workspace.yaml",
      "package.json",
      "packages/*/package.json",
      "apps/{api,cli}/package.json",
      "apps/{api,cli}/tsconfig*.json",
      "packages/*/tsconfig*.json",
      `${suite.directory}/package.json`,
      `${suite.directory}/tsconfig*.json`,
      "packages/typescript-config/*.json",
      "devops/test/run-local-e2e.mjs",
      "devops/test/local-e2e-options.mjs",
      "devops/test/local-e2e-report.mjs",
      "devops/test/local-e2e-native-reporter.mjs",
      "devops/test/local-e2e-native-results.mjs",
      "devops/test/local-e2e-process.mjs",
      "devops/test/local-e2e-sources.mjs",
      "devops/test/local-e2e-coverage-scopes.mjs",
      "devops/test/local-e2e-services.mjs",
      "devops/test/local-e2e-services.d.mts",
      "devops/test/local-e2e-backend.{mjs,d.mts}",
      "devops/test/local-e2e-browser-inputs.mjs",
      "devops/scripts/convert-browser-coverage.mjs",
    ],
    { cwd: root },
  ))
    paths.push(path);
  return fingerprintSources(root, paths);
}

let activeRun;
let interrupted = false;
function beginCleanup() {
  if (!activeRun) return Promise.resolve();
  const run = activeRun;
  return (run.cleanup ??= (async () => {
    try {
      if (run.pid) run.processCleanup = await stopProcessGroup(run.pid);
    } catch (error) {
      run.cleanupError = error.message;
    }
    if (run.browser) {
      try {
        run.removedContainers = await cleanupTestContainers(run.resourceId);
      } catch (error) {
        run.cleanupError = [run.cleanupError, error.message]
          .filter(Boolean)
          .join("; ");
      }
    }
    if (run.composeProjectName) {
      try {
        const { cleanupComposeProject } =
          await import("./compose-e2e-runner.mjs");
        run.composeCleanup = await cleanupComposeProject(
          run.composeProjectName,
        );
      } catch (error) {
        run.cleanupError = [run.cleanupError, error.message]
          .filter(Boolean)
          .join("; ");
      }
    }
  })());
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interrupted = true;
    void beginCleanup();
  });
}
process.on("exit", () => {
  if (activeRun?.pid) signalProcessGroup(activeRun.pid, "SIGKILL");
});

function summarizeLcov(source) {
  const totals = { lines: [0, 0], branches: [0, 0], functions: [0, 0] };
  const fields = {
    LH: ["lines", 0],
    LF: ["lines", 1],
    BRH: ["branches", 0],
    BRF: ["branches", 1],
    FNH: ["functions", 0],
    FNF: ["functions", 1],
  };
  for (const line of source.split("\n")) {
    const [key, value] = line.split(":");
    const field = fields[key];
    if (field) totals[field[0]][field[1]] += Number(value);
  }
  return Object.fromEntries(
    Object.entries(totals).map(([name, [covered, total]]) => [
      name,
      {
        covered,
        total,
        percent:
          total === 0 ? null : Number(((100 * covered) / total).toFixed(2)),
      },
    ]),
  );
}

// A fresh process and fixture are required for each suite and proof mode.
// The second pass starts only after every selected first-pass suite succeeds.
for (const proofMode of options.proofModes) {
  for (const name of selected) {
    if (interrupted) throw new Error("Two-pass run interrupted");
    const suite = suites[name];
    const sourceBefore = await sourceFingerprint(suite);
    const sourceHash = sourceBefore.hash;
    const directory = join(runDirectory, `proofs-${proofMode}`, name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "source-before.json"),
      JSON.stringify(sourceBefore, null, 2),
    );
    if (
      proofMode === "true" &&
      firstPassSources.get(name).hash !== sourceHash
    ) {
      const changes = changedSourcePaths(
        firstPassSources.get(name),
        sourceBefore,
      );
      await writeFile(
        join(directory, "source-drift.json"),
        JSON.stringify(changes, null, 2),
      );
      throw new Error(
        `Sources changed after the proof-disabled ${name} pass. Restart both passes. Changed files: ${changes.join(", ")}`,
      );
    }
    firstPassSources.set(name, sourceBefore);
    const lcovPath = join(directory, "lcov.info");
    const args = suite.browser
      ? [
          join(root, suite.directory, "node_modules/@playwright/test/cli.js"),
          "test",
          "--config=playwright.local-blockchain.config.ts",
          "--forbid-only",
        ]
      : [
          "--enable-source-maps",
          "--loader",
          suite.loader,
          "--experimental-test-coverage",
          "--test-concurrency=1",
          `--test-coverage-include=${root}/packages/*/src/**/*.ts`,
          `--test-coverage-include=${root}/apps/*/src/**/*.ts`,
          "--test-reporter=spec",
          "--test-reporter-destination=stdout",
          "--test-reporter=lcov",
          `--test-reporter-destination=${lcovPath}`,
          "--test-reporter=junit",
          `--test-reporter-destination=${join(directory, "junit.xml")}`,
          `--test-reporter=${join(root, "devops/test/local-e2e-native-reporter.mjs")}`,
          `--test-reporter-destination=${join(directory, "native-cases.jsonl")}`,
          "--test",
          ...suite.tests,
        ];
    console.log(`Starting ${name}: PROOFS_ENABLED=${proofMode}`);
    const started = Date.now();
    const timeoutMs = Number(
      process.env.E2E_SUITE_TIMEOUT_MS ??
        (proofMode === "true" ? 7_200_000 : 1_800_000),
    );
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
      throw new Error("E2E_SUITE_TIMEOUT_MS must be a positive integer");
    const composeProject = suite.compose
      ? (await import("./compose-e2e-runner.mjs")).composeProjectName(
          runId,
          proofMode,
        )
      : undefined;
    const child = spawn(process.execPath, args, {
      detached: process.platform !== "win32",
      cwd: join(root, suite.directory),
      env: {
        ...process.env,
        ...suite.env,
        // Spawned CLI, API, and proof-worker processes also contribute native coverage.
        ...(!suite.browser
          ? {
              NODE_OPTIONS: nativeNodeOptions,
            }
          : {}),
        PROOFS_ENABLED: proofMode,
        NODE_NO_WARNINGS: "1",
        E2E_ARTIFACT_DIRECTORY: directory,
        E2E_RUN_ID: runId,
        ...(suite.compose ? { COMPOSE_E2E_RUN_ID: runId } : {}),
        E2E_RESOURCE_ID: `${runId}-${proofMode}-${name}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeRun = {
      pid: child.pid,
      browser: suite.browser || suite.managedServices,
      resourceId: `${runId}-${proofMode}-${name}`,
      composeProjectName: composeProject,
    };
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      console.error(
        `${name} exceeded ${timeoutMs} ms in proof mode ${proofMode}`,
      );
      void beginCleanup();
    }, timeoutMs);
    deadline.unref();
    let output = "";
    const log = createWriteStream(join(directory, "test.log"));
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        output += chunk;
        log.write(chunk);
        (stream === child.stdout ? process.stdout : process.stderr).write(
          chunk,
        );
      });
    }
    const outcome = await new Promise((done) => {
      child.once("error", (error) => done({ code: 1, error: error.message }));
      child.once("close", (code, signal) => done({ code, signal }));
    });
    clearTimeout(deadline);
    await beginCleanup();
    const cleanup = activeRun;
    activeRun = undefined;
    log.end();
    await finished(log);
    let coverage = null;
    let coveredSourceScopes;
    let browserEvidence;
    let nativeEvidence;
    let evidenceError;
    if (suite.browser) {
      try {
        const reportFile =
          typeof suite.report === "function"
            ? suite.report(proofMode)
            : suite.report;
        const report = JSON.parse(
          await readFile(join(directory, reportFile), "utf8"),
        );
        browserEvidence = readBrowserResults(report);
        if (proofMode === "true")
          assertSameBrowserCases(
            firstPassBrowserCases.get(name),
            browserEvidence,
          );
        else firstPassBrowserCases.set(name, browserEvidence);
        const inputs = await readBrowserCoverageInputs(report, directory);
        const converted = await convertBrowserCoverage({
          inputs,
          outputDirectory: directory,
          repoRoot: root,
          appRoot: suite.directory,
        });
        if (converted.exitCode !== 0)
          throw new Error(
            "Browser source coverage is incomplete; inspect source-map-validation.json",
          );
      } catch (error) {
        evidenceError = error.message;
        console.error(
          `Browser evidence unavailable for ${name}: ${error.message}`,
        );
      }
    } else {
      try {
        nativeEvidence = readNativeResults(
          await readFile(join(directory, "native-cases.jsonl"), "utf8"),
          { root, mode: proofMode },
        );
        if (proofMode === "true")
          assertSameNativeCases(firstPassNativeCases.get(name), nativeEvidence);
        else firstPassNativeCases.set(name, nativeEvidence);
      } catch (error) {
        evidenceError = error.message;
        console.error(
          `Native evidence unavailable for ${name}: ${error.message}`,
        );
      }
    }
    try {
      const lcov = (await readFile(lcovPath, "utf8")).replace(
        /^SF:(.+)$/gm,
        (_, source) =>
          `SF:${relative(root, resolve(root, ...(suite.browser ? [] : [suite.directory]), source)).replaceAll("\\", "/")}`,
      );
      await writeFile(lcovPath, lcov);
      coverage = summarizeLcov(lcov);
      coveredSourceScopes = assertCoveredSourceScopes(
        lcov,
        suite.coverageScopes ?? [],
      );
    } catch (error) {
      evidenceError = [evidenceError, error.message].filter(Boolean).join("; ");
      console.error(`Coverage unavailable for ${name}: ${error.message}`);
    }
    const counts =
      browserEvidence?.counts ??
      Object.fromEntries(
        ["tests", "pass", "fail", "skipped", "cancelled"].map((key) => [
          key,
          Number(output.match(new RegExp(`(?:ℹ|#) ${key} (\\d+)`))?.[1] ?? NaN),
        ]),
      );
    const sourceAfter = await sourceFingerprint(suite);
    const changedSources = changedSourcePaths(sourceBefore, sourceAfter);
    await writeFile(
      join(directory, "source-after.json"),
      JSON.stringify(sourceAfter, null, 2),
    );
    if (changedSources.length)
      console.error(
        `Sources changed during ${name}: ${changedSources.join(", ")}`,
      );
    const result = {
      suite: name,
      sourceHash,
      sourcesUnchanged: sourceAfter.hash === sourceHash,
      changedSources,
      proofsEnabled: proofMode === "true",
      timedOut,
      interrupted,
      evidenceError,
      cleanup: {
        process: cleanup.processCleanup,
        removedContainers: cleanup.removedContainers,
        compose: cleanup.composeCleanup,
        error: cleanup.cleanupError,
      },
      browserCases: browserEvidence?.cases,
      nativeCases: nativeEvidence?.cases,
      coverageScope: suite.browser
        ? "Captured page TypeScript source with validated maps; excludes unloaded files, Web Workers, WebAssembly, and server execution; branches are V8 blocks"
        : suite.compose
          ? "Loaded host CLI, SDK worker, and local-chain TypeScript; excludes Docker processes, unimported files, and browser code"
          : "Loaded TypeScript source across app and package processes; excludes unimported files and browser code",
      coveredSourceScopes,
      ...outcome,
      durationMs: Date.now() - started,
      counts,
      coverage,
    };
    results.push(result);
    await writeFile(
      join(runDirectory, "summary.json"),
      JSON.stringify({ runId, results }, null, 2),
    );
    console.log(`Incremental report: ${join(runDirectory, "summary.json")}`);
    // Missing evidence and skipped scenarios must not permit the proof-enabled pass.
    if (
      outcome.code !== 0 ||
      timedOut ||
      interrupted ||
      evidenceError ||
      cleanup.cleanupError ||
      (suite.browser && !browserEvidence?.passed) ||
      (!suite.browser &&
        (!nativeEvidence?.passed ||
          nativeEvidence.cases.length !== counts.tests)) ||
      !result.sourcesUnchanged ||
      !(counts.tests > 0) ||
      !Object.values(counts).every(Number.isSafeInteger) ||
      counts.fail !== 0 ||
      counts.pass !== counts.tests ||
      counts.skipped !== 0 ||
      counts.cancelled !== 0 ||
      !coverage?.lines.total
    ) {
      console.error(
        "Two-pass run stopped. Resolve the failed or incomplete suite before rerunning.",
      );
      process.exit(1);
    }
  }
}
