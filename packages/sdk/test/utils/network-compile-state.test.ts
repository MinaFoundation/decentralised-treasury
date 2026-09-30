import assert from "node:assert/strict";
import { test } from "node:test";
import { createNetworkCompileState } from "../../src/utils/network-compile-state.js";

test("recompiles after each network switch, including A to B to A", async () => {
  const state = createNetworkCompileState();
  const compiled: string[] = [];
  const compile = (key: string) => async () => {
    compiled.push(key);
  };

  await state.run("mainnet:true", compile("mainnet:true"));
  await state.run("mainnet:true", compile("mainnet:true"));
  await state.run("devnet:true", compile("devnet:true"));
  await state.run("mainnet:true", compile("mainnet:true"));

  assert.deepEqual(compiled, ["mainnet:true", "devnet:true", "mainnet:true"]);
});

test("recompiles A after a failed B compile", async () => {
  const state = createNetworkCompileState();
  const compiled: string[] = [];

  await state.run("mainnet:true", async () => {
    compiled.push("mainnet:true");
  });
  await assert.rejects(
    state.run("devnet:true", async () => {
      compiled.push("devnet:true:failed");
      throw new Error("compile failed");
    }),
  );
  await state.run("mainnet:true", async () => {
    compiled.push("mainnet:true");
  });

  assert.deepEqual(compiled, [
    "mainnet:true",
    "devnet:true:failed",
    "mainnet:true",
  ]);
});
