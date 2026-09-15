import assert from "node:assert/strict";
import test from "node:test";
import { getBackendPreference, initializeBindings } from "o1js";

test("attests the proof-off native o1js backend", async (t) => {
  assert.equal(process.env.PROOFS_ENABLED, "false");
  assert.equal(process.env.O1JS_BACKEND, "native");
  assert.equal(process.env.O1JS_REQUIRE_NATIVE_BINDINGS, "1");
  assert.equal(getBackendPreference(), "native");

  await initializeBindings();

  const backendState = globalThis as typeof globalThis & {
    __kimchi_backend?: unknown;
    __o1js_backend_preference?: unknown;
  };
  assert.equal(backendState.__o1js_backend_preference, "native");
  assert.equal(backendState.__kimchi_backend, "native");
  t.diagnostic(`@o1js/native-${process.platform}-${process.arch}`);
});
