import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readBrowserCoverageInputs } from "./local-e2e-browser-inputs.mjs";

async function fixture(t, change = () => {}) {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "e2e-coverage-bindings-")),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const specs = [];
  for (const title of ["create", "vote"]) {
    const scripts = join(directory, title);
    await mkdir(scripts);
    const file = join(scripts, "manifest.json");
    const manifest = {
      format: "playwright-v8-per-script",
      directory: scripts,
      files: ["script-0.json"],
      missingSources: [],
    };
    change(manifest, title, directory);
    await writeFile(file, JSON.stringify(manifest));
    specs.push({
      file: "browser.spec.ts",
      title,
      tests: [
        {
          expectedStatus: "passed",
          results: [
            {
              status: "passed",
              attachments: [{ name: "chromium-v8-coverage", path: file }],
            },
          ],
        },
      ],
    });
  }
  return {
    directory,
    report: { errors: [], suites: [{ title: "suite", specs }] },
  };
}

test("binds one real manifest to each completed browser case", async (t) => {
  const { directory, report } = await fixture(t);
  assert.deepEqual(await readBrowserCoverageInputs(report, directory), [
    join(directory, "create/manifest.json"),
    join(directory, "vote/manifest.json"),
  ]);
});

for (const count of [0, 2]) {
  test(`rejects ${count} coverage attachments for one case`, async (t) => {
    const { directory, report } = await fixture(t);
    const attachments =
      report.suites[0].specs[0].tests[0].results[0].attachments;
    attachments.splice(0, 1, ...Array(count).fill(attachments[0]));
    await assert.rejects(
      readBrowserCoverageInputs(report, directory),
      /expected one coverage attachment/,
    );
  });
}

test("rejects two cases that reuse one capture directory", async (t) => {
  const { directory, report } = await fixture(t, (manifest, _, root) => {
    manifest.directory = join(root, "create");
  });
  await assert.rejects(
    readBrowserCoverageInputs(report, directory),
    /another case used/,
  );
});

for (const [name, change, message] of [
  [
    "missing sources",
    (manifest) => {
      manifest.missingSources = [{ scriptId: "42" }];
    },
    /missing captured/,
  ],
  [
    "empty capture",
    (manifest) => {
      manifest.files = [];
    },
    /no captured scripts/,
  ],
  [
    "wrong format",
    (manifest) => {
      manifest.format = "unknown";
    },
    /invalid coverage manifest/,
  ],
  [
    "outside run",
    (manifest) => {
      manifest.directory = tmpdir();
    },
    /outside this run/,
  ],
]) {
  test(`rejects ${name}`, async (t) => {
    const { directory, report } = await fixture(t, change);
    await assert.rejects(readBrowserCoverageInputs(report, directory), message);
  });
}
