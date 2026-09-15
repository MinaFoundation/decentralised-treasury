import assert from "node:assert/strict";
import test from "node:test";

test(`native parent (PROOFS_ENABLED=${process.env.PROOFS_ENABLED})`, async (t) => {
  await t.test("native nested case", () => assert.equal(1 + 1, 2));
});
