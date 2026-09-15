import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { copyFile, glob, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { finished } from "node:stream/promises";
import { promisify } from "node:util";
import { basename, dirname, join } from "node:path";
import {
  dependencyPatchPattern,
  fingerprintSources,
} from "./local-e2e-sources.mjs";

const execFileAsync = promisify(execFile);
const imageDefaults = {
  APP_IMAGE: "decentralized-treasury:devops",
  WEB_IMAGE: "decentralized-treasury:devops-web",
  BACKOFFICE_IMAGE: "decentralized-treasury:devops-backoffice",
  POSTGRES_IMAGE: "postgres:16-alpine",
  CADDY_IMAGE: "caddy:2.8.4-alpine",
};
const proofArtifactNames = [
  "staking-ledger.json",
  "staking-ledger-proof.json",
  "vote-actions.json",
  "vote-reducer-proof.json",
];
const sourcePatterns = [
  "apps/{api,cli,web,backoffice}/{src,app,features,shims,scripts}/**/*.{ts,tsx,js,mjs}",
  "packages/{indexer,processor,sdk,ui,local-blockchain}/src/**/*.{ts,tsx,js,mjs}",
  "packages/local-blockchain/test/fixtures/**/*.{ts,tsx,js,mjs}",
  "devops/{docker,proxy}/**/*",
  "devops/compose.yml",
  "devops/test/compose-e2e*.mjs",
  "devops/test/local-e2e-sources.mjs",
  dependencyPatchPattern,
  "{.dockerignore,.npmrc,package.json,pnpm-lock.yaml,pnpm-workspace.yaml,turbo.json}",
  "apps/{api,cli,web,backoffice}/package.json",
  "apps/{api,cli,web,backoffice}/tsconfig*.json",
  "apps/{web,backoffice}/next.config.js",
  "packages/{indexer,processor,sdk,ui,local-blockchain}/package.json",
  "packages/{indexer,processor,sdk,ui,local-blockchain}/tsconfig*.json",
  "packages/typescript-config/*.json",
];

export function composeRunId(env = process.env) {
  const artifactRunId = env.E2E_ARTIFACT_DIRECTORY
    ? basename(dirname(dirname(env.E2E_ARTIFACT_DIRECTORY)))
    : undefined;
  const value =
    env.COMPOSE_E2E_RUN_ID ??
    env.E2E_RUN_ID ??
    artifactRunId ??
    new Date().toISOString().replaceAll(/[:.]/gu, "-");
  assert.match(
    value,
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u,
    "Invalid Compose E2E run ID",
  );
  return value;
}

export function composeImages(env = process.env) {
  return {
    APP_IMAGE: env.APP_IMAGE ?? imageDefaults.APP_IMAGE,
    WEB_IMAGE: env.WEB_IMAGE ?? imageDefaults.WEB_IMAGE,
    BACKOFFICE_IMAGE: env.BACKOFFICE_IMAGE ?? imageDefaults.BACKOFFICE_IMAGE,
    POSTGRES_IMAGE: imageDefaults.POSTGRES_IMAGE,
    CADDY_IMAGE: imageDefaults.CADDY_IMAGE,
  };
}

export function assertSameImages(expected, actual) {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(actual).map(([name, image]) => [name, image.id]),
    ),
    Object.fromEntries(
      Object.entries(expected).map(([name, image]) => [name, image.id]),
    ),
    "Docker image IDs changed after the successful proof-off workflow",
  );
}

export function composeProjectName(runId, mode) {
  assert.ok(mode === "false" || mode === "true", "Invalid proof mode");
  return `treasury-compose-${createHash("sha256").update(runId).digest("hex").slice(0, 12)}-${mode}`;
}

export function composePassEnvironment({ env, mode, runId }) {
  assert.ok(mode === "false" || mode === "true", "Invalid proof mode");
  const result = {
    ...env,
    COMPOSE_E2E_RUN_ID: runId,
    COMPOSE_E2E_PROJECT_NAME: composeProjectName(runId, mode),
    COMPOSE_E2E_ORDERED_RUN: "1",
    PROOFS_ENABLED: mode,
    NEXT_PUBLIC_PROOFS_ENABLED: mode,
  };
  delete result.COMPOSE_E2E_SKIP_BROWSER;
  delete result.COMPOSE_E2E_KEEP_STACK;
  if (mode === "true") result.COMPOSE_E2E_NO_BUILD = "1";
  else delete result.COMPOSE_E2E_NO_BUILD;
  return result;
}

async function sha256File(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function proofArtifactEvidence(runRoot, mode) {
  const directory = join(runRoot, `proofs-${mode}`, "proof-artifacts");
  const result = [];
  for (const name of proofArtifactNames) {
    const path = join(directory, name);
    const contents = await readFile(path);
    result.push({
      path,
      bytes: contents.length,
      sha256: createHash("sha256").update(contents).digest("hex"),
    });
  }
  return result;
}

function assertPublicJson(value, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicJson(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(
      key,
      /private.?key|secret|mnemonic|seed/iu,
      `Refusing to publish sensitive JSON field ${path}.${key}`,
    );
    assertPublicJson(child, `${path}.${key}`);
  }
}

async function publishSafeEvidence({
  root,
  runRoot,
  mode,
  env,
  result,
  resultPath,
}) {
  if (!env.E2E_ARTIFACT_DIRECTORY) return null;
  const destination = join(env.E2E_ARTIFACT_DIRECTORY, "compose-workflow");
  await mkdir(destination, { recursive: true });
  const publicResult = {
    schemaVersion: result.schemaVersion,
    runId: result.runId,
    proofsEnabled: result.proofsEnabled,
    status: result.status,
    workflowCount: result.workflowCount,
    stage: result.stage,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    durationMs: result.durationMs,
    code: result.code,
    signal: result.signal,
    failureCode:
      result.status === "blocked"
        ? "PROOF_ON_PREREQUISITE_REJECTED"
        : result.code !== 0
          ? "WORKFLOW_PROCESS_FAILED"
          : result.sourcesUnchanged === false
            ? "SOURCE_DRIFT"
            : result.evidenceError
              ? "WORKFLOW_EVIDENCE_INCOMPLETE"
              : null,
    sourceBefore: {
      hash: result.sourceBefore.hash,
      fileCount: result.sourceBefore.files.length,
    },
    sourceAfter: result.sourceAfter
      ? {
          hash: result.sourceAfter.hash,
          fileCount: result.sourceAfter.files.length,
        }
      : null,
    sourcesUnchanged: result.sourcesUnchanged,
    composeScriptSha256: result.composeScriptSha256,
    images: result.images ?? result.verifiedImagesBefore ?? null,
    proofArtifacts: (result.proofArtifacts ?? []).map(
      ({ path, ...artifact }) => ({ name: basename(path), ...artifact }),
    ),
    nativeCoverageInherited: result.nativeCoverage.inherited,
    privateWorkflowResultSha256: await sha256File(resultPath),
    privateLog: result.logSha256
      ? { sha256: result.logSha256, published: false }
      : null,
    publicationPolicy:
      "Publishes workflow metadata, public proof inputs/proofs, and failure screenshots. It excludes full logs, host CLI cache, SQLite, and local-chain admin data because these can contain private test keys or other secrets.",
  };
  await writeFile(
    join(destination, "workflow-result.json"),
    `${JSON.stringify(publicResult, null, 2)}\n`,
    { flag: "wx" },
  );
  await writeFile(
    join(destination, "workflow-summary.log"),
    [
      `runId=${result.runId}`,
      `proofsEnabled=${String(result.proofsEnabled)}`,
      `status=${result.status}`,
      `workflowCount=${result.workflowCount}`,
      `startedAt=${result.startedAt}`,
      `endedAt=${result.endedAt}`,
      `durationMs=${result.durationMs}`,
      `sourceBefore=${result.sourceBefore.hash}`,
      `sourceAfter=${result.sourceAfter?.hash ?? "not-run"}`,
      `composeScriptSha256=${result.composeScriptSha256}`,
      `privateLogPublished=false`,
      "",
    ].join("\n"),
    { flag: "wx" },
  );

  if (result.proofArtifacts?.length === proofArtifactNames.length) {
    const proofDestination = join(destination, "proof-artifacts");
    await mkdir(proofDestination, { recursive: true });
    for (const name of proofArtifactNames) {
      const source = join(runRoot, `proofs-${mode}`, "proof-artifacts", name);
      const contents = await readFile(source, "utf8");
      assertPublicJson(JSON.parse(contents));
      await copyFile(source, join(proofDestination, name));
    }
  }

  const failureRoot = join(
    root,
    "devops",
    ".data",
    "e2e-artifacts",
    "runs",
    result.runId,
    `proofs-${mode}`,
  );
  for await (const path of glob("**/*.png", { cwd: failureRoot })) {
    const target = join(destination, "failure-screenshots", path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(failureRoot, path), target);
  }
  return destination;
}

export async function composeSourceFingerprint(root) {
  const paths = [];
  for await (const path of glob(sourcePatterns, { cwd: root }))
    paths.push(path);
  return fingerprintSources(root, paths);
}

async function inspectImages(images, root) {
  const entries = Object.entries(images);
  const { stdout } = await execFileAsync(
    "docker",
    ["image", "inspect", ...entries.map(([, tag]) => tag)],
    { cwd: root, maxBuffer: 10_000_000, timeout: 30_000 },
  );
  const inspected = JSON.parse(stdout);
  assert.equal(inspected.length, entries.length, "Docker image count mismatch");
  return Object.fromEntries(
    entries.map(([name, tag], index) => [
      name,
      {
        tag,
        id: inspected[index].Id,
        createdAt: inspected[index].Created,
      },
    ]),
  );
}

async function runDocker(args) {
  const { stdout } = await execFileAsync("docker", args, {
    maxBuffer: 10_000_000,
    timeout: 30_000,
  });
  return stdout;
}

function listedResources(output) {
  return output.trim() ? output.trim().split(/\s+/u) : [];
}

export async function cleanupComposeProject(projectName, docker = runDocker) {
  assert.match(
    projectName,
    /^[a-z0-9][a-z0-9_-]{0,62}$/u,
    "Invalid Compose project name",
  );
  const label = `com.docker.compose.project=${projectName}`;
  const specifications = [
    {
      name: "containers",
      list: [
        "container",
        "ls",
        "--all",
        "--quiet",
        "--no-trunc",
        "--filter",
        `label=${label}`,
      ],
      inspect: ["container", "inspect"],
      remove: ["container", "rm", "--force"],
      identifierPattern: /^[a-f0-9]{64}$/u,
      id: (resource) => resource.Id,
      labels: (resource) => resource.Config?.Labels,
    },
    {
      name: "networks",
      list: [
        "network",
        "ls",
        "--quiet",
        "--no-trunc",
        "--filter",
        `label=${label}`,
      ],
      inspect: ["network", "inspect"],
      remove: ["network", "rm"],
      identifierPattern: /^[a-f0-9]{64}$/u,
      id: (resource) => resource.Id,
      labels: (resource) => resource.Labels,
    },
    {
      name: "volumes",
      list: ["volume", "ls", "--quiet", "--filter", `label=${label}`],
      inspect: ["volume", "inspect"],
      remove: ["volume", "rm"],
      identifierPattern: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/u,
      id: (resource) => resource.Name,
      labels: (resource) => resource.Labels,
    },
  ];
  const owned = {};
  for (const specification of specifications) {
    const selected = listedResources(await docker(specification.list));
    for (const identifier of selected) {
      assert.match(
        identifier,
        specification.identifierPattern,
        `Invalid ${specification.name.slice(0, -1)} identifier`,
      );
    }
    owned[specification.name] = selected;
    if (selected.length === 0) continue;
    const inspected = JSON.parse(
      await docker([...specification.inspect, ...selected]),
    );
    assert.deepEqual(
      new Set(inspected.map(specification.id)),
      new Set(selected),
      `${specification.name} inspection returned different resources`,
    );
    for (const resource of inspected) {
      assert.equal(
        specification.labels(resource)?.["com.docker.compose.project"],
        projectName,
        `Refusing to remove ${specification.name.slice(0, -1)} with a different Compose project label`,
      );
    }
  }
  for (const specification of specifications) {
    const selected = owned[specification.name];
    if (selected.length > 0) {
      await docker([...specification.remove, ...selected]);
    }
  }
  return owned;
}

export async function runLogged(
  command,
  args,
  { cwd, env, logPath, publicOutput = process.stdout },
) {
  const log = createWriteStream(logPath, { flags: "wx" });
  publicOutput.write("[compose-e2e-runner] workflowProcess=start\n");
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      log.write(chunk);
    });
  }
  const outcome = await new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: 1, error: error.message }));
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  log.end();
  await finished(log);
  publicOutput.write(
    `[compose-e2e-runner] workflowProcess=end code=${String(outcome.code)} signal=${outcome.signal ?? "none"}\n`,
  );
  return outcome;
}

export async function runComposePass({
  root,
  env = process.env,
  operations = {},
}) {
  const fingerprint = operations.sourceFingerprint ?? composeSourceFingerprint;
  const imageInspector = operations.inspectImages ?? inspectImages;
  const workflowRunner = operations.runLogged ?? runLogged;
  const mode = env.PROOFS_ENABLED;
  assert.ok(
    mode === "false" || mode === "true",
    "PROOFS_ENABLED must be false or true",
  );
  const runId = composeRunId(env);
  const runRoot = join(root, "devops", ".data", "e2e", "runs", runId);
  const composeScript = join(root, "devops", "test", "compose-e2e.mjs");
  const resultPath = join(runRoot, `workflow-result-proofs-${mode}.json`);
  const lockPath = join(runRoot, "proof-off-images.json");
  const logPath = join(runRoot, `workflow-proofs-${mode}.log`);
  await mkdir(runRoot, { recursive: true });

  const sourceBefore = await fingerprint(root);
  const scriptHash = await sha256File(composeScript);
  let proofOffLock;
  let verifiedImagesBefore;
  try {
    if (mode === "true") {
      proofOffLock = JSON.parse(await readFile(lockPath, "utf8"));
      assert.equal(
        proofOffLock.status,
        "passed",
        "Proof-off workflow did not pass",
      );
      assert.equal(
        proofOffLock.runId,
        runId,
        "Proof-off workflow used a different run ID",
      );
      assert.equal(
        proofOffLock.sourceHash,
        sourceBefore.hash,
        "Compose inputs changed after proof-off",
      );
      assert.equal(
        proofOffLock.composeScriptSha256,
        scriptHash,
        "Compose runner changed after proof-off",
      );
      const expectedProofOffResult = join(
        runRoot,
        "workflow-result-proofs-false.json",
      );
      assert.equal(
        proofOffLock.workflowResultPath,
        expectedProofOffResult,
        "Proof-off result path mismatch",
      );
      assert.equal(
        await sha256File(expectedProofOffResult),
        proofOffLock.workflowResultSha256,
        "Proof-off result evidence changed",
      );
      verifiedImagesBefore = await imageInspector(composeImages(env), root);
      assertSameImages(proofOffLock.images, verifiedImagesBefore);
    }
  } catch (error) {
    const now = new Date().toISOString();
    const blockedResult = {
      schemaVersion: 1,
      runId,
      proofsEnabled: mode === "true",
      status: "blocked",
      workflowCount: 0,
      stage: "proof-on-prerequisite-verification",
      startedAt: now,
      endedAt: now,
      durationMs: 0,
      error: error instanceof Error ? error.message : String(error),
      sourceBefore,
      composeScriptSha256: scriptHash,
      verifiedImagesBefore,
      nativeCoverage: {
        inherited: Boolean(env.NODE_V8_COVERAGE),
        directory: env.NODE_V8_COVERAGE ?? null,
      },
    };
    await writeFile(resultPath, `${JSON.stringify(blockedResult, null, 2)}\n`, {
      flag: "wx",
    });
    await publishSafeEvidence({
      root,
      runRoot,
      mode,
      env,
      result: blockedResult,
      resultPath,
    });
    throw new Error(
      "Proof-on prerequisite verification failed; inspect the private Compose workflow evidence",
    );
  }

  const startedAt = new Date();
  const outcome = await workflowRunner(process.execPath, [composeScript], {
    cwd: root,
    env: composePassEnvironment({ env, mode, runId }),
    logPath,
  });
  const endedAt = new Date();
  const sourceAfter = await fingerprint(root);
  let imagesAfter = null;
  let proofArtifacts = [];
  let evidenceError = null;
  if (outcome.code === 0) {
    try {
      imagesAfter = await imageInspector(composeImages(env), root);
      if (mode === "true") assertSameImages(proofOffLock.images, imagesAfter);
      proofArtifacts = await proofArtifactEvidence(runRoot, mode);
      assert.equal(proofArtifacts.length, 4, "Proof artifact count mismatch");
    } catch (error) {
      evidenceError = error instanceof Error ? error.message : String(error);
    }
  }
  const passed =
    outcome.code === 0 &&
    sourceAfter.hash === sourceBefore.hash &&
    evidenceError === null;
  const result = {
    schemaVersion: 1,
    runId,
    proofsEnabled: mode === "true",
    status: passed ? "passed" : "failed",
    workflowCount: 1,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    ...outcome,
    sourceBefore,
    sourceAfter,
    sourcesUnchanged: sourceAfter.hash === sourceBefore.hash,
    composeScriptSha256: scriptHash,
    images: imagesAfter,
    proofArtifacts,
    evidenceError,
    proofOffImageVerification:
      mode === "true" ? { lockPath, verifiedImagesBefore } : null,
    nativeCoverage: {
      inherited: Boolean(env.NODE_V8_COVERAGE),
      directory: env.NODE_V8_COVERAGE ?? null,
      validation:
        "The ordered runner must confirm that final LCOV contains executed CLI and SDK sources.",
    },
    logPath,
    logSha256: await sha256File(logPath),
  };
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, {
    flag: "wx",
  });
  await publishSafeEvidence({
    root,
    runRoot,
    mode,
    env,
    result,
    resultPath,
  });
  if (mode === "false" && passed) {
    await writeFile(
      lockPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          status: "passed",
          runId,
          sourceHash: sourceBefore.hash,
          composeScriptSha256: scriptHash,
          workflowResultPath: resultPath,
          workflowResultSha256: await sha256File(resultPath),
          images: imagesAfter,
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );
  }
  assert.equal(outcome.code, 0, "Compose E2E workflow failed");
  if (evidenceError) {
    throw new Error(
      "Compose workflow evidence is incomplete; inspect the private Compose workflow evidence",
    );
  }
  assert.equal(
    sourceAfter.hash,
    sourceBefore.hash,
    "Compose inputs changed during the workflow",
  );
  return result;
}
