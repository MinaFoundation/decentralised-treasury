import assert from "node:assert/strict";
import { test } from "node:test";
import {
  minaNetworkCacheKey,
  resolveTreasuryNetwork,
} from "../../src/utils/mina-network.js";

test("normalizes the supported Treasury networks and defaults to mainnet", () => {
  assert.equal(resolveTreasuryNetwork(), "mainnet");
  assert.equal(resolveTreasuryNetwork(" MAINNET "), "mainnet");
  assert.equal(resolveTreasuryNetwork("DeVnEt"), "devnet");
  assert.throws(() => resolveTreasuryNetwork("testnet"));
  assert.throws(() => resolveTreasuryNetwork("localnet"));
});

test("creates distinct compile cache keys for custom networks", () => {
  assert.equal(minaNetworkCacheKey("mainnet"), "mainnet");
  assert.equal(minaNetworkCacheKey("devnet"), "devnet");
  assert.notEqual(
    minaNetworkCacheKey({ custom: "alpha" }),
    minaNetworkCacheKey({ custom: "beta" }),
  );
});
