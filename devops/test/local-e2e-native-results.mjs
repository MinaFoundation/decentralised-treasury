import assert from "node:assert/strict";
import { isAbsolute, relative } from "node:path";

export function readNativeResults(source, { root, mode }) {
  assert.ok(["false", "true"].includes(mode), "Invalid proof mode");
  const cases = source
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const item = JSON.parse(line);
      assert.equal(typeof item.name, "string", "Native case has no name");
      assert.ok(item.name.length > 0, "Native case has an empty name");
      assert.ok(typeof item.file === "string" && isAbsolute(item.file));
      const file = relative(root, item.file).replaceAll("\\", "/");
      assert.ok(
        file && file !== ".." && !file.startsWith("../") && !isAbsolute(file),
      );
      for (const key of ["line", "column", "nesting"])
        assert.ok(
          Number.isSafeInteger(item[key]) &&
            item[key] >= (key === "nesting" ? 0 : 1),
        );
      assert.ok(["passed", "failed"].includes(item.status));
      assert.equal(typeof item.skipped, "boolean");
      assert.equal(typeof item.todo, "boolean");
      // Only explicit mode labels differ. Do not normalize test input values.
      let name = item.name.replaceAll(
        `(PROOFS_ENABLED=${mode})`,
        "(PROOFS_ENABLED=<mode>)",
      );
      const cliPrefix = `runs the ${mode === "false" ? "proof-off" : "proof-on"} `;
      if (item.nesting === 0 && name.startsWith(cliPrefix))
        name = `runs the proof-<mode> ${name.slice(cliPrefix.length)}`;
      return {
        ...item,
        file,
        identity: [file, item.line, item.column, item.nesting, name],
      };
    });
  assert.ok(cases.length > 0, "Native report contains no test cases");
  const identities = cases.map((item) => JSON.stringify(item.identity)).sort();
  assert.equal(
    new Set(identities).size,
    cases.length,
    "Native report contains duplicate cases",
  );
  return {
    cases,
    identities,
    passed: cases.every(
      (item) => item.status === "passed" && !item.skipped && !item.todo,
    ),
  };
}

export function assertSameNativeCases(first, second) {
  assert.deepEqual(
    second.identities,
    first.identities,
    "Native cases changed between proof passes",
  );
}
