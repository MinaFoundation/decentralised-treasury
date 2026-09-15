import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import { register } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const LCOV_PATH = resolve(REPOSITORY_ROOT, "coverage/sdk-proof-off/lcov.info");
const COVERAGE_RUNNER_PATH = resolve(
  REPOSITORY_ROOT,
  "devops/scripts/run-node-test-coverage.mjs",
);
const MATRIX_RUNNER_PATH = resolve(
  REPOSITORY_ROOT,
  "devops/test/run-provable-matrix.mjs",
);
const THRESHOLDS = Object.freeze({
  lines: 80,
  functions: 80,
  branches: 75,
  perFileLines: 60,
});

function ensureTypeScriptLoader() {
  if (process.execArgv.some((argument) => argument.includes("ts-node/esm"))) {
    return;
  }
  process.env.TS_NODE_PROJECT ??= resolve(
    REPOSITORY_ROOT,
    "packages/sdk/tsconfig.json",
  );
  register(
    pathToFileURL(
      resolve(REPOSITORY_ROOT, "packages/sdk/node_modules/ts-node/esm.mjs"),
    ).href,
    pathToFileURL(`${REPOSITORY_ROOT}/`).href,
  );
}

function parseLcov(source) {
  return source
    .split(/^end_of_record\s*$/gmu)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const rows = block.split(/\r?\n/u);
      const value = (name) => {
        const row = rows.find((candidate) => candidate.startsWith(`${name}:`));
        assert.ok(row, `LCOV record is missing ${name}`);
        return Number(row.slice(name.length + 1));
      };
      const sourceRow = rows.find((row) => row.startsWith("SF:"));
      assert.ok(sourceRow, "LCOV record is missing SF");
      return {
        source: sourceRow.slice(3),
        lines: { found: value("LF"), hit: value("LH") },
        functions: { found: value("FNF"), hit: value("FNH") },
        branches: { found: value("BRF"), hit: value("BRH") },
      };
    });
}

function percentage({ found, hit }) {
  return found === 0 ? 100 : (hit / found) * 100;
}

function summarizeCoverage(records) {
  const aggregate = Object.fromEntries(
    ["lines", "functions", "branches"].map((dimension) => [
      dimension,
      records.reduce(
        (sum, record) => ({
          found: sum.found + record[dimension].found,
          hit: sum.hit + record[dimension].hit,
        }),
        { found: 0, hit: 0 },
      ),
    ]),
  );
  const percentages = Object.fromEntries(
    Object.entries(aggregate).map(([name, counts]) => [
      name,
      Number(percentage(counts).toFixed(2)),
    ]),
  );
  const perFileBelowMinimum = records
    .map((record) => ({
      source: record.source,
      lines: Number(percentage(record.lines).toFixed(2)),
    }))
    .filter(({ lines }) => lines < THRESHOLDS.perFileLines)
    .sort((left, right) => left.source.localeCompare(right.source));
  const globalFailures = ["lines", "functions", "branches"].filter(
    (dimension) => percentages[dimension] < THRESHOLDS[dimension],
  );
  return { aggregate, percentages, perFileBelowMinimum, globalFailures };
}

async function codecovConfiguration() {
  const configured = [];
  for (const candidate of [".codecov.yml", "codecov.yml", "codecov.yaml"]) {
    try {
      await access(resolve(REPOSITORY_ROOT, candidate));
      configured.push(candidate);
    } catch {
      // An absent file is part of the current recorded state.
    }
  }
  const workflowDirectory = resolve(REPOSITORY_ROOT, ".github/workflows");
  for (const entry of await readdir(workflowDirectory, {
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !/\.ya?ml$/u.test(entry.name)) continue;
    const relativePath = `.github/workflows/${entry.name}`;
    const source = await readFile(
      resolve(REPOSITORY_ROOT, relativePath),
      "utf8",
    );
    if (/codecov\/codecov-action|CODECOV_TOKEN/iu.test(source)) {
      configured.push(relativePath);
    }
  }
  return {
    status: configured.length === 0 ? "NOT_CONFIGURED" : "CONFIGURED",
    configured,
  };
}

function requireCurrentCodecovFlag({ current, previous }) {
  if (current !== "success") {
    const error = new Error(
      `HOST_PREFLIGHT: current Codecov flag is ${current ?? "missing"}`,
    );
    error.failureClass = "HOST_PREFLIGHT";
    error.previous = previous;
    throw error;
  }
}

test("QA-COVERAGE-002 records thresholds, explicit LCOV rows, and the current non-gating result", async (t) => {
  assert.equal(process.env.PROOFS_ENABLED, "false");
  const [lcov, coverageRunner, matrixRunner] = await Promise.all([
    readFile(LCOV_PATH, "utf8"),
    readFile(COVERAGE_RUNNER_PATH, "utf8"),
    readFile(MATRIX_RUNNER_PATH, "utf8"),
  ]);
  const records = parseLcov(lcov);
  assert.equal(
    new Set(records.map(({ source }) => source)).size,
    records.length,
  );
  for (const threshold of [
    "--test-coverage-lines=80",
    "--test-coverage-functions=80",
    "--test-coverage-branches=75",
    "PER_FILE_LINE_MINIMUM = 60",
  ]) {
    assert.ok(
      coverageRunner.includes(threshold),
      `missing policy ${threshold}`,
    );
  }

  const summary = summarizeCoverage(records);
  const gateWired = [
    "--test-coverage-lines=80",
    "--test-coverage-functions=80",
    "--test-coverage-branches=75",
  ].every((flag) => matrixRunner.includes(flag));
  const status =
    gateWired &&
    summary.globalFailures.length === 0 &&
    summary.perFileBelowMinimum.length === 0
      ? "PASS"
      : "NOT_READY";

  assert.equal(gateWired, false);
  assert.equal(status, "NOT_READY");
  assert.ok(summary.globalFailures.length > 0);
  assert.ok(summary.perFileBelowMinimum.length > 0);
  t.diagnostic(
    JSON.stringify({
      thresholds: THRESHOLDS,
      explicitSourceRows: records.length,
      gateWired,
      status,
      ...summary,
    }),
  );
});

test("QA-COVERAGE-003 records the import-driven denominator and missing reviewed exclusions", async (t) => {
  const [lcov, coverageRunner, matrixRunner] = await Promise.all([
    readFile(LCOV_PATH, "utf8"),
    readFile(COVERAGE_RUNNER_PATH, "utf8"),
    readFile(MATRIX_RUNNER_PATH, "utf8"),
  ]);
  const sources = parseLcov(lcov)
    .map(({ source }) => source)
    .sort();
  const denominatorHash = createHash("sha256")
    .update(sources.join("\n"))
    .digest("hex");
  const usesDynamicInclude = coverageRunner.includes("glob(include");
  const usesCliExclusions = coverageRunner.includes(
    'argument.startsWith("--exclude=")',
  );
  const matrixFreezesInclude = matrixRunner.includes(
    "--test-coverage-include=",
  );
  const matrixFreezesExclusions = matrixRunner.includes(
    "--test-coverage-exclude=",
  );

  assert.equal(usesDynamicInclude, true);
  assert.equal(usesCliExclusions, true);
  assert.equal(matrixFreezesInclude, false);
  assert.equal(matrixFreezesExclusions, false);
  t.diagnostic(
    JSON.stringify({
      status: "NOT_FROZEN",
      denominator: {
        sourceCount: sources.length,
        sha256: denominatorHash,
        first: sources[0],
        last: sources.at(-1),
      },
      exclusions: {
        status: "NOT_REVIEWED",
        source: "command-line only",
      },
    }),
  );
});

test("QA-COVERAGE-005 publishes deterministic semantic assurance category totals", async (t) => {
  ensureTypeScriptLoader();
  const {
    assuranceCases,
    assuranceLeaves,
    summarizeManifest,
    validateManifest,
  } = await import("../../../../packages/sdk/test/assurance/case-manifest.ts");
  assert.deepEqual(validateManifest(), []);
  const searchableText = (testCase) =>
    [
      testCase.title,
      testCase.fixture,
      testCase.proofOff.note,
      testCase.proofOn.note,
    ].join(" ");
  const countMatching = (pattern) =>
    assuranceCases.filter((testCase) => pattern.test(searchableText(testCase)))
      .length;
  const rejectionLayers = Object.fromEntries(
    assuranceCases
      .filter(({ proofOff }) => proofOff.outcome === "reject")
      .reduce((counts, testCase) => {
        const failureClass = testCase.proofOff.failureClass;
        counts.set(failureClass, (counts.get(failureClass) ?? 0) + 1);
        return counts;
      }, new Map()),
  );
  const categories = {
    mutation: countMatching(
      /mutation|malformed|wrong|invalid|missing|truncat|corrupt|stale|reorder|duplicate|overflow|underflow/iu,
    ),
    recursion: assuranceCases.filter(({ family }) =>
      /ZK-(?:STLV-(?:MERGE|EXHAUST)|VOTE-MERGE)/u.test(family),
    ).length,
    key: countMatching(/key|signature|signer|sender|voter|multisig/iu),
    serialization: countMatching(/serializ|json|payload|codec|decode|encode/iu),
    contract: assuranceCases.filter(({ family }) => family.startsWith("SC-"))
      .length,
    restart: assuranceCases.filter(({ family }) => family === "OPS-RESTART")
      .length,
    vector: countMatching(/vector/iu),
  };
  for (const [name, count] of Object.entries(categories)) {
    assert.ok(count > 0, `${name} total must be nonzero`);
  }
  const proofOffLeaves = assuranceLeaves.filter(
    ({ executable, mode }) => executable && mode === "proof-off",
  ).length;
  const proofOnLeaves = assuranceLeaves.filter(
    ({ executable, mode }) => executable && mode === "proof-on",
  ).length;
  const exceptions = assuranceCases.filter(
    ({ proofOff, proofOn }) =>
      proofOff.outcome === "not-applicable" ||
      proofOn.outcome === "not-applicable",
  );
  assert.equal(proofOnLeaves - proofOffLeaves, 4);
  assert.ok(exceptions.every(({ policyIds }) => policyIds?.length));

  t.diagnostic(
    JSON.stringify({
      manifest: summarizeManifest(),
      categories,
      rejectionLayers,
      proofOnLeafDifference: proofOnLeaves - proofOffLeaves,
      approvedExceptions: exceptions.map(({ id, phasePolicy, policyIds }) => ({
        id,
        phasePolicy,
        policyIds,
      })),
      taxonomy: "title, fixture, and mode-note lexical categories",
    }),
  );
});

test("QA-COVERAGE-006 rejects a missing current Codecov flag even if an older flag passed", async (t) => {
  const configuration = await codecovConfiguration();
  assert.deepEqual(configuration, {
    status: "NOT_CONFIGURED",
    configured: [],
  });
  assert.throws(
    () =>
      requireCurrentCodecovFlag({ current: undefined, previous: "success" }),
    (error) => {
      assert.equal(error.failureClass, "HOST_PREFLIGHT");
      assert.equal(error.previous, "success");
      return true;
    },
  );
  t.diagnostic(
    JSON.stringify({
      configuration,
      currentFlag: "MISSING",
      previousFlag: "IGNORED",
      result: "HOST_PREFLIGHT",
    }),
  );
});
