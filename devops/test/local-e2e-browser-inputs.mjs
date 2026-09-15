import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { readBrowserResults } from "./local-e2e-report.mjs";

function isInside(root, file) {
  const path = relative(root, file);
  return (
    path !== ".." &&
    !path.startsWith("../") &&
    !path.startsWith("..\\") &&
    !isAbsolute(path)
  );
}

export async function readBrowserCoverageInputs(report, artifactDirectory) {
  const evidence = readBrowserResults(report);
  assert.equal(
    evidence.passed,
    true,
    "Coverage requires a completed browser run",
  );
  const root = await realpath(artifactDirectory);
  const inputs = [];
  const directories = new Set();
  async function visit(suite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        const attachments = (test.results[0].attachments ?? []).filter(
          (item) => item.name === "chromium-v8-coverage",
        );
        assert.equal(
          attachments.length,
          1,
          `${spec.title}: expected one coverage attachment`,
        );
        assert.equal(
          typeof attachments[0].path,
          "string",
          `${spec.title}: coverage attachment has no file`,
        );
        const file = await realpath(resolve(root, attachments[0].path));
        assert.ok(
          isInside(root, file),
          `${spec.title}: coverage attachment is outside this run`,
        );
        const manifest = JSON.parse(await readFile(file, "utf8"));
        assert.equal(
          manifest.format,
          "playwright-v8-per-script",
          `${spec.title}: invalid coverage manifest`,
        );
        assert.ok(
          Array.isArray(manifest.files) && manifest.files.length > 0,
          `${spec.title}: no captured scripts`,
        );
        assert.deepEqual(
          manifest.missingSources,
          [],
          `${spec.title}: missing captured script sources`,
        );
        const directory = await realpath(
          resolve(dirname(file), manifest.directory),
        );
        assert.ok(
          isInside(root, directory),
          `${spec.title}: captured scripts are outside this run`,
        );
        assert.equal(
          directories.has(directory),
          false,
          `${spec.title}: another case used these captured scripts`,
        );
        directories.add(directory);
        inputs.push(file);
      }
    }
    for (const child of suite.suites ?? []) await visit(child);
  }
  for (const suite of report.suites) await visit(suite);
  assert.equal(inputs.length, evidence.counts.tests);
  return inputs;
}
