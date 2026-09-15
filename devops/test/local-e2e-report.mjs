import assert from "node:assert/strict";

// Read individual results. Aggregate "expected" counts also include expected
// failures and cannot alone prove that every scenario passed.
export function readBrowserResults(report) {
  assert.ok(Array.isArray(report.suites), "Browser report has no suites");
  assert.ok(Array.isArray(report.errors), "Browser report has no error list");
  const cases = [];
  function visit(suite, parents = []) {
    const titles = [...parents, suite.title];
    for (const spec of suite.specs ?? []) {
      assert.ok(Array.isArray(spec.tests), "Browser spec has no tests");
      for (const test of spec.tests) {
        assert.ok(Array.isArray(test.results), "Browser test has no results");
        cases.push({
          name: [spec.file, ...titles, spec.title, test.projectName ?? ""].join(
            "::",
          ),
          expectedStatus: test.expectedStatus,
          attempts: test.results.map((result) => result.status),
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child, titles);
  }
  for (const suite of report.suites) visit(suite);
  assert.ok(cases.length > 0, "Browser report contains no test cases");
  assert.equal(
    new Set(cases.map((item) => item.name)).size,
    cases.length,
    "Browser report contains duplicate cases",
  );
  const counts = {
    tests: cases.length,
    pass: 0,
    fail: 0,
    skipped: 0,
    cancelled: 0,
  };
  for (const item of cases) {
    if (item.attempts.includes("skipped")) counts.skipped++;
    else if (item.attempts.includes("interrupted")) counts.cancelled++;
    else if (
      item.expectedStatus === "passed" &&
      item.attempts.length === 1 &&
      item.attempts[0] === "passed"
    )
      counts.pass++;
    else counts.fail++;
  }
  return {
    counts,
    cases: cases.sort((left, right) => left.name.localeCompare(right.name)),
    errors: report.errors,
    passed: counts.pass === counts.tests && report.errors.length === 0,
  };
}

export function assertSameBrowserCases(first, second) {
  assert.deepEqual(
    second.cases.map(({ name, expectedStatus }) => ({ name, expectedStatus })),
    first.cases.map(({ name, expectedStatus }) => ({ name, expectedStatus })),
    "Browser cases changed between proof passes",
  );
}
