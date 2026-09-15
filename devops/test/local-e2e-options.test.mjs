import assert from "node:assert/strict";
import { test } from "node:test";
import { readRunOptions } from "./local-e2e-options.mjs";

for (const [name, args, proofModes, suites] of [
  ["default selection keeps both passes", [], ["false", "true"], []],
  [
    "named suites keep both passes",
    ["web", "backoffice"],
    ["false", "true"],
    ["web", "backoffice"],
  ],
  [
    "flag alone selects only the disabled pass",
    ["--proofs-disabled-only"],
    ["false"],
    [],
  ],
  [
    "leading flag preserves suite order",
    ["--proofs-disabled-only", "web", "backoffice"],
    ["false"],
    ["web", "backoffice"],
  ],
  [
    "trailing flag preserves suite order",
    ["compose", "--proofs-disabled-only"],
    ["false"],
    ["compose"],
  ],
]) {
  test(name, () => {
    assert.deepEqual(readRunOptions(args), { proofModes, suites });
  });
}

for (const args of [
  ["--proofs-disabled-only", "--proofs-disabled-only"],
  ["--proofs-enabled-only"],
  ["--proofs-disabled-only=true"],
]) {
  test(`rejects unsupported options: ${args.join(" ")}`, () => {
    assert.throws(() => readRunOptions(args));
  });
}
