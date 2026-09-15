import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const LCOV_PATH = resolve(REPOSITORY_ROOT, "coverage/sdk-proof-off/lcov.info");
const SUMMARY_FIELDS = ["LF", "LH", "FNF", "FNH", "BRF", "BRH"];
const KNOWN_PROVABLE_EXECUTION = [
  {
    source: "packages/sdk/src/provable/account.ts",
    line: 238,
    branchLine: 238,
  },
  {
    source:
      "packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts",
    line: 411,
    branchLine: 411,
  },
  {
    source: "packages/sdk/src/provable/hashing-helpers.ts",
    line: 21,
    branchLine: 21,
  },
  {
    source: "packages/sdk/src/provable/merkle-tree/prefixed-merkle-tree.ts",
    line: 96,
    branchLine: 96,
  },
  {
    source: "packages/sdk/src/provable/staking-ledger-to-voting-ledger.ts",
    line: 181,
    branchLine: 181,
  },
  {
    source: "packages/sdk/src/provable/voting-account.ts",
    line: 10,
    branchLine: 10,
  },
];

function parseCount(value, label) {
  assert.match(value, /^\d+$/u, `${label} must be a nonnegative integer`);
  return Number(value);
}

function parseLcov(source) {
  const records = [];
  const blocks = source
    .split(/^end_of_record\s*$/gmu)
    .map((block) => block.trim())
    .filter(Boolean);

  for (const [recordIndex, block] of blocks.entries()) {
    const lines = block.split(/\r?\n/u);
    const sourceRows = lines.filter((line) => line.startsWith("SF:"));
    assert.equal(
      sourceRows.length,
      1,
      `record ${recordIndex} must contain one SF row`,
    );
    const sourcePath = sourceRows[0].slice(3);
    const summaries = Object.fromEntries(
      SUMMARY_FIELDS.map((field) => {
        const rows = lines.filter((line) => line.startsWith(`${field}:`));
        assert.equal(
          rows.length,
          1,
          `${sourcePath} must contain one ${field} row`,
        );
        return [field, parseCount(rows[0].slice(field.length + 1), field)];
      }),
    );
    const lineData = lines
      .filter((line) => line.startsWith("DA:"))
      .map((line) => {
        const [lineNumber, hits] = line.slice(3).split(",");
        return {
          line: parseCount(lineNumber, `${sourcePath} DA line`),
          hits: parseCount(hits, `${sourcePath} DA hits`),
        };
      });
    const functions = lines.filter((line) => line.startsWith("FN:"));
    const functionData = lines
      .filter((line) => line.startsWith("FNDA:"))
      .map((line) => {
        const separator = line.indexOf(",");
        assert.ok(separator > 5, `${sourcePath} has a malformed FNDA row`);
        return {
          hits: parseCount(line.slice(5, separator), `${sourcePath} FNDA hits`),
        };
      });
    const branchData = lines
      .filter((line) => line.startsWith("BRDA:"))
      .map((line) => {
        const [lineNumber, _block, _branch, hits] = line.slice(5).split(",");
        assert.ok(hits !== undefined, `${sourcePath} has a malformed BRDA row`);
        return {
          line: parseCount(lineNumber, `${sourcePath} BRDA line`),
          hits:
            hits === "-" ? null : parseCount(hits, `${sourcePath} BRDA hits`),
        };
      });

    const calculated = {
      LF: lineData.length,
      LH: lineData.filter(({ hits }) => hits > 0).length,
      FNF: functions.length,
      FNH: functionData.filter(({ hits }) => hits > 0).length,
      BRF: branchData.length,
      BRH: branchData.filter(({ hits }) => hits !== null && hits > 0).length,
    };
    assert.equal(
      functionData.length,
      functions.length,
      `${sourcePath} FN and FNDA rows must have equal counts`,
    );
    assert.deepEqual(
      summaries,
      calculated,
      `${sourcePath} summary counters must match detail rows`,
    );
    for (const [found, hit] of [
      [summaries.LF, summaries.LH],
      [summaries.FNF, summaries.FNH],
      [summaries.BRF, summaries.BRH],
    ]) {
      assert.ok(hit <= found, `${sourcePath} hit count exceeds found count`);
    }

    records.push({
      sourcePath,
      summaries,
      lineData,
      branchData,
    });
  }

  return records;
}

async function codecovStatus() {
  const configCandidates = [".codecov.yml", "codecov.yml", "codecov.yaml"];
  const configuredFiles = [];
  for (const candidate of configCandidates) {
    try {
      await access(resolve(REPOSITORY_ROOT, candidate));
      configuredFiles.push(candidate);
    } catch {
      // An absent optional config is the expected Phase A state.
    }
  }

  const workflowDirectory = resolve(REPOSITORY_ROOT, ".github/workflows");
  for (const entry of await readdir(workflowDirectory, {
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !/\.ya?ml$/u.test(entry.name)) continue;
    const workflowPath = resolve(workflowDirectory, entry.name);
    const workflow = await readFile(workflowPath, "utf8");
    if (/codecov\/codecov-action|CODECOV_TOKEN/iu.test(workflow)) {
      configuredFiles.push(`.github/workflows/${entry.name}`);
    }
  }

  return {
    status: configuredFiles.length === 0 ? "NOT_CONFIGURED" : "CONFIGURED",
    configuredFiles,
  };
}

test("QA-COVERAGE-001 validates proof-off LCOV source maps and counters", async (t) => {
  assert.equal(process.env.PROOFS_ENABLED, "false");
  const lcov = await readFile(LCOV_PATH, "utf8");
  assert.ok(lcov.trim().length > 0, "LCOV must not be empty");

  const records = parseLcov(lcov);
  assert.ok(records.length > 0, "LCOV must contain source records");
  const bySource = new Map();

  for (const record of records) {
    const { sourcePath } = record;
    assert.equal(
      isAbsolute(sourcePath),
      false,
      `${sourcePath} must be relative`,
    );
    assert.equal(sourcePath.includes("\\"), false, `${sourcePath} uses "/"`);
    assert.equal(
      sourcePath.split("/").includes(".."),
      false,
      `${sourcePath} must stay in the repository`,
    );
    assert.match(
      sourcePath,
      /\.(?:[cm]?[jt]sx?)$/u,
      `${sourcePath} must map to a JavaScript or TypeScript source`,
    );
    assert.equal(bySource.has(sourcePath), false, `duplicate SF ${sourcePath}`);
    await access(resolve(REPOSITORY_ROOT, sourcePath));
    bySource.set(sourcePath, record);
  }

  const aggregate = Object.fromEntries(
    SUMMARY_FIELDS.map((field) => [
      field,
      records.reduce((sum, record) => sum + record.summaries[field], 0),
    ]),
  );
  assert.ok(aggregate.LF > 0 && aggregate.FNF > 0 && aggregate.BRF > 0);
  assert.ok(aggregate.LH <= aggregate.LF);
  assert.ok(aggregate.FNH <= aggregate.FNF);
  assert.ok(aggregate.BRH <= aggregate.BRF);

  const knownExecution = [];
  for (const known of KNOWN_PROVABLE_EXECUTION) {
    const record = bySource.get(known.source);
    assert.ok(record, `missing main provable source ${known.source}`);
    assert.ok(
      record.lineData.some(({ line, hits }) => line === known.line && hits > 0),
      `${known.source}:${known.line} must be executed`,
    );
    assert.ok(
      record.branchData.some(
        ({ line, hits }) =>
          line === known.branchLine && hits !== null && hits > 0,
      ),
      `${known.source}:${known.branchLine} must have an executed branch`,
    );
    knownExecution.push({
      source: known.source,
      line: known.line,
      branchLine: known.branchLine,
    });
  }

  const codecov = await codecovStatus();
  assert.equal(codecov.status, "NOT_CONFIGURED");
  t.diagnostic(
    JSON.stringify({
      lcov: "coverage/sdk-proof-off/lcov.info",
      records: records.length,
      aggregate,
      knownExecution,
      codecov,
    }),
  );
});

test("QA-COVERAGE-004 records Phase A Codecov state", async () => {
  assert.deepEqual(await codecovStatus(), {
    status: "NOT_CONFIGURED",
    configuredFiles: [],
  });
});
