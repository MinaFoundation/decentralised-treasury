import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("root CLI reads relative input paths from the repository root", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const directory = await mkdtemp(join(root, ".cli-launcher-test-"));
  try {
    const input = join(directory, "actions.json");
    // Invalid input must reach the JSON validator before any database access.
    await writeFile(input, "{}");
    const env = { ...process.env, NODE_NO_WARNINGS: "1" };
    delete env.TS_NODE_PROJECT;
    const result = spawnSync(
      "pnpm",
      [
        "run", "cli", "--", "vote-reducer", "clear-state",
        "--lifecycle-id", "1", "--vote-actions-path", relative(root, input),
      ],
      { cwd: root, env, encoding: "utf8", timeout: 60_000 },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /Invalid vote actions JSON/);
    assert.doesNotMatch(result.stderr, /ENOENT|ERR_MODULE_NOT_FOUND/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
