import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSameImages,
  cleanupComposeProject,
  composeImages,
  composePassEnvironment,
  composeProjectName,
  composeRunId,
  composeSourceFingerprint,
  runComposePass,
  runLogged,
} from "./compose-e2e-runner.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("proof modes use fresh projects and do not share a build flag", () => {
  const base = {
    NODE_V8_COVERAGE: "/tmp/native-coverage",
    COMPOSE_E2E_NO_BUILD: "1",
    COMPOSE_E2E_SKIP_BROWSER: "1",
    COMPOSE_E2E_KEEP_STACK: "1",
  };
  const disabled = composePassEnvironment({
    env: base,
    mode: "false",
    runId: "pair-1",
  });
  const enabled = composePassEnvironment({
    env: base,
    mode: "true",
    runId: "pair-1",
  });
  assert.notEqual(
    disabled.COMPOSE_E2E_PROJECT_NAME,
    enabled.COMPOSE_E2E_PROJECT_NAME,
  );
  assert.equal(
    disabled.COMPOSE_E2E_PROJECT_NAME,
    composeProjectName("pair-1", "false"),
  );
  assert.equal(disabled.COMPOSE_E2E_NO_BUILD, undefined);
  assert.equal(enabled.COMPOSE_E2E_NO_BUILD, "1");
  assert.equal(disabled.NODE_V8_COVERAGE, "/tmp/native-coverage");
  assert.equal(enabled.NODE_V8_COVERAGE, "/tmp/native-coverage");
  assert.equal(disabled.COMPOSE_E2E_SKIP_BROWSER, undefined);
  assert.equal(enabled.COMPOSE_E2E_SKIP_BROWSER, undefined);
  assert.equal(disabled.COMPOSE_E2E_KEEP_STACK, undefined);
  assert.equal(enabled.COMPOSE_E2E_KEEP_STACK, undefined);
  assert.equal(disabled.COMPOSE_E2E_ORDERED_RUN, "1");
  assert.equal(enabled.COMPOSE_E2E_ORDERED_RUN, "1");
  assert.equal(disabled.PROOFS_ENABLED, "false");
  assert.equal(enabled.PROOFS_ENABLED, "true");
});

test("Compose cleanup accepts an absent exact project", async () => {
  const calls = [];
  const cleaned = await cleanupComposeProject(
    "treasury-compose-abc-false",
    async (args) => {
      calls.push(args);
      return "";
    },
  );
  assert.deepEqual(cleaned, { containers: [], networks: [], volumes: [] });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((args) => args.includes("ls")));
  assert.ok(
    calls.every((args) =>
      args.includes(
        "label=com.docker.compose.project=treasury-compose-abc-false",
      ),
    ),
  );
});

for (const { kind, identifier, inspected } of [
  {
    kind: "container",
    identifier: "a".repeat(64),
    inspected: (identifier) => ({
      Id: identifier,
      Config: {
        Labels: { "com.docker.compose.project": "different-project" },
      },
    }),
  },
  {
    kind: "network",
    identifier: "b".repeat(64),
    inspected: (identifier) => ({
      Id: identifier,
      Labels: { "com.docker.compose.project": "different-project" },
    }),
  },
  {
    kind: "volume",
    identifier: "different-project_data",
    inspected: (identifier) => ({
      Name: identifier,
      Labels: { "com.docker.compose.project": "different-project" },
    }),
  },
]) {
  test(`Compose cleanup rejects a ${kind} with the wrong exact label`, async () => {
    const calls = [];
    await assert.rejects(
      cleanupComposeProject("treasury-compose-abc-true", async (args) => {
        calls.push(args);
        if (args[1] === "ls") {
          return args[0] === kind ? `${identifier}\n` : "";
        }
        if (args[0] === kind && args[1] === "inspect") {
          return JSON.stringify([inspected(identifier)]);
        }
        throw new Error(`unexpected Docker call ${args.join(" ")}`);
      }),
      /different Compose project label/u,
    );
    assert.equal(
      calls.some((args) => args.includes("rm")),
      false,
    );
  });
}

test("the ordered runner ID is reused by the Compose pair", () => {
  assert.equal(
    composeRunId({ E2E_RUN_ID: "ordered-pair-7" }),
    "ordered-pair-7",
  );
  assert.equal(
    composeRunId({
      E2E_ARTIFACT_DIRECTORY:
        "/repo/coverage/local-e2e/ordered-pair-8/proofs-false/compose",
    }),
    "ordered-pair-8",
  );
  assert.throws(
    () => composeRunId({ E2E_RUN_ID: "../escape" }),
    /Invalid Compose E2E run ID/u,
  );
});

test("image verification compares exact IDs for every Compose image", () => {
  const tags = composeImages({});
  const expected = Object.fromEntries(
    Object.entries(tags).map(([name, tag], index) => [
      name,
      { tag, id: `sha256:${index}` },
    ]),
  );
  assert.doesNotThrow(() =>
    assertSameImages(expected, structuredClone(expected)),
  );
  const changed = structuredClone(expected);
  changed.WEB_IMAGE.id = "sha256:changed";
  assert.throws(
    () => assertSameImages(expected, changed),
    /image IDs changed/u,
  );
});

test("the Compose fingerprint includes workflow and deployed runtime inputs", async () => {
  const fingerprint = await composeSourceFingerprint(root);
  const paths = new Set(fingerprint.files.map(({ path }) => path));
  for (const path of [
    "devops/test/compose-e2e.mjs",
    "devops/test/compose-e2e-runner.mjs",
    "devops/test/local-e2e-sources.mjs",
    "devops/compose.yml",
    ".dockerignore",
    "devops/docker/Dockerfile",
    "devops/proxy/Caddyfile",
    "apps/cli/src/cli.ts",
    "apps/api/tsconfig.json",
    "apps/web/next.config.js",
    "apps/backoffice/next.config.js",
    "packages/sdk/src/index.ts",
    "packages/sdk/tsconfig.json",
    "packages/typescript-config/base.json",
    "packages/local-blockchain/src/server.ts",
    "patches/@ledgerhq__hw-transport-webhid@6.36.0.patch",
  ]) {
    assert.ok(paths.has(path), `missing fingerprint input ${path}`);
  }
  assert.match(fingerprint.hash, /^[a-f0-9]{64}$/u);
});

async function prerequisiteFixture(t) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "compose-pair-gate-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const runId = "pair-gate";
  const scriptPath = join(fixtureRoot, "devops/test/compose-e2e.mjs");
  const runRoot = join(fixtureRoot, "devops/.data/e2e/runs", runId);
  await mkdir(dirname(scriptPath), { recursive: true });
  await mkdir(runRoot, { recursive: true });
  await writeFile(scriptPath, "// fixture\n");
  const scriptHash = createHash("sha256")
    .update(await readFile(scriptPath))
    .digest("hex");
  const source = { hash: "a".repeat(64), files: [] };
  let childStarts = 0;
  const operations = {
    sourceFingerprint: async () => source,
    inspectImages: async () => ({}),
    runLogged: async () => {
      childStarts += 1;
      return { code: 0, signal: null };
    },
  };
  return {
    fixtureRoot,
    runId,
    runRoot,
    scriptHash,
    source,
    operations,
    childStarts: () => childStarts,
  };
}

async function writeProofOffLock(fixture, overrides = {}) {
  const resultPath = join(fixture.runRoot, "workflow-result-proofs-false.json");
  await writeFile(resultPath, "proof-off-result\n");
  const resultHash = createHash("sha256")
    .update(await readFile(resultPath))
    .digest("hex");
  await writeFile(
    join(fixture.runRoot, "proof-off-images.json"),
    JSON.stringify({
      status: "passed",
      runId: fixture.runId,
      sourceHash: fixture.source.hash,
      composeScriptSha256: fixture.scriptHash,
      workflowResultPath: resultPath,
      workflowResultSha256: resultHash,
      images: {},
      ...overrides,
    }),
  );
  return resultPath;
}

for (const scenario of [
  "missing lock",
  "changed lock",
  "missing result",
  "changed result",
  "changed source",
  "changed images",
]) {
  test(`proof-on does not start with ${scenario}`, async (t) => {
    const fixture = await prerequisiteFixture(t);
    if (scenario !== "missing lock") {
      const resultPath = await writeProofOffLock(
        fixture,
        scenario === "changed lock"
          ? { runId: "different-pair" }
          : scenario === "changed result"
            ? { workflowResultSha256: "b".repeat(64) }
            : scenario === "changed source"
              ? { sourceHash: "b".repeat(64) }
              : scenario === "changed images"
                ? { images: { APP_IMAGE: { id: "sha256:expected" } } }
                : {},
      );
      if (scenario === "missing result") await rm(resultPath);
      if (scenario === "changed images") {
        fixture.operations.inspectImages = async () => ({
          APP_IMAGE: { id: "sha256:changed" },
        });
      }
    }
    await assert.rejects(
      runComposePass({
        root: fixture.fixtureRoot,
        env: {
          PROOFS_ENABLED: "true",
          COMPOSE_E2E_RUN_ID: fixture.runId,
        },
        operations: fixture.operations,
      }),
    );
    assert.equal(fixture.childStarts(), 0);
    const result = JSON.parse(
      await readFile(
        join(fixture.runRoot, "workflow-result-proofs-true.json"),
        "utf8",
      ),
    );
    assert.equal(result.status, "blocked");
    assert.equal(result.workflowCount, 0);
  });
}

test("CI evidence publishes proofs and metadata without private runtime data", async (t) => {
  const fixture = await prerequisiteFixture(t);
  const artifactDirectory = join(fixture.fixtureRoot, "ci-artifacts");
  const proofDirectory = join(
    fixture.runRoot,
    "proofs-false",
    "proof-artifacts",
  );
  const operations = {
    sourceFingerprint: async () => fixture.source,
    inspectImages: async () => ({
      APP_IMAGE: { tag: "app", id: "sha256:app" },
    }),
    runLogged: async (_command, _args, { logPath }) => {
      await mkdir(proofDirectory, { recursive: true });
      for (const name of [
        "staking-ledger.json",
        "staking-ledger-proof.json",
        "vote-actions.json",
        "vote-reducer-proof.json",
      ]) {
        await writeFile(join(proofDirectory, name), '{"proof":"public"}\n');
      }
      await writeFile(logPath, "privateKey=must-not-be-published\n");
      return { code: 0, signal: null };
    },
  };
  const result = await runComposePass({
    root: fixture.fixtureRoot,
    env: {
      PROOFS_ENABLED: "false",
      COMPOSE_E2E_RUN_ID: fixture.runId,
      E2E_ARTIFACT_DIRECTORY: artifactDirectory,
    },
    operations,
  });
  assert.equal(result.status, "passed");
  const published = await readdir(join(artifactDirectory, "compose-workflow"), {
    recursive: true,
  });
  assert.ok(published.includes("workflow-result.json"));
  assert.equal(
    published.filter((path) => path.startsWith("proof-artifacts/")).length,
    4,
  );
  assert.deepEqual(
    published.filter((path) => path.endsWith(".log")),
    ["workflow-summary.log"],
  );
  assert.equal(
    published.some((path) => /cache|sqlite/iu.test(path)),
    false,
  );
  const publicResult = await readFile(
    join(artifactDirectory, "compose-workflow/workflow-result.json"),
    "utf8",
  );
  assert.doesNotMatch(publicResult, /must-not-be-published|privateKey/u);
  assert.doesNotMatch(
    await readFile(
      join(artifactDirectory, "compose-workflow/workflow-summary.log"),
      "utf8",
    ),
    /must-not-be-published|privateKey/u,
  );
});

test("split private-key output stays in the ignored private log", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "compose-private-log-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logPath = join(directory, "workflow.log");
  let publicOutput = "";
  const outcome = await runLogged(
    process.execPath,
    [
      "-e",
      "process.stdout.write('private'); setTimeout(() => process.stdout.write('Key=EKF-secret'), 5)",
    ],
    {
      cwd: directory,
      env: process.env,
      logPath,
      publicOutput: { write: (chunk) => (publicOutput += chunk) },
    },
  );
  assert.equal(outcome.code, 0);
  assert.match(await readFile(logPath, "utf8"), /privateKey=EKF-secret/u);
  assert.doesNotMatch(publicOutput, /private|EKF-secret/u);
  assert.match(publicOutput, /workflowProcess=start/u);
  assert.match(publicOutput, /workflowProcess=end code=0/u);
});
