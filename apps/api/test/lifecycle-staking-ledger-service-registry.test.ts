import { mkdtempSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { completedSnapshotIdentity } from "../src/staking-ledger/completed-snapshot.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StakingLedgerService } from "@repo/sdk/src/services/staking-ledger-service.js";
import { LifecycleStakingLedgerServiceRegistry } from "../src/staking-ledger/lifecycle-staking-ledger-service-registry.js";

interface StubState {
  started: boolean;
  closed: boolean;
}

function createStubService(
  state: StubState,
  start: () => Promise<void>,
): StakingLedgerService {
  return {
    start: async () => {
      await start();
      state.started = true;
    },
    close: async () => {
      state.closed = true;
    },
  } as StakingLedgerService;
}

describe("LifecycleStakingLedgerServiceRegistry", () => {
  it("closes a partially started service and permits a retry", async () => {
    let createCalls = 0;
    const states: StubState[] = [];
    const registry = new LifecycleStakingLedgerServiceRegistry(() => {
      createCalls += 1;
      const state = { started: false, closed: false };
      states.push(state);
      return createStubService(state, async () => {
        if (createCalls === 1) {
          throw new Error("start failed");
        }
      });
    });

    await assert.rejects(registry.getService("1"), /start failed/);
    assert.equal(states[0]?.closed, true);

    const service = await registry.getService("1");
    assert.ok(service);
    assert.equal(createCalls, 2);
    assert.equal(states[1]?.started, true);

    await registry.close();
    assert.equal(states[1]?.closed, true);
  });

  it("waits for an in-flight start and closes that service", async () => {
    let releaseStart: (() => void) | null = null;
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const state = { started: false, closed: false };
    const service = createStubService(state, async () => await startGate);
    const registry = new LifecycleStakingLedgerServiceRegistry(() => service);

    const lookup = registry.getService("2");
    const close = registry.close();
    assert.ok(releaseStart);
    releaseStart();

    await assert.rejects(lookup, /closing or closed/);
    await close;
    assert.equal(state.closed, true);
    await assert.rejects(registry.getService("2"), /closing or closed/);
  });

  it("rejects lifecycle ids outside the contract UInt32 domain", async () => {
    const state = { started: false, closed: false };
    const registry = new LifecycleStakingLedgerServiceRegistry(() =>
      createStubService(state, async () => {}),
    );

    await assert.rejects(registry.getService("4294967296"), /unsigned 32-bit/);
    await registry.close();
  });
});

it("opens only completed snapshots and replaces cached stores after a rebuild", async () => {
  const directory = mkdtempSync(join(tmpdir(), "completed-snapshot-"));
  const previous = process.env.SQLITE_DATA_DIRECTORY;
  process.env.SQLITE_DATA_DIRECTORY = directory;
  const states: StubState[] = [];
  const registry = new LifecycleStakingLedgerServiceRegistry(() => {
    const state = { started: false, closed: false };
    states.push(state);
    return createStubService(state, async () => {});
  }, completedSnapshotIdentity);
  const database = join(directory, "3.sqlite");
  const marker = `${database}.done`;
  const complete = () =>
    writeFileSync(
      marker,
      JSON.stringify({
        lifecycleId: "3",
        ledgerHash: "root",
        processedAt: new Date().toISOString(),
      }),
    );
  try {
    writeFileSync(database, "first snapshot");
    await assert.rejects(registry.getService("3"), /not available/);
    writeFileSync(marker, "{");
    await assert.rejects(registry.getService("3"), /not available/);
    assert.equal(states.length, 0);
    complete();
    const first = await registry.getService("3");
    assert.equal(await registry.getService("3"), first);
    rmSync(marker);
    await assert.rejects(registry.getService("3"), /not available/);
    writeFileSync(`${database}.new`, "second snapshot");
    renameSync(`${database}.new`, database);
    complete();
    const [second, concurrent] = await Promise.all([
      registry.getService("3"),
      registry.getService("3"),
    ]);
    assert.notEqual(second, first);
    assert.equal(second, concurrent);
    assert.equal(states.length, 2);
    assert.equal(states[0]?.closed, true);
  } finally {
    await registry.close();
    if (previous === undefined) delete process.env.SQLITE_DATA_DIRECTORY;
    else process.env.SQLITE_DATA_DIRECTORY = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
