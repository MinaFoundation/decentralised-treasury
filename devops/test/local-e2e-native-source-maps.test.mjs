import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const runnerPath = join(repositoryRoot, "devops/test/run-local-e2e.mjs");
const loaderPath = join(
  repositoryRoot,
  "apps/cli/node_modules/ts-node/esm.mjs",
);
const tsconfigPath = join(repositoryRoot, "apps/cli/tsconfig.json");

const DIRECT_SOURCE = `interface ErasedDirectInput {
  value: number;
}

type DirectInput = ErasedDirectInput & {
  label: string;
};

export function directChoice(input: DirectInput): string {
  if (input.value > 0) {
    return "positive";
  }

  return "non-positive";
}
`;

const CHILD_SOURCE = `interface ErasedChildInput {
  active: boolean;
}

export function childChoice(input: ErasedChildInput): string {
  if (input.active) {
    return "active";
  }

  return "inactive";
}
`;

function lcovRecords(serialized) {
  return serialized
    .split("end_of_record")
    .map((record) => record.trim())
    .filter((record) => record.includes("SF:"))
    .map((record) => {
      const lines = record.split(/\r?\n/u);
      const source = lines.find((line) => line.startsWith("SF:"))?.slice(3);
      assert(source, "LCOV record must identify its source");
      const functions = new Map();
      const hits = new Map();
      for (const line of lines) {
        if (line.startsWith("FN:")) {
          const [location, name] = line.slice(3).split(",");
          functions.set(name, Number(location));
        } else if (line.startsWith("DA:")) {
          const [location, count] = line.slice(3).split(",");
          hits.set(Number(location), Number(count));
        }
      }
      return { source, functions, hits };
    });
}

test("native E2E runner enables source maps for itself and descendants", async () => {
  const source = await readFile(runnerPath, "utf8");
  const argsStart = source.indexOf("    const args = suite.browser");
  const spawnStart = source.indexOf("    const child = spawn", argsStart);
  assert.notEqual(argsStart, -1, "Native runner arguments were not found");
  assert.notEqual(spawnStart, -1, "Native runner process launch was not found");
  const argsSource = source.slice(argsStart, spawnStart);
  assert.match(
    argsSource,
    /:\s*\[\s*"--enable-source-maps"/u,
    "Native Node coverage must map generated code to TypeScript",
  );
  assert.match(
    source,
    /const nativeNodeOptions\s*=\s*\[process\.env\.NODE_OPTIONS,\s*"--enable-source-maps"\][\s\S]*?\.filter\(Boolean\)[\s\S]*?\.join\(" "\)/u,
    "Native source-map NODE_OPTIONS must preserve existing options",
  );
  const spawnSource = source.slice(
    spawnStart,
    source.indexOf("    activeRun =", spawnStart),
  );
  assert.match(
    spawnSource,
    /!suite\.browser[\s\S]*?NODE_OPTIONS:\s*nativeNodeOptions/u,
    "CLI, service, and worker descendants must inherit source-map support",
  );
});

test(
  "native coverage maps direct and spawned child execution to original TypeScript lines",
  { timeout: 20_000 },
  async () => {
    const outputDirectory = await mkdtemp(
      join(tmpdir(), "treasury-native-source-maps-"),
    );
    const fixtureDirectory = join(outputDirectory, "fixture");
    const fixtureTestPath = join(fixtureDirectory, "coverage.test.ts");
    const lcovPath = join(outputDirectory, "lcov.info");
    await writeFile(
      join(outputDirectory, "package.json"),
      `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
    );
    await mkdir(fixtureDirectory);
    await Promise.all([
      writeFile(join(fixtureDirectory, "direct-source.ts"), DIRECT_SOURCE),
      writeFile(join(fixtureDirectory, "child-source.ts"), CHILD_SOURCE),
      writeFile(
        join(fixtureDirectory, "child-entry.ts"),
        `import assert from "node:assert/strict";
import { childChoice } from "./child-source.js";

assert.match(process.env.NODE_OPTIONS ?? "", /(?:^|\\s)--enable-source-maps(?:\\s|$)/u);
assert.equal(childChoice({ active: true }), "active");
`,
      ),
      writeFile(
        fixtureTestPath,
        `import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { directChoice } from "./direct-source.js";

test("runs direct and inherited child TypeScript", () => {
  assert.equal(directChoice({ value: 1, label: "used" }), "positive");
  const childEnvironment = { ...process.env };
  delete childEnvironment.NODE_TEST_CONTEXT;
  const child = spawnSync(
    process.execPath,
    [
      "--loader",
      process.env.FIXTURE_TS_NODE_LOADER!,
      fileURLToPath(new URL("./child-entry.ts", import.meta.url)),
    ],
    { env: childEnvironment, encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
});
`,
      ),
    ]);
    const nestedEnvironment = { ...process.env };
    delete nestedEnvironment.NODE_TEST_CONTEXT;
    nestedEnvironment.NODE_NO_WARNINGS = "1";
    nestedEnvironment.NODE_OPTIONS = [
      process.env.NODE_OPTIONS,
      "--enable-source-maps",
    ]
      .filter(Boolean)
      .join(" ");
    nestedEnvironment.TS_NODE_PROJECT = tsconfigPath;
    nestedEnvironment.FIXTURE_TS_NODE_LOADER = loaderPath;

    const child = spawnSync(
      process.execPath,
      [
        "--enable-source-maps",
        "--loader",
        loaderPath,
        "--experimental-test-coverage",
        "--test-coverage-include=fixture/*-source.ts",
        "--test-reporter=lcov",
        `--test-reporter-destination=${lcovPath}`,
        "--test",
        fixtureTestPath,
      ],
      {
        cwd: outputDirectory,
        env: nestedEnvironment,
        encoding: "utf8",
      },
    );
    assert.equal(child.status, 0, child.stderr || child.stdout);

    const records = lcovRecords(await readFile(lcovPath, "utf8"));
    const direct = records.find(
      (record) => basename(record.source) === "direct-source.ts",
    );
    const spawned = records.find(
      (record) => basename(record.source) === "child-source.ts",
    );
    assert(direct, "Direct TypeScript coverage was not collected");
    assert(spawned, "Spawned child TypeScript coverage was not collected");

    assert.equal(direct.functions.get("directChoice"), 9);
    assert.equal(direct.hits.get(11), 1);
    assert.equal(direct.hits.get(14), 0);
    assert.notEqual(direct.functions.get("directChoice"), 1);

    assert.equal(spawned.functions.get("childChoice"), 5);
    assert.equal(spawned.hits.get(7), 1);
    assert.equal(spawned.hits.get(10), 0);
    assert.notEqual(spawned.functions.get("childChoice"), 1);
  },
);
