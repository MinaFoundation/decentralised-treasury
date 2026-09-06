import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Field, PrivateKey, PublicKey } from "o1js";
import {
  isExactVoteReducerPadding,
  MAX_UINT32,
  MAX_UINT64,
  parseContractBool,
  parseContractField,
  parseContractPublicKey,
  parseContractUInt32,
  parseContractUInt64,
  requireContractUInt64,
} from "../src/processors/proposals/proposal-contract-domain.js";

describe("proposal contract domains", () => {
  it("enforces the UInt32 and UInt64 boundaries", () => {
    assert.equal(
      parseContractUInt32(MAX_UINT32.toString()),
      Number(MAX_UINT32),
    );
    assert.equal(parseContractUInt32((MAX_UINT32 + 1n).toString()), null);
    assert.equal(parseContractUInt32("-1"), null);
    assert.equal(parseContractUInt32("01"), null);

    assert.equal(
      parseContractUInt64(MAX_UINT64.toString()),
      MAX_UINT64.toString(),
    );
    assert.equal(parseContractUInt64((MAX_UINT64 + 1n).toString()), null);
    assert.equal(parseContractUInt64("-1"), null);
    assert.equal(parseContractUInt64("01"), null);
    assert.throws(
      () => requireContractUInt64(MAX_UINT64 + 1n, "test value"),
      /UInt64 range/,
    );
  });

  it("accepts only canonical contract fields, public keys, and booleans", () => {
    const publicKey = PrivateKey.random().toPublicKey().toBase58();
    assert.equal(parseContractPublicKey(publicKey), publicKey);
    assert.equal(parseContractPublicKey("not-a-public-key"), null);
    assert.equal(parseContractField("0"), "0");
    assert.equal(
      parseContractField((Field.ORDER - 1n).toString()),
      (Field.ORDER - 1n).toString(),
    );
    assert.equal(parseContractField(Field.ORDER.toString()), null);
    assert.equal(parseContractBool(true), true);
    assert.equal(parseContractBool("false"), false);
    assert.equal(parseContractBool("0"), null);
  });

  it("matches only the contract two-field padding predicate", () => {
    const emptyPublicKey = PublicKey.empty().toBase58();
    const nonemptyPublicKey = PrivateKey.random().toPublicKey().toBase58();

    assert.equal(isExactVoteReducerPadding("dummy", emptyPublicKey), true);
    assert.equal(isExactVoteReducerPadding("dummy", nonemptyPublicKey), false);
    assert.equal(isExactVoteReducerPadding("yay", emptyPublicKey), false);
  });
});
