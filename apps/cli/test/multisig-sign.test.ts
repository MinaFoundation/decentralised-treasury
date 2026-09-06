import assert from "node:assert/strict";
import test from "node:test";
import { PrivateKey, Signature, UInt32 } from "o1js";
import { MultisigSignature } from "@repo/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import { signPauseTreasury } from "../src/commands/multisig-sign.js";

test("keeps in-memory break-glass signing as the default-compatible path", async () => {
  const privateKeys = Array.from({ length: 5 }, () => PrivateKey.random());
  const output: string[] = [];
  const previousLog = console.log;
  console.log = (value?: unknown) => output.push(String(value));
  try {
    await signPauseTreasury({
      signer: "in-memory",
      multisigParticipantsPublicKeys: privateKeys.map((key) =>
        key.toPublicKey(),
      ),
      multisigSignerPrivateKey: privateKeys[0],
      nonce: 4,
    });
  } finally {
    console.log = previousLog;
  }

  const result = JSON.parse(output.at(-1) ?? "") as {
    signature: string;
    signerParticipantIndex: number;
  };
  const dataHash = MultisigSignature.dataPauseTreasury(UInt32.from(4));
  assert.equal(result.signerParticipantIndex, 0);
  assert.equal(
    Signature.fromBase58(result.signature)
      .verify(privateKeys[0].toPublicKey(), [dataHash])
      .toBoolean(),
    true,
  );
});

test("requires a private key for in-memory break-glass signing", async () => {
  const publicKeys = Array.from({ length: 5 }, () =>
    PrivateKey.random().toPublicKey(),
  );
  await assert.rejects(
    signPauseTreasury({
      signer: "in-memory",
      multisigParticipantsPublicKeys: publicKeys,
      nonce: 4,
    }),
    /multisig-signer-private-key/,
  );
});

test("requires an explicit Ledger account index", async () => {
  const publicKeys = Array.from({ length: 5 }, () =>
    PrivateKey.random().toPublicKey(),
  );
  const previousPublicKey = process.env.LEDGER_SIGNER_PUBLIC_KEY;
  process.env.LEDGER_SIGNER_PUBLIC_KEY = publicKeys[0].toBase58();
  try {
    await assert.rejects(
      signPauseTreasury({
        signer: "ledger",
        multisigParticipantsPublicKeys: publicKeys,
        nonce: 4,
      }),
      /ledger-account-index/,
    );
  } finally {
    if (previousPublicKey === undefined) {
      delete process.env.LEDGER_SIGNER_PUBLIC_KEY;
    } else {
      process.env.LEDGER_SIGNER_PUBLIC_KEY = previousPublicKey;
    }
  }
});
