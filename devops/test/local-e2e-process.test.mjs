import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { signalProcessGroup, stopProcessGroup } from "./local-e2e-process.mjs";

async function fixture(t, source) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const closed = once(child, "close");
  let stopped = false;
  t.after(() => {
    if (!stopped) signalProcessGroup(child.pid, "SIGKILL");
  });
  await once(child.stdout, "data");
  return {
    child,
    closed,
    stop: async (options) => {
      const result = await stopProcessGroup(child.pid, options);
      stopped = true;
      return result;
    },
  };
}

test(
  "stops a cooperative test child without a forced kill",
  { timeout: 5_000 },
  async (t) => {
    const { closed, stop } = await fixture(
      t,
      "console.log('ready'); setInterval(() => {}, 1000);",
    );
    const result = await stop({ graceMs: 500 });
    await closed;
    assert.equal(result.forced, false);
  },
);

test(
  "forces termination when the test child ignores SIGTERM",
  { timeout: 5_000 },
  async (t) => {
    const { child, closed, stop } = await fixture(
      t,
      "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);",
    );
    const result = await stop({ graceMs: 50 });
    await closed;
    assert.equal(result.forced, process.platform !== "win32");
    assert.equal(signalProcessGroup(child.pid, 0), false);
  },
);

test(
  "retains the group target after its immediate child exits",
  {
    timeout: 5_000,
    skip:
      process.platform === "win32"
        ? "POSIX process groups are not available on Windows"
        : false,
  },
  async (t) => {
    const source = `
    import { spawn } from 'node:child_process';
    const nested = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);"], { stdio: ['ignore', 'pipe', 'ignore'] });
    nested.stdout.once('data', () => { console.log(nested.pid); process.exit(0); });
  `;
    const { child, closed, stop } = await fixture(t, source);
    await closed;
    assert.equal(signalProcessGroup(child.pid, 0), true);
    const result = await stop({ graceMs: 50 });
    assert.equal(result.forced, true);
  },
);

for (const pid of [0, 1, -1, NaN, undefined, process.pid]) {
  test(`rejects unsafe cleanup PID ${String(pid)}`, () => {
    assert.throws(() => signalProcessGroup(pid, "SIGTERM"));
  });
}
