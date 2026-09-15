import assert from "node:assert/strict";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runComposePass } from "./compose-e2e-runner.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test(
  "full Compose treasury workflow",
  {
    skip: process.env.RUN_COMPOSE_E2E !== "true",
    timeout: Number(process.env.E2E_SUITE_TIMEOUT_MS ?? 7_200_000),
  },
  async () => {
    const result = await runComposePass({ root });
    assert.equal(result.status, "passed");
    assert.equal(result.workflowCount, 1);
    assert.equal(result.proofsEnabled, process.env.PROOFS_ENABLED === "true");
  },
);
