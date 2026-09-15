#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The override supports isolated dependency validation without changing the
// repository lockfile. Normal runs resolve the pinned root dependencies.
const require = createRequire(
  process.env.BROWSER_COVERAGE_DEPENDENCIES
    ? path.join(
        path.resolve(process.env.BROWSER_COVERAGE_DEPENDENCIES),
        "package.json",
      )
    : import.meta.url,
);
const v8ToIstanbul = require("v8-to-istanbul");
const { createCoverageMap } = require("istanbul-lib-coverage");
const { TraceMap, decodedMappings } = require("@jridgewell/trace-mapping");
const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const slash = (value) => value.replaceAll("\\", "/");
const inside = (root, candidate) =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};
const isOriginal = (value) =>
  /\.(ts|tsx)$/u.test(value) &&
  !/(?:^|\/)(?:node_modules|\.next[^/]*|e2e|test|tests|fixtures)(?:\/|$)|\.(?:d|test|spec|stories)\.tsx?$/u.test(
    slash(value),
  );

function sourcePath(source, sourceRoot, repoRoot, appRoot) {
  let value = source.startsWith("file:") ? fileURLToPath(source) : source;
  value = value
    .replace(/^webpack(?:-internal)?:\/\/[^/]*\//u, "")
    .replace(/^\/?\([^)]*\)\//u, "")
    .replace(/[?#].*$/u, "");
  value = decodeURIComponent(value);
  if (value.includes("\0"))
    fail("INVALID_SOURCE_PATH", "A source path contains a null byte.");
  if (path.isAbsolute(value)) {
    if (inside(repoRoot, value)) return path.normalize(value);
    // Container builds have another checkout prefix. Content equality below
    // proves that a mapped repository suffix identifies the same source.
    const suffix = slash(value).match(/\/(apps|packages)\/.+$/u)?.[0];
    if (suffix) return path.join(repoRoot, suffix.slice(1));
    return value;
  }
  if (/^(apps|packages)\//u.test(value)) return path.resolve(repoRoot, value);
  const root = sourceRoot && !sourceRoot.includes("://") ? sourceRoot : "";
  return path.resolve(appRoot, root, value);
}

async function loadMap(entry, mapRoot) {
  if (entry.sourceMap) return entry.sourceMap;
  const references = [
    ...entry.source.matchAll(
      /^[\t ]*(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL=([^\s*]+)/gmu,
    ),
  ];
  const reference = references.at(-1)?.[1];
  if (!reference) return null;
  if (reference.startsWith("data:")) {
    const comma = reference.indexOf(",");
    if (comma < 0) fail("INVALID_SOURCE_MAP", "Invalid data URL.");
    return JSON.parse(
      reference.slice(0, comma).includes(";base64")
        ? Buffer.from(reference.slice(comma + 1), "base64").toString("utf8")
        : decodeURIComponent(reference.slice(comma + 1)),
    );
  }
  if (!mapRoot)
    fail(
      "EXTERNAL_SOURCE_MAP_UNAVAILABLE",
      `Capture ${reference}, or provide --map-root.`,
    );
  const url = new URL(reference, entry.url);
  const relative = decodeURIComponent(url.pathname)
    .replace(/^\/_next\//u, "")
    .replace(/^\//u, "");
  const candidate = await realpath(path.resolve(mapRoot, relative));
  if (!inside(await realpath(mapRoot), candidate))
    fail("SOURCE_MAP_OUTSIDE_ROOT", reference);
  return JSON.parse(await readFile(candidate, "utf8"));
}

async function validateMap(raw, entry, options) {
  if (
    raw.version !== 3 ||
    raw.sections ||
    !Array.isArray(raw.sources) ||
    typeof raw.mappings !== "string"
  ) {
    fail("INVALID_SOURCE_MAP", "Expected a flat version 3 source map.");
  }
  const sources = raw.sources.map((source) =>
    sourcePath(source, raw.sourceRoot, options.repoRoot, options.appRoot),
  );
  const accepted = new Map();
  const excluded = [];
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index];
    if (!inside(options.repoRoot, source) || !isOriginal(source)) {
      excluded.push({
        source: raw.sources[index],
        reason: "OUTSIDE_OR_EXCLUDED_SOURCE",
      });
      continue;
    }
    let canonical;
    try {
      canonical = await realpath(source);
    } catch {
      fail("ORIGINAL_SOURCE_MISSING", source);
    }
    if (!inside(options.repoRoot, canonical))
      fail("SOURCE_OUTSIDE_REPOSITORY", source);
    const original = await readFile(canonical, "utf8");
    const content = raw.sourcesContent?.[index];
    if (typeof content !== "string") fail("SOURCE_CONTENT_MISSING", source);
    if (content !== original)
      fail(
        "SOURCE_CONTENT_MISMATCH",
        `${slash(path.relative(options.repoRoot, source))}: map=${digest(content)}, repository=${digest(original)}`,
      );
    sources[index] = canonical;
    accepted.set(canonical, {
      content,
      lines: content.split(/\r?\n/u),
      mappedLines: new Set(),
      sha256: digest(content),
    });
  }
  const map = {
    ...raw,
    sources,
    sourceRoot: "",
    sourcesContent: raw.sources.map(
      (_, index) => raw.sourcesContent?.[index] ?? "",
    ),
  };
  if (!accepted.size) return { map, accepted, excluded, mappedOffsets: [] };
  const decoded = decodedMappings(new TraceMap(map));
  const generatedLines = entry.source.split("\n");
  const mappedOffsets = [];
  let offset = 0;
  for (let line = 0; line < decoded.length; line++) {
    for (const segment of decoded[line]) {
      if (
        !Number.isInteger(segment[0]) ||
        segment[0] < 0 ||
        line >= generatedLines.length ||
        segment[0] > generatedLines[line].length
      ) {
        fail("INVALID_GENERATED_POSITION", `Generated line ${line + 1}.`);
      }
      if (segment.length === 1) continue;
      if (
        ![4, 5].includes(segment.length) ||
        !Number.isInteger(segment[1]) ||
        segment[1] < 0 ||
        segment[1] >= sources.length
      ) {
        fail("INVALID_SOURCE_INDEX", `Generated line ${line + 1}.`);
      }
      const original = accepted.get(sources[segment[1]]);
      if (!original) continue;
      const [, , originalLine, column] = segment;
      if (
        !Number.isInteger(originalLine) ||
        !Number.isInteger(column) ||
        originalLine < 0 ||
        originalLine >= original.lines.length ||
        column < 0 ||
        column > original.lines[originalLine].length
      ) {
        fail(
          "INVALID_ORIGINAL_POSITION",
          `${sources[segment[1]]}:${originalLine + 1}:${column}`,
        );
      }
      original.mappedLines.add(originalLine + 1);
      mappedOffsets.push(offset + segment[0]);
    }
    offset += (generatedLines[line]?.length ?? 0) + 1;
  }
  for (const [source, original] of accepted) {
    if (!original.mappedLines.size) fail("EMPTY_ORIGINAL_MAPPING", source);
  }
  return { map, accepted, excluded, mappedOffsets };
}

function validateFunctions(entry) {
  if (!Array.isArray(entry.functions))
    fail("INVALID_V8_COVERAGE", "The functions array is missing.");
  for (const fn of entry.functions) {
    if (!Array.isArray(fn.ranges) || !fn.ranges.length)
      fail("INVALID_V8_COVERAGE", "A function has no ranges.");
    for (const range of fn.ranges) {
      if (
        ![range.startOffset, range.endOffset, range.count].every(
          Number.isSafeInteger,
        ) ||
        range.startOffset < 0 ||
        range.endOffset > entry.source.length ||
        range.startOffset >= range.endOffset ||
        range.count < 0
      ) {
        fail("INVALID_V8_RANGE", JSON.stringify(range));
      }
    }
  }
}

function originalOnly(coverage, source) {
  // v8-to-istanbul initializes every original line as covered. Keep only
  // original lines that the validated map connects to emitted JavaScript.
  for (const [id, location] of Object.entries(coverage.statementMap)) {
    if (!source.mappedLines.has(location.start.line)) {
      delete coverage.statementMap[id];
      delete coverage.s[id];
    }
  }
  for (const [locations, counts] of [
    [coverage.fnMap, coverage.f],
    [coverage.branchMap, coverage.b],
  ]) {
    for (const [id, value] of Object.entries(locations)) {
      const location = value.loc;
      if (
        !location ||
        ![...source.mappedLines].some(
          (line) => line >= location.start.line && line <= location.end.line,
        )
      ) {
        delete locations[id];
        delete counts[id];
      }
    }
  }
  return coverage;
}

export function toLcov(coverageMap) {
  const output = [];
  for (const file of coverageMap.files().sort()) {
    const coverage = coverageMap.fileCoverageFor(file);
    const summary = coverage.toSummary();
    output.push("TN:", `SF:${slash(file)}`);
    for (const [id, fn] of Object.entries(coverage.fnMap)) {
      const name = `${fn.name.replace(/[\r\n,]/gu, "_")}@${id}`;
      output.push(
        `FN:${fn.decl.start.line},${name}`,
        `FNDA:${coverage.f[id]},${name}`,
      );
    }
    output.push(
      `FNF:${summary.functions.total}`,
      `FNH:${summary.functions.covered}`,
    );
    for (const [line, count] of Object.entries(coverage.getLineCoverage()))
      output.push(`DA:${line},${count}`);
    output.push(`LF:${summary.lines.total}`, `LH:${summary.lines.covered}`);
    for (const [id, branch] of Object.entries(coverage.branchMap)) {
      coverage.b[id].forEach((count, index) =>
        output.push(
          `BRDA:${branch.locations[index].start.line},${id},${index},${count}`,
        ),
      );
    }
    output.push(
      `BRF:${summary.branches.total}`,
      `BRH:${summary.branches.covered}`,
      "end_of_record",
    );
  }
  return `${output.join("\n")}\n`;
}

async function* inputFiles(inputs) {
  for (const input of inputs) {
    if ((await stat(input)).isDirectory()) {
      const children = await readdir(input);
      yield* inputFiles(
        children
          .filter((name) => /^script-.*\.json$/u.test(name))
          .sort()
          .map((name) => path.join(input, name)),
      );
      continue;
    }
    const raw = await readFile(input, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed.format === "playwright-v8-per-script") {
      // Preserve capture failures in the validation report. They must not
      // disappear merely because the collector could not write a script file.
      yield { input, raw, entries: parsed.missingSources ?? [] };
      const directory = await realpath(
        path.resolve(path.dirname(input), parsed.directory),
      );
      const files = [];
      for (const name of parsed.files) {
        const file = await realpath(path.resolve(directory, name));
        if (!inside(directory, file)) fail("MANIFEST_PATH_ESCAPE", name);
        files.push(file);
      }
      yield* inputFiles(files);
    } else yield { input, raw, entries: parsed };
  }
}

export async function convertBrowserCoverage({
  inputs,
  outputDirectory,
  repoRoot = defaultRoot,
  appRoot,
  mapRoot,
  allowUnmapped = false,
}) {
  repoRoot = await realpath(repoRoot);
  appRoot = path.resolve(repoRoot, appRoot ?? "apps/web");
  if (!inside(repoRoot, appRoot)) fail("APP_OUTSIDE_REPOSITORY", appRoot);
  const coverageMap = createCoverageMap({});
  const report = {
    schemaVersion: 1,
    status: "complete",
    inputs: [],
    mappedScripts: 0,
    excluded: [],
    unmapped: [],
    sources: {},
    limitations: [
      "Coverage includes captured browser scripts only. Unloaded files are outside the denominator.",
      "Line counts include original lines connected to emitted JavaScript by validated source maps.",
      "Branch counts use Chromium V8 block ranges, not TypeScript AST branch enumeration.",
      "Page coverage does not include Web Worker or WebAssembly execution.",
      "React Server Component browser debug stubs do not measure server execution and are excluded.",
    ],
  };
  const seen = new Set();
  for await (const { input, raw, entries } of inputFiles(inputs)) {
    report.inputs.push({ path: path.resolve(input), sha256: digest(raw) });
    if (!Array.isArray(entries))
      fail("INVALID_INPUT", `${input}: expected Playwright coverage entries.`);
    for (const entry of entries) {
      const reference = {
        input: path.resolve(input),
        url: entry.url ?? "",
        scriptId: entry.scriptId ?? "",
      };
      try {
        if (typeof entry.source !== "string")
          fail(
            "GENERATED_SOURCE_MISSING",
            "Capture source text with V8 coverage.",
          );
        if (
          (entry.url ?? "").startsWith("about://React/Server/") &&
          entry.source.startsWith(
            "/* This module was rendered by a Server Component.",
          )
        ) {
          report.excluded.push({
            ...reference,
            reason: "REACT_SERVER_COMPONENT_BROWSER_DEBUG_STUB",
          });
          continue;
        }
        if (/(?:^|\/)node_modules\//u.test(entry.url ?? "")) {
          report.excluded.push({ ...reference, reason: "VENDOR_SCRIPT" });
          continue;
        }
        validateFunctions(entry);
        const map = await loadMap(entry, mapRoot);
        if (!map) {
          if (
            /\beval\(/u.test(entry.source) &&
            entry.source.includes("sourceURL=webpack-internal:") &&
            entry.source.includes("sourceMappingURL=data:")
          ) {
            report.excluded.push({
              ...reference,
              reason: "WEBPACK_EVAL_CONTAINER_WITH_SEPARATE_MODULE_SCRIPTS",
            });
            continue;
          }
          const generated =
            !isOriginal(entry.url ?? "") &&
            !/\/_next\/static\/chunks\//u.test(entry.url ?? "");
          if (generated || /node_modules/u.test(entry.url ?? "")) {
            report.excluded.push({
              ...reference,
              reason: "GENERATED_OR_VENDOR_SCRIPT_WITHOUT_MAP",
            });
            continue;
          }
          fail(
            "SOURCE_MAP_MISSING",
            "A captured application script has no source map.",
          );
        }
        const validated = await validateMap(map, entry, { repoRoot, appRoot });
        report.excluded.push(
          ...validated.excluded.map((source) => ({ ...reference, ...source })),
        );
        if (!validated.accepted.size) continue;
        // The same attached raw file can appear twice in an input list. Avoid
        // counting identical script coverage twice; distinct executions merge.
        const identity = digest(
          JSON.stringify({
            url: entry.url,
            scriptId: entry.scriptId,
            source: entry.source,
            functions: entry.functions,
          }),
        );
        if (seen.has(identity)) continue;
        seen.add(identity);
        const functions = entry.functions
          .map((fn) => ({
            ...fn,
            ranges: fn.ranges.filter((range) =>
              validated.mappedOffsets.some(
                (offset) =>
                  offset >= range.startOffset && offset < range.endOffset,
              ),
            ),
          }))
          .filter((fn) => fn.ranges.length);
        const [firstMapped, lastMapped] = validated.mappedOffsets.reduce(
          ([first, last], offset) => [
            Math.min(first, offset),
            Math.max(last, offset),
          ],
          [Infinity, -Infinity],
        );
        if (
          !functions.some((fn) =>
            fn.ranges.some(
              (range) =>
                range.startOffset <= firstMapped &&
                range.endOffset > lastMapped,
            ),
          )
        ) {
          fail(
            "MAPPED_SCRIPT_WITHOUT_COMPLETE_V8_RANGE",
            "No captured top-level range covers the mapped source. Default covered lines are not permitted.",
          );
        }
        const converter = v8ToIstanbul(
          path.join(appRoot, "__browser_generated__.js"),
          0,
          { source: entry.source, sourceMap: { sourcemap: validated.map } },
          (source) => !validated.accepted.has(source),
        );
        await converter.load();
        converter.applyCoverage(functions);
        for (const [source, coverage] of Object.entries(
          converter.toIstanbul(),
        )) {
          const original = validated.accepted.get(source);
          if (!original) fail("UNVALIDATED_OUTPUT_SOURCE", source);
          const relative = slash(path.relative(repoRoot, source));
          coverage.path = relative;
          coverageMap.addFileCoverage(originalOnly(coverage, original));
          report.sources[relative] = {
            sha256: original.sha256,
            mappedLines: original.mappedLines.size,
          };
        }
        report.mappedScripts++;
      } catch (error) {
        report.unmapped.push({
          ...reference,
          code: error.code ?? "CONVERSION_FAILED",
          message: error.message,
        });
      }
    }
  }
  if (report.unmapped.length) report.status = "partial";
  if (!coverageMap.files().length) report.status = "unmapped";
  const summary = { total: coverageMap.getCoverageSummary().toJSON() };
  for (const file of coverageMap.files().sort())
    summary[file] = coverageMap.fileCoverageFor(file).toSummary().toJSON();
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDirectory, "lcov.info"), toLcov(coverageMap)),
    writeFile(
      path.join(outputDirectory, "coverage-summary.json"),
      JSON.stringify(summary, null, 2),
    ),
    writeFile(
      path.join(outputDirectory, "coverage-final.json"),
      JSON.stringify(coverageMap.toJSON()),
    ),
    writeFile(
      path.join(outputDirectory, "source-map-validation.json"),
      JSON.stringify(report, null, 2),
    ),
  ]);
  return {
    report,
    summary,
    exitCode:
      report.status === "complete" ||
      (allowUnmapped && report.status === "partial")
        ? 0
        : 1,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const values = (name) =>
    args
      .filter((arg) => arg.startsWith(`${name}=`))
      .map((arg) => arg.slice(name.length + 1));
  const inputs = values("--input");
  const outputDirectory = values("--output")[0];
  if (!inputs.length || !outputDirectory)
    throw new Error(
      "Usage: convert-browser-coverage.mjs --input=<raw.json> [--input=<raw.json>] --output=<directory> --app-root=apps/web [--repo-root=<path>] [--map-root=<build-directory>] [--allow-unmapped]",
    );
  const result = await convertBrowserCoverage({
    inputs,
    outputDirectory,
    repoRoot: values("--repo-root")[0],
    appRoot: values("--app-root")[0],
    mapRoot: values("--map-root")[0],
    allowUnmapped: args.includes("--allow-unmapped"),
  });
  console.log(
    JSON.stringify({
      status: result.report.status,
      mappedScripts: result.report.mappedScripts,
      unmapped: result.report.unmapped.length,
      sourceFiles: Object.keys(result.report.sources).length,
      outputDirectory,
    }),
  );
  process.exitCode = result.exitCode;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
