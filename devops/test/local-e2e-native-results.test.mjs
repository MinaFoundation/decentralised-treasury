import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readNativeResults,
  assertSameNativeCases,
} from "./local-e2e-native-results.mjs";
import nativeCaseReporter from "./local-e2e-native-reporter.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const good = {
  name: "reject amount 0 (PROOFS_ENABLED=false)",
  file: fileURLToPath(import.meta.url),
  line: 1,
  column: 1,
  nesting: 0,
  status: "passed",
  skipped: false,
  todo: false,
};
const read = (cases, mode = "false") =>
  readNativeResults(cases.map((item) => JSON.stringify(item)).join("\n"), {
    root,
    mode,
  });

test("native identities preserve input values and normalize only proof-mode labels", () => {
  const off = read([
    good,
    { ...good, name: "runs the proof-off CLI flow", line: 2 },
  ]);
  const on = read(
    [
      { ...good, name: "reject amount 0 (PROOFS_ENABLED=true)" },
      { ...good, name: "runs the proof-on CLI flow", line: 2 },
    ],
    "true",
  );

  assertSameNativeCases(off, on);
  assert.equal(off.passed, true);
  assert.throws(
    () =>
      assertSameNativeCases(
        off,
        read(
          [
            { ...good, name: "reject amount 1 (PROOFS_ENABLED=true)" },
            { ...good, name: "runs the proof-on CLI flow", line: 2 },
          ],
          "true",
        ),
      ),
    /Native cases changed/,
  );
});

test("the actual Node reporter retains nested cases and matches both modes", async () => {
  const results = [];
  const env = { ...process.env };
  // The child is a separate runner, not a worker of this parent runner.
  delete env.NODE_TEST_CONTEXT;
  for (const mode of ["false", "true"]) {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "--test",
        "--test-reporter=./devops/test/local-e2e-native-reporter.mjs",
        "devops/test/fixtures/native-case-tree.mjs",
      ],
      { cwd: root, env: { ...env, PROOFS_ENABLED: mode } },
    );
    const result = readNativeResults(stdout, { root, mode });
    assert.equal(result.cases.length, 2);
    assert.equal(result.passed, true);
    assert.deepEqual(result.cases.map((item) => item.nesting).sort(), [0, 1]);
    results.push(result);
  }
  assertSameNativeCases(results[0], results[1]);
});

for (const [name, change] of [
  ["failed", { status: "failed" }],
  ["skipped", { skipped: true }],
  ["todo", { todo: true }],
])
  test(`native ${name} case cannot pass the evidence gate`, () => {
    assert.equal(read([{ ...good, ...change }]).passed, false);
  });

test("native reports reject missing, malformed, duplicate, and out-of-scope evidence", () => {
  assert.throws(() => read([]), /no test cases/);
  assert.throws(() => read([good, good]), /duplicate cases/);
  for (const change of [
    { name: null },
    { name: "" },
    { file: "/outside/test.ts" },
    { line: null },
    { nesting: -1 },
    { status: "unknown" },
    { skipped: undefined },
    { todo: undefined },
  ])
    assert.throws(() => read([{ ...good, ...change }]));
  assert.throws(() => readNativeResults("{", { root, mode: "false" }));
  assert.throws(() => read([good], "TRUE"));
});

test("native case changes fail despite identical aggregate counts", () => {
  const before = read([good]);
  for (const change of [
    { name: "another operation" },
    { line: 2 },
    { nesting: 1 },
  ])
    assert.throws(() =>
      assertSameNativeCases(before, read([{ ...good, ...change }])),
    );
  assert.throws(() =>
    assertSameNativeCases(
      read([{ ...good, name: "reject proof-off artifact" }]),
      read([{ ...good, name: "reject proof-on artifact" }], "true"),
    ),
  );
});

test("native reporter retains parent test nodes but excludes describe suites and output", async () => {
  const events = [
    { type: "test:stdout", data: { message: "not a case" } },
    { type: "test:pass", data: { ...good, details: { type: "suite" } } },
    { type: "test:pass", data: { ...good, details: { type: "test" } } },
    {
      type: "test:fail",
      data: { ...good, name: "failed parent", details: { type: "test" } },
    },
  ];
  let source = "";
  for await (const chunk of nativeCaseReporter(events)) source += chunk;
  const result = readNativeResults(source, { root, mode: "false" });
  assert.equal(result.cases.length, 2);
  assert.equal(result.passed, false);
  assert.deepEqual(
    result.cases.map((item) => item.status),
    ["passed", "failed"],
  );
});
