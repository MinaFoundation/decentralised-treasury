import assert from "node:assert/strict";
import test from "node:test";
import { applyRuntimeOverrides, parseArgs } from "../scripts/bootstrap-env.mjs";

test("parses proof and signature network overrides", () => {
  const options = parseArgs([
    "testnet",
    "--proofs-enabled",
    "false",
    "--network-id",
    "testnet",
  ]);

  assert.equal(options.proofsEnabled, "false");
  assert.equal(options.networkId, "testnet");
});

test("applies proof and signature network overrides to each consumer", () => {
  const source = [
    "PROOFS_ENABLED=true",
    "NEXT_PUBLIC_PROOFS_ENABLED=true",
    "MINA_NETWORK_ID=devnet",
    "NEXT_PUBLIC_NETWORK_ID=DEVNET",
    "# PROOFS_ENABLED=true",
  ].join("\n");

  assert.equal(
    applyRuntimeOverrides(source, {
      proofsEnabled: "false",
      networkId: "testnet",
    }),
    [
      "PROOFS_ENABLED=false",
      "NEXT_PUBLIC_PROOFS_ENABLED=false",
      "MINA_NETWORK_ID=testnet",
      "NEXT_PUBLIC_NETWORK_ID=testnet",
      "# PROOFS_ENABLED=true",
    ].join("\n"),
  );
});

test("rejects unsupported proof and signature network values", () => {
  assert.throws(
    () => parseArgs(["testnet", "--proofs-enabled", "yes"]),
    /must be true or false/,
  );
  assert.throws(
    () => parseArgs(["testnet", "--network-id", "localnet"]),
    /must be mainnet, devnet, or testnet/,
  );
});
