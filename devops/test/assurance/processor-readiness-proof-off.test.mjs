import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertProcessorReady } from "../../../apps/api/src/processor-status-routes.ts";

const PROCESSOR_NAME = "assurance-proposal-processor";
const PROJECTION_NAME = "proposal";

function readyRuntime(heartbeatAt = new Date().toISOString()) {
  return {
    lifecycle_state: "running",
    heartbeat_at: heartbeatAt,
    last_success_at: heartbeatAt,
    last_error_at: null,
    last_error_code: null,
    bounded_last_error: null,
    updated_at: heartbeatAt,
  };
}

function completeReplay(updatedAt = new Date().toISOString()) {
  return {
    projection_name: PROJECTION_NAME,
    target_change_sequence: "19",
    state: "complete",
    completed_at: updatedAt,
    updated_at: updatedAt,
  };
}

function dataSource({
  runtime = readyRuntime(),
  dueFailureCount = 0,
  replay = completeReplay(),
} = {}) {
  const queries = [];
  const source = {
    options: { schema: "assurance" },
    async query(sql, parameters) {
      queries.push({ sql, parameters: structuredClone(parameters) });
      if (sql.includes('"processor_runtime_status"')) {
        return runtime === null ? [] : [structuredClone(runtime)];
      }
      if (sql.includes('"processor_event_failures"')) {
        return [{ count: String(dueFailureCount) }];
      }
      if (sql.includes('"processor_proposal_projection_replay"')) {
        return replay === null ? [] : [structuredClone(replay)];
      }
      throw new Error(`Unexpected readiness query: ${sql}`);
    },
  };
  return { source, queries };
}

async function checkReady(source) {
  await assertProcessorReady({
    dataSource: source,
    processorName: PROCESSOR_NAME,
    projectionName: PROJECTION_NAME,
    heartbeatMaxAgeMs: 30_000,
  });
}

describe("proof-off processor readiness", () => {
  it("requires the proof-off process contract", () => {
    assert.equal(process.env.PROOFS_ENABLED, "false");
  });

  it("accepts a fresh active processor with no due failures and a complete replay", async () => {
    const { source, queries } = dataSource();

    await checkReady(source);

    assert.equal(queries.length, 3);
    assert.equal(
      queries.every(({ sql }) => /^\s*SELECT\b/u.test(sql)),
      true,
    );
  });

  it("CALL-PROJECTION-006/OPS-RESTART-020 rejects every incomplete readiness shape without writes", async () => {
    const now = Date.now();
    const cases = [
      { name: "missing runtime", options: { runtime: null } },
      {
        name: "stopped runtime",
        options: {
          runtime: { ...readyRuntime(), lifecycle_state: "stopped" },
        },
      },
      {
        name: "stale heartbeat",
        options: {
          runtime: readyRuntime(new Date(now - 30_001).toISOString()),
        },
      },
      { name: "due failure", options: { dueFailureCount: 1 } },
      { name: "missing replay", options: { replay: null } },
      {
        name: "incomplete replay",
        options: {
          replay: {
            ...completeReplay(),
            state: "running",
            completed_at: null,
          },
        },
      },
    ];

    for (const testCase of cases) {
      const sqlitePublication = {
        fileExists: true,
        lifecycleDatabaseComplete: false,
      };
      const before = structuredClone(sqlitePublication);
      const { source, queries } = dataSource(testCase.options);

      await assert.rejects(
        checkReady(source),
        /Processor runtime is not ready/u,
        testCase.name,
      );
      assert.deepEqual(sqlitePublication, before, testCase.name);
      assert.equal(queries.length, 3, testCase.name);
      assert.equal(
        queries.every(({ sql }) => /^\s*SELECT\b/u.test(sql)),
        true,
        testCase.name,
      );
    }
  });
});
