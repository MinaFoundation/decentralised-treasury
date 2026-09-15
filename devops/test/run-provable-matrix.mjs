import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";
import process from "node:process";
import {
  proofOffApiFiles,
  proofOffFiles,
  proofOffPostCoverageFiles,
} from "../../packages/sdk/test/assurance/proof-off-files.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const sdkRoot = resolve(repositoryRoot, "packages/sdk");
const apiRoot = resolve(repositoryRoot, "apps/api");
const tsNodeLoader = resolve(sdkRoot, "node_modules/ts-node/esm.mjs");
const apiTsNodeLoader = resolve(apiRoot, "node_modules/ts-node/esm.mjs");
const fromSdkWorkingDirectory = (path) =>
  path.startsWith("packages/sdk/")
    ? path.slice("packages/sdk/".length)
    : resolve(repositoryRoot, path);
const sdkTestFiles = proofOffFiles.map(fromSdkWorkingDirectory);
const postCoverageTestFiles = proofOffPostCoverageFiles.map(
  fromSdkWorkingDirectory,
);
const apiTestFiles = proofOffApiFiles.map((path) =>
  resolve(repositoryRoot, path),
);
const coverageEnabled = process.env.PROVABLE_COVERAGE === "true";
const coverageDirectory = resolve(repositoryRoot, "coverage/sdk-proof-off");
const lcovPath = resolve(coverageDirectory, "lcov.info");
const apiCoverageDirectory = resolve(
  repositoryRoot,
  "coverage/projection-proof-off",
);
const apiLcovPath = resolve(apiCoverageDirectory, "lcov.info");

if (coverageEnabled) {
  mkdirSync(coverageDirectory, { recursive: true });
  mkdirSync(apiCoverageDirectory, { recursive: true });
}

if (process.env.PROOFS_ENABLED === "true") {
  throw new Error(
    "This implementation wave is proof-disabled. Set PROOFS_ENABLED=false.",
  );
}

const nodeArguments = [
  "--loader",
  tsNodeLoader,
  ...(coverageEnabled
    ? [
        "--experimental-test-coverage",
        "--test-reporter=spec",
        "--test-reporter-destination=stdout",
        "--test-reporter=lcov",
        `--test-reporter-destination=${lcovPath}`,
      ]
    : []),
  "--test",
  "--test-concurrency=4",
  "--test-isolation=process",
  ...sdkTestFiles,
];

const result = spawnSync(process.execPath, nodeArguments, {
  cwd: sdkRoot,
  env: {
    ...process.env,
    NODE_NO_WARNINGS: "1",
    O1JS_BACKEND: "native",
    O1JS_REQUIRE_NATIVE_BINDINGS: "1",
    PROOFS_ENABLED: "false",
    TS_NODE_PROJECT: resolve(sdkRoot, "tsconfig.json"),
  },
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

let exitStatus = result.status ?? 1;

if (exitStatus === 0 && apiTestFiles.length > 0) {
  const apiArguments = [
    "--loader",
    apiTsNodeLoader,
    ...(coverageEnabled
      ? [
          "--experimental-test-coverage",
          "--test-reporter=spec",
          "--test-reporter-destination=stdout",
          "--test-reporter=lcov",
          `--test-reporter-destination=${apiLcovPath}`,
        ]
      : []),
    "--test",
    "--test-concurrency=1",
    "--test-isolation=process",
    ...apiTestFiles,
  ];
  const apiResult = spawnSync(process.execPath, apiArguments, {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
      O1JS_BACKEND: "native",
      O1JS_REQUIRE_NATIVE_BINDINGS: "1",
      PROOFS_ENABLED: "false",
      TS_NODE_PROJECT: resolve(apiRoot, "tsconfig.json"),
    },
    stdio: "inherit",
  });
  if (apiResult.error) {
    throw apiResult.error;
  }
  exitStatus = apiResult.status ?? 1;
}

if (coverageEnabled) {
  const normalized = readFileSync(lcovPath, "utf8").replace(
    /^SF:(.+)$/gmu,
    (_line, sourcePath) =>
      `SF:${relative(repositoryRoot, resolve(sdkRoot, sourcePath)).replaceAll("\\", "/")}`,
  );
  writeFileSync(lcovPath, normalized);

  if (apiTestFiles.length > 0 && exitStatus === 0) {
    const normalizedApi = readFileSync(apiLcovPath, "utf8").replace(
      /^SF:(.+)$/gmu,
      (_line, sourcePath) =>
        `SF:${relative(repositoryRoot, resolve(repositoryRoot, sourcePath)).replaceAll("\\", "/")}`,
    );
    writeFileSync(apiLcovPath, normalizedApi);
  }

  if (exitStatus === 0) {
    const postCoverageEnvironment = { ...process.env };
    delete postCoverageEnvironment.NODE_V8_COVERAGE;
    delete postCoverageEnvironment.PROVABLE_COVERAGE;
    const postCoverageResult = spawnSync(
      process.execPath,
      ["--test", ...postCoverageTestFiles],
      {
        cwd: sdkRoot,
        env: {
          ...postCoverageEnvironment,
          NODE_NO_WARNINGS: "1",
          PROOFS_ENABLED: "false",
        },
        stdio: "inherit",
      },
    );
    if (postCoverageResult.error) {
      throw postCoverageResult.error;
    }
    exitStatus = postCoverageResult.status ?? 1;
  }
}

process.exitCode = exitStatus;
