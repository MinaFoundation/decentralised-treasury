import assert from "node:assert/strict";
import test from "node:test";
import { applyRuntimeOverrides, parseArgs } from "../scripts/bootstrap-env.mjs";

test("parses proof and signature network overrides", () => {
  const options = parseArgs([
    "testnet",
    "--proofs-enabled",
    "false",
    "--network",
    "DEVNET",
  ]);

  assert.equal(options.proofsEnabled, "false");
  assert.equal(options.network, "devnet");
});

test("applies proof and signature network overrides to each consumer", () => {
  const source = [
    "PROOFS_ENABLED=true",
    "NEXT_PUBLIC_PROOFS_ENABLED=true",
    "NETWORK=devnet",
    "NEXT_PUBLIC_NETWORK_ID=DEVNET",
    "# PROOFS_ENABLED=true",
  ].join("\n");

  assert.equal(
    applyRuntimeOverrides(source, {
      proofsEnabled: "false",
      network: "mainnet",
    }),
    [
      "PROOFS_ENABLED=false",
      "NEXT_PUBLIC_PROOFS_ENABLED=false",
      "NETWORK=mainnet",
      "NEXT_PUBLIC_NETWORK_ID=mainnet",
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
    () => parseArgs(["testnet", "--network", "localnet"]),
    /must be mainnet or devnet/,
  );
});
