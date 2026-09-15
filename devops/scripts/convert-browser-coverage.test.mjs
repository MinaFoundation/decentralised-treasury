import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { Session } from "node:inspector/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { convertBrowserCoverage } from "./convert-browser-coverage.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const original = [
  "interface OnlyAType { value: number }",
  "function choose(flag: boolean): number {",
  "  if (flag) {",
  "    return 11;",
  "  }",
  "  return 22;",
  "}",
  "function never(): number {",
  "  return 33;",
  "}",
  "choose(true);",
  "",
].join("\n");

async function fixture() {
  const root = await mkdtemp(
    path.join(tmpdir(), "treasury-browser-coverage-fixture-"),
  );
  const relative = "apps/web/features/example.ts";
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), original);
  const output = ts.transpileModule(original, {
    fileName: path.join(root, relative),
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
      sourceMap: true,
      inlineSources: true,
    },
  });
  const map = JSON.parse(output.sourceMapText);
  map.sources = [path.join(root, relative)];
  const source =
    output.outputText.replace(/\/\/# sourceMappingURL=.*$/mu, "") +
    `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString("base64")}\n`;
  const session = new Session();
  session.connect();
  await session.post("Profiler.enable");
  await session.post("Profiler.startPreciseCoverage", {
    callCount: true,
    detailed: true,
  });
  runInNewContext(source, {}, { filename: "browser-coverage-fixture.js" });
  const { result } = await session.post("Profiler.takePreciseCoverage");
  await session.post("Profiler.stopPreciseCoverage");
  session.disconnect();
  const measured = result.find(
    (entry) => entry.url === "browser-coverage-fixture.js",
  );
  assert.ok(measured, "The fixture must use actual V8 coverage.");
  const entry = {
    ...measured,
    source,
    url: "webpack-internal:///(app-pages-browser)/./features/example.ts",
  };
  const input = path.join(root, "raw.json");
  await writeFile(input, JSON.stringify([entry]));
  const outputDirectory = path.join(root, "converted");
  const convert = (extra = {}) =>
    convertBrowserCoverage({
      inputs: [input],
      repoRoot: root,
      appRoot: "apps/web",
      outputDirectory,
      ...extra,
    });
  const replace = async (entries) => writeFile(input, JSON.stringify(entries));
  return {
    root,
    relative,
    input,
    entry,
    map,
    outputDirectory,
    convert,
    replace,
  };
}

test("maps real V8 branch and function counts to original TS lines and Codecov paths", async () => {
  const f = await fixture();
  const result = await f.convert();
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.status, "complete");
  assert.deepEqual(Object.keys(result.report.sources), [f.relative]);
  const coverage = JSON.parse(
    await readFile(path.join(f.outputDirectory, "coverage-final.json"), "utf8"),
  )[f.relative];
  const counts = Object.fromEntries(
    Object.entries(coverage.statementMap).map(([id, loc]) => [
      loc.start.line,
      coverage.s[id],
    ]),
  );
  assert.equal(
    counts[1],
    undefined,
    "A type-only line must not count as executed code.",
  );
  assert.ok(counts[4] > 0, "The selected return branch must be covered.");
  assert.equal(counts[6], 0, "The other return branch must remain uncovered.");
  assert.equal(
    counts[9],
    0,
    "The uncalled function body must remain uncovered.",
  );
  const never = Object.entries(coverage.fnMap).find(
    ([, fn]) => fn.name === "never",
  );
  assert.ok(never);
  assert.equal(coverage.f[never[0]], 0);
  assert.ok(
    result.summary.total.branches.total > result.summary.total.branches.covered,
  );
  assert.ok(
    result.summary.total.functions.total >
      result.summary.total.functions.covered,
  );
  const lcov = await readFile(
    path.join(f.outputDirectory, "lcov.info"),
    "utf8",
  );
  assert.match(lcov, /SF:apps\/web\/features\/example\.ts\n/u);
  assert.match(lcov, /DA:6,0\n/u);
  assert.doesNotMatch(lcov, /SF:.*(?:\.js|webpack|private\/|tmp\/)/u);
});

test("rejects maps that label transformed JS as the original TS source", async () => {
  const f = await fixture();
  const incorrect = {
    ...f.map,
    sourcesContent: [
      original.replace(": boolean", "").replaceAll(": number", ""),
    ],
  };
  await f.replace([{ ...f.entry, sourceMap: incorrect }]);
  const result = await f.convert();
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.status, "unmapped");
  assert.equal(result.report.unmapped[0].code, "SOURCE_CONTENT_MISMATCH");
  assert.equal(result.summary.total.lines.total, 0);
  assert.doesNotMatch(
    await readFile(path.join(f.outputDirectory, "lcov.info"), "utf8"),
    /SF:/u,
  );
});

test("rejects invalid original positions and missing source content", async () => {
  const f = await fixture();
  // AACA points to original line 2. Repeat to exceed the original line count.
  await f.replace([
    { ...f.entry, sourceMap: { ...f.map, mappings: `AA${"gH"}A` } },
  ]);
  const invalid = await f.convert();
  assert.equal(invalid.exitCode, 1);
  assert.equal(invalid.report.unmapped[0].code, "INVALID_ORIGINAL_POSITION");
  await f.replace([
    { ...f.entry, sourceMap: { ...f.map, sourcesContent: undefined } },
  ]);
  assert.equal(
    (await f.convert()).report.unmapped[0].code,
    "SOURCE_CONTENT_MISSING",
  );
});

test("excludes vendor sources and resolves validated container checkout paths", async () => {
  const f = await fixture();
  await f.replace([
    {
      ...f.entry,
      sourceMap: { ...f.map, sources: [`/build/repo/${f.relative}`] },
    },
    {
      ...f.entry,
      url: "webpack:///node_modules/library/index.ts",
      sourceMap: { ...f.map, sources: ["../../node_modules/library/index.ts"] },
    },
  ]);
  const result = await f.convert();
  assert.equal(result.exitCode, 0);
  assert.deepEqual(Object.keys(result.report.sources), [f.relative]);
  assert.ok(
    result.report.excluded.some((entry) => entry.reason === "VENDOR_SCRIPT"),
  );
});

test("reports partial mapping and fails closed unless partial output is explicit", async () => {
  const f = await fixture();
  await f.replace([
    f.entry,
    {
      ...f.entry,
      source: f.entry.source.replace(
        /\/\/# sourceMappingURL=.*$/mu,
        (comment) => " ".repeat(comment.length),
      ),
      url: "http://localhost/_next/static/chunks/app.js",
    },
  ]);
  const strict = await f.convert();
  assert.equal(strict.exitCode, 1);
  assert.equal(strict.report.status, "partial");
  assert.equal(strict.report.unmapped[0].code, "SOURCE_MAP_MISSING");
  const allowed = await f.convert({ allowUnmapped: true });
  assert.equal(allowed.exitCode, 0);
  assert.equal(allowed.report.status, "partial");
  assert.deepEqual(allowed.summary, strict.summary);
});

test("reads per-script manifests, deduplicates attachment copies, and blocks manifest escapes", async () => {
  const f = await fixture();
  const directory = path.join(f.root, "chromium-v8-coverage");
  await mkdir(directory);
  await writeFile(
    path.join(directory, "script-00000.json"),
    JSON.stringify([f.entry]),
  );
  const manifest = path.join(f.root, "manifest.json");
  await writeFile(
    manifest,
    JSON.stringify({
      format: "playwright-v8-per-script",
      directory,
      files: ["script-00000.json"],
    }),
  );
  const baseline = await f.convert();
  const fromManifest = await f.convert({
    inputs: [manifest, directory, f.input],
  });
  assert.equal(fromManifest.exitCode, 0);
  assert.equal(fromManifest.report.mappedScripts, 1);
  assert.deepEqual(fromManifest.summary, baseline.summary);
  await writeFile(
    manifest,
    JSON.stringify({
      format: "playwright-v8-per-script",
      directory,
      files: ["script-00000.json"],
      missingSources: [
        {
          scriptId: "lost",
          url: "webpack:///features/lost.ts",
          error: "CDP source capture failed",
        },
      ],
    }),
  );
  const incomplete = await f.convert({ inputs: [manifest] });
  assert.equal(incomplete.exitCode, 1);
  assert.equal(incomplete.report.unmapped[0].code, "GENERATED_SOURCE_MISSING");
  await writeFile(
    manifest,
    JSON.stringify({
      format: "playwright-v8-per-script",
      directory,
      files: ["../raw.json"],
    }),
  );
  await assert.rejects(f.convert({ inputs: [manifest] }), {
    code: "MANIFEST_PATH_ESCAPE",
  });
});

test("rejects V8 offsets outside generated source instead of inventing coverage", async () => {
  const f = await fixture();
  await f.replace([
    {
      ...f.entry,
      functions: [
        {
          functionName: "bad",
          ranges: [
            { startOffset: 0, endOffset: f.entry.source.length + 1, count: 1 },
          ],
          isBlockCoverage: true,
        },
      ],
    },
  ]);
  const result = await f.convert();
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.unmapped[0].code, "INVALID_V8_RANGE");
  await f.replace([{ ...f.entry, functions: [] }]);
  const missing = await f.convert();
  assert.equal(missing.exitCode, 1);
  assert.equal(
    missing.report.unmapped[0].code,
    "MAPPED_SCRIPT_WITHOUT_COMPLETE_V8_RANGE",
  );
  assert.equal(missing.summary.total.lines.total, 0);
});

test("does not count React server debug stubs or nested eval container maps as source execution", async () => {
  const f = await fixture();
  const stub =
    "/* This module was rendered by a Server Component. Turn on Source Maps to see the server source. */\n({_=>_()})\n//# sourceMappingURL=http://localhost/server-map";
  const container = `eval(${JSON.stringify(f.entry.source)});`;
  await f.replace([
    f.entry,
    {
      url: "about://React/Server/webpack-internal:///(rsc)/./app/layout.tsx",
      source: stub,
      functions: [],
    },
    {
      url: "http://localhost/_next/static/chunks/page.js",
      source: `${container}\n// sourceURL=webpack-internal:///fixture`,
      functions: [],
    },
  ]);
  const result = await f.convert();
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.mappedScripts, 1);
  assert.ok(
    result.report.excluded.some(
      (entry) => entry.reason === "REACT_SERVER_COMPONENT_BROWSER_DEBUG_STUB",
    ),
  );
  assert.ok(
    result.report.excluded.some(
      (entry) =>
        entry.reason === "WEBPACK_EVAL_CONTAINER_WITH_SEPARATE_MODULE_SCRIPTS",
    ),
  );
});
