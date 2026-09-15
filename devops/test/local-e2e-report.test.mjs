import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertSameBrowserCases,
  readBrowserResults,
} from "./local-e2e-report.mjs";

function report(statuses = ["passed"], expectedStatus = "passed") {
  return {
    errors: [],
    suites: [
      {
        title: "local",
        suites: [
          {
            title: "treasury",
            specs: [
              {
                file: "treasury.spec.ts",
                title: "create proposal",
                tests: [
                  {
                    projectName: "chromium",
                    expectedStatus,
                    results: statuses.map((status) => ({ status })),
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

test("accepts each completed case once and retains its identity", () => {
  const result = readBrowserResults(report());
  assert.equal(result.passed, true);
  assert.deepEqual(result.counts, {
    tests: 1,
    pass: 1,
    fail: 0,
    skipped: 0,
    cancelled: 0,
  });
  assert.equal(
    result.cases[0].name,
    "treasury.spec.ts::local::treasury::create proposal::chromium",
  );
});

for (const [name, statuses, expectedStatus, count] of [
  ["failed test", ["failed"], "passed", "fail"],
  ["timeout", ["timedOut"], "passed", "fail"],
  ["skip", ["skipped"], "skipped", "skipped"],
  ["interruption", ["interrupted"], "passed", "cancelled"],
  ["expected failure", ["failed"], "failed", "fail"],
  ["unexpected pass", ["passed"], "failed", "fail"],
  ["retry that passes", ["failed", "passed"], "passed", "fail"],
  ["missing execution", [], "passed", "fail"],
]) {
  test(`blocks the next proof pass for ${name}`, () => {
    const result = readBrowserResults(report(statuses, expectedStatus));
    assert.equal(result.passed, false);
    assert.equal(result.counts[count], 1);
  });
}

test("rejects absent reports, empty suites, and duplicate cases", () => {
  assert.throws(() => readBrowserResults({}), /no suites/);
  assert.throws(
    () => readBrowserResults({ suites: [], errors: [] }),
    /no test cases/,
  );
  const duplicate = report();
  duplicate.suites.push(duplicate.suites[0]);
  assert.throws(() => readBrowserResults(duplicate), /duplicate cases/);
});

test("global browser errors prevent a pass despite green test counts", () => {
  const input = report();
  input.errors.push({ message: "global teardown failed" });
  assert.equal(readBrowserResults(input).passed, false);
});

test("requires identical scenario identities and expectations between passes", () => {
  const first = readBrowserResults(report());
  assert.doesNotThrow(() =>
    assertSameBrowserCases(first, readBrowserResults(report())),
  );
  const changed = report();
  changed.suites[0].suites[0].specs[0].title = "smoke only";
  assert.throws(
    () => assertSameBrowserCases(first, readBrowserResults(changed)),
    /cases changed/,
  );
  assert.throws(
    () =>
      assertSameBrowserCases(
        first,
        readBrowserResults(report(["failed"], "failed")),
      ),
    /cases changed/,
  );
});
