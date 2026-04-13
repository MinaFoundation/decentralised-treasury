import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Field, PrivateKey } from "o1js";
import {
  MIN_VALID_MULTISIG_SIGNATURES_COUNT,
  MULTISIG_PARTICIPANTS_COUNT,
  MultisigSignature,
} from "@repo/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import { parseMultisigSignatures } from "../src/commands/pause-controller.js";

function createSignatureBase58(seed: number): string {
  return MultisigSignature.create(PrivateKey.random(), [Field(seed)]).toBase58();
}

describe("parseMultisigSignatures", () => {
  it("pads missing trailing signatures with empty slots", () => {
    const provided = [
      createSignatureBase58(1),
      createSignatureBase58(2),
      createSignatureBase58(3),
    ];
    const parsed = parseMultisigSignatures(provided.join(","));

    assert.equal(parsed.signatures.length, MULTISIG_PARTICIPANTS_COUNT);
    assert.deepEqual(
      parsed.signatures
        .slice(0, provided.length)
        .map((signature) => signature.toBase58()),
      provided,
    );
    assert(
      parsed.signatures
        .slice(provided.length)
        .every(
          (signature) =>
            signature.toBase58() === MultisigSignature.empty().toBase58(),
        ),
      "expected trailing signatures to be empty placeholders",
    );
  });

  it("preserves explicit empty slot positions", () => {
    const first = createSignatureBase58(11);
    const third = createSignatureBase58(13);
    const fifth = createSignatureBase58(15);
    const parsed = parseMultisigSignatures(
      [first, "", third, "", fifth].join(","),
    );

    assert.equal(parsed.signatures.length, MULTISIG_PARTICIPANTS_COUNT);
    assert.equal(parsed.signatures[0]?.toBase58(), first);
    assert.equal(
      parsed.signatures[1]?.toBase58(),
      MultisigSignature.empty().toBase58(),
    );
    assert.equal(parsed.signatures[2]?.toBase58(), third);
    assert.equal(
      parsed.signatures[3]?.toBase58(),
      MultisigSignature.empty().toBase58(),
    );
    assert.equal(parsed.signatures[4]?.toBase58(), fifth);
  });

  it("rejects fewer signatures than the multisig minimum", () => {
    const provided = [createSignatureBase58(1), createSignatureBase58(2)];
    assert.throws(
      () => parseMultisigSignatures(provided.join(",")),
      new RegExp(`Expected at least ${MIN_VALID_MULTISIG_SIGNATURES_COUNT}`),
    );
  });

  it("counts only non-empty entries toward the multisig minimum", () => {
    const withGap = [createSignatureBase58(1), "", createSignatureBase58(3)];
    assert.throws(
      () => parseMultisigSignatures(withGap.join(",")),
      new RegExp(`Expected at least ${MIN_VALID_MULTISIG_SIGNATURES_COUNT}`),
    );
  });

  it("rejects more signatures than the participant count", () => {
    const provided = Array.from(
      { length: MULTISIG_PARTICIPANTS_COUNT + 1 },
      (_, index) => createSignatureBase58(index + 1),
    );
    assert.throws(
      () => parseMultisigSignatures(provided.join(",")),
      new RegExp(
        `Expected at most ${MULTISIG_PARTICIPANTS_COUNT} multisig signature slots`,
      ),
    );
  });
});
