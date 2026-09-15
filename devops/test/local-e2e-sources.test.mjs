import assert from "node:assert/strict";
import { test } from "node:test";
import {
  changedSourcePaths,
  dependencyPatchPattern,
  fingerprintSources,
} from "./local-e2e-sources.mjs";
import { fileURLToPath } from "node:url";
import { glob, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = fileURLToPath(new URL("../../", import.meta.url));
test("source fingerprint is stable across duplicate paths and discovery order", async () => {
  const paths = [
    "devops/test/local-e2e-sources.mjs",
    "devops/test/local-e2e-sources.test.mjs",
  ];
  const first = await fingerprintSources(root, paths);
  const second = await fingerprintSources(
    root,
    [...paths].reverse().concat(paths),
  );
  assert.deepEqual(second, first);
  assert.equal(first.files.length, 2);
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(changedSourcePaths(first, second), []);
});

test("source drift identifies added, removed, and changed files", () => {
  const snapshot = (entries) => ({
    files: entries.map(([path, sha256]) => ({ path, sha256 })),
  });
  assert.deepEqual(
    changedSourcePaths(
      snapshot([
        ["same.ts", "a"],
        ["changed.ts", "b"],
        ["removed.ts", "c"],
      ]),
      snapshot([
        ["same.ts", "a"],
        ["changed.ts", "d"],
        ["added.ts", "e"],
      ]),
    ),
    ["added.ts", "changed.ts", "removed.ts"],
  );
});

test("source fingerprint fails when a selected input is missing", async () => {
  await assert.rejects(
    fingerprintSources(root, ["devops/test/does-not-exist.input"]),
    { code: "ENOENT" },
  );
});

test("a dependency patch change invalidates the pass even when its manifest stays unchanged", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "e2e-patch-fingerprint-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "patches"));
  await writeFile(join(directory, "package.json"), '{"private":true}');
  const patch = "patches/transport@1.0.0.patch";
  await writeFile(join(directory, patch), "first patch bytes\n");
  const snapshot = async () => {
    const paths = ["package.json"];
    for await (const path of glob(dependencyPatchPattern, { cwd: directory }))
      paths.push(path);
    return fingerprintSources(directory, paths);
  };
  const before = await snapshot();
  assert.equal(before.files.length, 2);
  await writeFile(join(directory, patch), "changed patch bytes\n");
  const changed = await snapshot();
  assert.notEqual(changed.hash, before.hash);
  assert.deepEqual(changedSourcePaths(before, changed), [patch]);
  await rm(join(directory, patch));
  const removed = await snapshot();
  assert.deepEqual(changedSourcePaths(changed, removed), [patch]);
  assert.deepEqual(changedSourcePaths(removed, before), [patch]);
});
