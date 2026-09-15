import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { createServiceControls } from "./local-e2e-services.mjs";

for (const name of ["local-blockchain", "postgres", "", "../indexer"]) {
  test(`service controls reject out-of-scope target ${JSON.stringify(name)}`, async () => {
    const controls = createServiceControls(() =>
      assert.fail("Must not launch"),
    );
    assert.throws(() => controls.start(name), /Unknown fixture service/);
    await assert.rejects(controls.stop(name), /Unknown fixture service/);
  });
}

test("service controls stop and restart only the selected fixture process", async (t) => {
  const children = [];
  const controls = createServiceControls(() => {
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {
        stdio: "ignore",
      },
    );
    children.push(child);
    return child;
  });
  t.after(async () => {
    await Promise.all([controls.stop("indexer"), controls.stop("processor")]);
  });
  const indexer = controls.start("indexer");
  const processor = controls.start("processor");
  await Promise.all([once(indexer, "spawn"), once(processor, "spawn")]);
  assert.throws(() => controls.start("indexer"), /already active/);
  await Promise.all([controls.stop("indexer"), controls.stop("indexer")]);
  assert.equal(indexer.signalCode, "SIGTERM");
  assert.equal(processor.exitCode, null);
  assert.equal(processor.signalCode, null);
  const restarted = controls.start("indexer");
  await once(restarted, "spawn");
  assert.notEqual(restarted.pid, indexer.pid);
  assert.equal(children.length, 3);
});

test("service controls force a selected process that ignores termination", async (t) => {
  const controls = createServiceControls(
    () =>
      spawn(
        process.execPath,
        [
          "-e",
          "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)",
        ],
        { stdio: ["ignore", "pipe", "ignore"] },
      ),
    { graceMs: 50 },
  );
  t.after(() => controls.stop("app-api"));
  const child = controls.start("app-api");
  await once(child.stdout, "data");
  await controls.stop("app-api");
  assert.equal(child.signalCode, "SIGKILL");
});
