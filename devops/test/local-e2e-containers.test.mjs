import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanupTestContainers,
  TEST_CONTAINER_LABEL,
} from "./local-e2e-process.mjs";

const runId = "example-false-web";
const ids = ["a".repeat(64), "b".repeat(64)];

function dockerFixture(
  containers = ids.map((Id) => ({
    Id,
    Config: { Labels: { [TEST_CONTAINER_LABEL]: runId } },
  })),
) {
  const calls = [];
  return {
    calls,
    run: async (args) => {
      calls.push(args);
      if (args[0] === "ps") return `${ids.join("\n")}\n`;
      if (args[0] === "inspect") return JSON.stringify(containers);
      if (args[0] === "rm") return "";
      throw new Error("Unexpected Docker command");
    },
  };
}

test("removes only inspected containers with the exact suite-run label", async () => {
  const docker = dockerFixture();
  assert.deepEqual(await cleanupTestContainers(runId, docker.run), ids);
  assert.deepEqual(docker.calls, [
    [
      "ps",
      "--all",
      "--quiet",
      "--no-trunc",
      "--filter",
      `label=${TEST_CONTAINER_LABEL}=${runId}`,
    ],
    ["inspect", ...ids],
    ["rm", "--force", ...ids],
  ]);
});

for (const [name, containers] of [
  [
    "wrong run label",
    ids.map((Id) => ({
      Id,
      Config: { Labels: { [TEST_CONTAINER_LABEL]: "another-run" } },
    })),
  ],
  ["missing run label", ids.map((Id) => ({ Id, Config: {} }))],
  ["missing inspected container", []],
  [
    "different inspected IDs",
    ids.map(() => ({
      Id: "c".repeat(64),
      Config: { Labels: { [TEST_CONTAINER_LABEL]: runId } },
    })),
  ],
]) {
  test(`does not remove containers with ${name}`, async () => {
    const docker = dockerFixture(containers);
    await assert.rejects(cleanupTestContainers(runId, docker.run));
    assert.equal(
      docker.calls.some((args) => args[0] === "rm"),
      false,
    );
  });
}

test("an empty run does not trigger a remove command", async () => {
  const calls = [];
  assert.deepEqual(
    await cleanupTestContainers(runId, async (args) => {
      calls.push(args);
      return "";
    }),
    [],
  );
  assert.equal(calls.length, 1);
});

test("rejects malformed selectors and IDs before removal", async () => {
  await assert.rejects(
    cleanupTestContainers("", () => assert.fail("must not call Docker")),
  );
  await assert.rejects(
    cleanupTestContainers("--all", async () => "unexpected-id"),
    /Invalid test container ID/,
  );
});
