import assert from "node:assert/strict";

export function readRunOptions(args) {
  const flags = args.filter((argument) => argument.startsWith("--"));
  assert.ok(
    flags.every((flag) => flag === "--proofs-disabled-only"),
    "Supported option: --proofs-disabled-only",
  );
  assert.ok(flags.length <= 1, "Specify --proofs-disabled-only once");
  return {
    proofModes: flags.length ? ["false"] : ["false", "true"],
    suites: args.filter((argument) => !argument.startsWith("--")),
  };
}
