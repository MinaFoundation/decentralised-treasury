import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { register } from "node:module";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const FIXTURE_ID = "performance-proof-off-merge-eight-spans-seed-801";
const COLD_SAMPLE_COUNT = 3;
const WARM_SAMPLE_COUNT = 5;

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

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function coverageFlags() {
  return {
    execArgv: process.execArgv.filter((argument) =>
      /coverage|NODE_V8_COVERAGE/iu.test(argument),
    ),
    nodeV8Coverage: process.env.NODE_V8_COVERAGE,
    provableCoverage: process.env.PROVABLE_COVERAGE,
  };
}

function statistics(values) {
  assert.ok(values.length > 0);
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  return {
    observations: values.map((value) => Number(value.toFixed(6))),
    median: Number(median.toFixed(6)),
    range: [Number(sorted[0].toFixed(6)), Number(sorted.at(-1).toFixed(6))],
    maximum: Number(sorted.at(-1).toFixed(6)),
  };
}

function findMergeableSpans(proofs) {
  for (const first of proofs) {
    for (const second of proofs) {
      if (first === second) continue;
      if (first.proof.to + 1 === second.proof.from) {
        return { proof1: first, proof2: second };
      }
    }
  }
  return { proof1: undefined, proof2: undefined };
}

function createMergeHarness(MergeProofOrchestrator) {
  const base = new Map(
    Array.from({ length: 8 }, (_, index) => [
      String(index),
      { from: index, to: index, commitment: hash(`leaf:${index}`) },
    ]),
  );
  const merged = new Map();
  const pendingEntries = [];
  const observations = { queueCalls: 0, storageWrites: 0, obliterations: 0 };
  const storage = {
    async count() {
      return base.size;
    },
    async getProof(id) {
      return base.get(id);
    },
    async setProof(id, proof) {
      base.set(id, proof);
    },
    async getMergeProof(id) {
      return merged.get(id);
    },
    async setMergeProof(id, proof) {
      merged.set(id, structuredClone(proof));
      pendingEntries.push({ key: `merge:${id}`, value: JSON.stringify(proof) });
    },
    async markAsMerged(id) {
      pendingEntries.push({ key: `merged:${id}`, value: "true" });
    },
    async isMerged() {
      return false;
    },
    async mergeCount() {
      return merged.size;
    },
    collectEntries() {
      return [...pendingEntries];
    },
    clearEntries() {
      pendingEntries.length = 0;
    },
  };
  const batchWriter = {
    async setMany(entries) {
      observations.storageWrites += entries.length;
    },
  };
  const taskQueue = {
    async obliterate() {
      observations.obliterations += 1;
    },
    async addTask(_name, input, onComplete) {
      observations.queueCalls += 1;
      const first = input.proofs[1];
      const second = input.proofs[2];
      await onComplete({
        proof: {
          from: first.from,
          to: second.to,
          commitment: hash(`span:${first.from}:${second.to}`),
        },
      });
    },
  };
  class SpanMergeOrchestrator extends MergeProofOrchestrator {
    findMergeableProofs(proofs) {
      return findMergeableSpans(proofs);
    }
  }
  return {
    orchestrator: new SpanMergeOrchestrator(
      storage,
      batchWriter,
      taskQueue,
      "merge-span",
    ),
    observations,
    async readRoot() {
      return storage.getMergeProof("root");
    },
  };
}

async function timedMerge(harness) {
  const rssBefore = process.memoryUsage().rss;
  const queueBefore = harness.observations.queueCalls;
  const writesBefore = harness.observations.storageWrites;
  const startedAt = performance.now();
  const output = await harness.orchestrator.merge(undefined, 1);
  const elapsedMs = performance.now() - startedAt;
  const serialized = JSON.stringify(output);
  return {
    elapsedMs,
    output,
    queueCalls: harness.observations.queueCalls - queueBefore,
    storageWrites: harness.observations.storageWrites - writesBefore,
    serializedBytes: Buffer.byteLength(serialized),
    rssDeltaBytes: process.memoryUsage().rss - rssBefore,
  };
}

async function timedRootRead(harness) {
  const rssBefore = process.memoryUsage().rss;
  const startedAt = performance.now();
  const output = await harness.readRoot();
  const elapsedMs = performance.now() - startedAt;
  assert.ok(
    output,
    "warm root cache must contain the completed semantic output",
  );
  return {
    elapsedMs,
    output,
    queueCalls: 0,
    storageWrites: 0,
    serializedBytes: Buffer.byteLength(JSON.stringify(output)),
    rssDeltaBytes: process.memoryUsage().rss - rssBefore,
  };
}

async function walkFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await walkFiles(path)));
    } else if (entry.isFile()) {
      result.push(path);
    }
  }
  return result;
}

async function sourceRevision() {
  const head = (
    await readFile(resolve(REPOSITORY_ROOT, ".git/HEAD"), "utf8")
  ).trim();
  if (!head.startsWith("ref: ")) return head;
  return (
    await readFile(resolve(REPOSITORY_ROOT, ".git", head.slice(5)), "utf8")
  ).trim();
}

async function runObservations() {
  ensureTypeScriptLoader();
  const importStartedAt = performance.now();
  const { MergeProofOrchestrator } =
    await import("../../../../packages/sdk/src/proving/prover/merge-proof-orchestrator.ts");
  const moduleInitializationMs = performance.now() - importStartedAt;

  const cold = [];
  for (let index = 0; index < COLD_SAMPLE_COUNT; index += 1) {
    cold.push(await timedMerge(createMergeHarness(MergeProofOrchestrator)));
  }
  const warmHarness = createMergeHarness(MergeProofOrchestrator);
  const warmSeed = await timedMerge(warmHarness);
  const warm = [];
  for (let index = 0; index < WARM_SAMPLE_COUNT; index += 1) {
    warm.push(await timedRootRead(warmHarness));
  }
  return { moduleInitializationMs, cold, warmSeed, warm };
}

let observationsPromise;
function observations() {
  observationsPromise ??= runObservations();
  return observationsPromise;
}

test("QA-PERFORMANCE-001/002 records small proof-off cold and warm observations without p95", async (t) => {
  assert.equal(process.env.PROOFS_ENABLED, "false");
  const measured = await observations();
  const coldTimes = measured.cold.map(({ elapsedMs }) => elapsedMs);
  const warmTimes = measured.warm.map(({ elapsedMs }) => elapsedMs);
  assert.equal(coldTimes.length, COLD_SAMPLE_COUNT);
  assert.equal(warmTimes.length, WARM_SAMPLE_COUNT);
  assert.ok(coldTimes.length < 40 && warmTimes.length < 40);
  assert.ok(measured.cold.every(({ queueCalls }) => queueCalls === 7));
  assert.ok(measured.warm.every(({ queueCalls }) => queueCalls === 0));
  assert.ok(measured.cold.every(({ serializedBytes }) => serializedBytes > 0));

  const packageJson = JSON.parse(
    await readFile(
      resolve(REPOSITORY_ROOT, "packages/sdk/package.json"),
      "utf8",
    ),
  );
  const report = {
    qualification: "DIAGNOSTIC_PROOF_OFF_ONLY",
    warning: "These values are not proof-performance evidence.",
    sampleKey: {
      sourceRevision: await sourceRevision(),
      o1jsRevision: packageJson.devDependencies.o1js,
      node: process.version,
      v8: process.versions.v8,
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model ?? "unknown",
      cpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      runner: "node:test",
      fixture: FIXTURE_ID,
      proofMode: "off",
      cacheStates: ["cold", "warm"],
      coverage: "disabled",
    },
    compile: {
      status: "NOT_RUN",
      reason: "PROOFS_ENABLED=false",
      moduleInitializationMs: Number(
        measured.moduleInitializationMs.toFixed(6),
      ),
    },
    cold: {
      elapsedMs: statistics(coldTimes),
      queueCalls: measured.cold.map(({ queueCalls }) => queueCalls),
      storageWrites: measured.cold.map(({ storageWrites }) => storageWrites),
      serializedBytes: measured.cold.map(
        ({ serializedBytes }) => serializedBytes,
      ),
      rssDeltaBytes: measured.cold.map(({ rssDeltaBytes }) => rssDeltaBytes),
    },
    warm: {
      elapsedMs: statistics(warmTimes),
      queueCalls: measured.warm.map(({ queueCalls }) => queueCalls),
      storageWrites: measured.warm.map(({ storageWrites }) => storageWrites),
      serializedBytes: measured.warm.map(
        ({ serializedBytes }) => serializedBytes,
      ),
      rssDeltaBytes: measured.warm.map(({ rssDeltaBytes }) => rssDeltaBytes),
    },
  };
  assert.equal(Object.hasOwn(report.cold.elapsedMs, "p95"), false);
  assert.equal(Object.hasOwn(report.warm.elapsedMs, "p95"), false);
  t.diagnostic(JSON.stringify(report));
});

test("QA-PERFORMANCE-003 requires equal cold and warm semantic outputs", async (t) => {
  const measured = await observations();
  const expected = measured.cold[0].output;
  for (const sample of [
    ...measured.cold,
    measured.warmSeed,
    ...measured.warm,
  ]) {
    assert.deepEqual(sample.output, expected);
  }
  assert.deepEqual(
    { from: expected.from, to: expected.to },
    { from: 0, to: 7 },
  );
  assert.match(expected.commitment, /^[0-9a-f]{64}$/u);
  t.diagnostic(
    JSON.stringify({
      fixture: FIXTURE_ID,
      coldSamples: measured.cold.length,
      warmSamples: measured.warm.length,
      normalizedOutput: expected,
      equalProofBytesRequired: false,
      equalTimingRequired: false,
    }),
  );
});

test("QA-PERFORMANCE-004 records that no operation budgets are approved", async (t) => {
  const roots = [
    resolve(REPOSITORY_ROOT, ".github"),
    resolve(REPOSITORY_ROOT, "devops"),
    resolve(REPOSITORY_ROOT, "packages/sdk"),
  ];
  const files = (await Promise.all(roots.map(walkFiles))).flat();
  const budgetRegistries = files.filter((path) =>
    /(?:^|\/)(?:proof-)?performance-budgets?\.(?:json|ya?ml)$/iu.test(path),
  );
  assert.deepEqual(budgetRegistries, []);
  t.diagnostic(
    JSON.stringify({
      status: "INACTIVE",
      approvedAbsoluteBudgets: 0,
      approvedRelativeBudgets: 0,
      searchedRoots: roots.map((path) => path.slice(REPOSITORY_ROOT.length)),
    }),
  );
});

test("QA-PERFORMANCE-005 records missing production-shape soak evidence", async (t) => {
  const workflowDirectory = resolve(REPOSITORY_ROOT, ".github/workflows");
  const workflows = (await readdir(workflowDirectory)).filter((name) =>
    /\.ya?ml$/u.test(name),
  );
  const soakWorkflows = [];
  for (const workflow of workflows) {
    const source = await readFile(resolve(workflowDirectory, workflow), "utf8");
    if (/\b(?:soak|capacity)\b/iu.test(source)) soakWorkflows.push(workflow);
  }
  assert.deepEqual(soakWorkflows, []);
  t.diagnostic(
    JSON.stringify({
      status: "NOT_EVIDENCED",
      scheduledSoakWorkflows: soakWorkflows,
      missingDimensions: [
        "worker",
        "Redis",
        "SQLite",
        "S3",
        "archive",
        "lifecycle",
        "backlog",
        "memory",
        "fee payer",
        "full-ledger capacity",
      ],
      smallFixtureEstablishesCapacity: false,
    }),
  );
});

test("QA-PERFORMANCE-006 rejects coverage instrumentation in the performance process", (t) => {
  const flags = coverageFlags();
  assert.deepEqual(flags, {
    execArgv: [],
    nodeV8Coverage: undefined,
    provableCoverage: undefined,
  });
  t.diagnostic(JSON.stringify({ status: "UNINSTRUMENTED", flags }));
});
