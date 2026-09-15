import assert from "node:assert/strict";
import test from "node:test";
import { assertCoveredSourceScopes } from "./local-e2e-coverage-scopes.mjs";

const scopes = ["apps/cli/src/", "packages/sdk/src/"];
const record = (file, count = 1) =>
  `SF:${file}\nDA:1,${count}\nLF:1\nLH:${count > 0 ? 1 : 0}\nend_of_record\n`;

test("coverage requires executed CLI and SDK TypeScript, not just the wrapper", () => {
  const evidence = assertCoveredSourceScopes(
    record("apps/cli/src/index.ts") + record("packages/sdk/src/index.ts"),
    scopes,
  );
  assert.equal(evidence.length, 2);
  assert.ok(evidence.every(({ files }) => files[0].coveredLines === 1));
});

for (const [name, lcov] of [
  ["missing SDK", record("apps/cli/src/index.ts")],
  [
    "unexecuted SDK",
    record("apps/cli/src/index.ts") + record("packages/sdk/src/index.ts", 0),
  ],
  ["wrapper only", record("devops/test/compose-e2e.node.test.mjs")],
  ["path prefix collision", record("apps/cli/src-other/index.ts")],
  ["path escape", record("apps/cli/src/../../../other.ts")],
  ["compiled JavaScript", record("apps/cli/src/index.js")],
  ["invented aggregate", "SF:apps/cli/src/index.ts\nLH:100\nend_of_record\n"],
])
  test(`coverage rejects ${name}`, () => {
    assert.throws(
      () => assertCoveredSourceScopes(lcov, scopes),
      /No executed TypeScript/,
    );
  });
