import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

test("E2E-LIGHTNET-001/002/003 records the proof-off network exception", async (t) => {
  assert.equal(process.env.PROOFS_ENABLED, "false");
  assert.notEqual(process.env.RUN_LIGHTNET_E2E, "true");

  const suitePath = "apps/api/test/e2e/proposal-lifecycle-lightnet.e2e.ts";
  await access(`${REPOSITORY_ROOT}/${suitePath}`);
  const suite = await readFile(`${REPOSITORY_ROOT}/${suitePath}`, "utf8");
  assert.match(suite, /RUN_LIGHTNET_E2E/u);

  t.diagnostic(
    JSON.stringify({
      lane: "Lightnet",
      proofOff: "not-applicable",
      executed: false,
      requiredMode: "PROOFS_ENABLED=true",
      approvalRequired: true,
      suitePath,
    }),
  );
});
