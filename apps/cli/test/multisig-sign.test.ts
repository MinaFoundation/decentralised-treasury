import assert from "node:assert/strict";
import test from "node:test";
import { Command } from "commander";
import { PrivateKey, Signature, UInt32 } from "o1js";
import { MultisigSignature } from "@repo/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import multisigSignCommandFactory, {
  signPauseTreasury,
} from "../src/commands/multisig-sign.js";

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

function parseMultisigOptions(args: string[]) {
  const program = new Command()
    .exitOverride()
    .configureOutput({ writeErr: () => {} });
  multisigSignCommandFactory(program);
  const command = program.commands[0].commands[0];
  command.action(() => {});
  const publicKeys = Array.from({ length: 5 }, () =>
    PrivateKey.random().toPublicKey().toBase58(),
  );
  return program.parseAsync(
    [
      "multisig-sign",
      "pause-treasury",
      "--multisig-participants-public-keys",
      publicKeys.join(","),
      "--nonce",
      "4",
      ...args,
    ],
    { from: "user" },
  );
}

test("requires a private key for in-memory break-glass signing", async () => {
  await assert.rejects(
    parseMultisigOptions([]),
    /--multisig-signer-private-key is required/,
  );
});

test("requires an explicit Ledger account index", async () => {
  await assert.rejects(
    parseMultisigOptions([
      "--signer",
      "ledger",
      "--ledger-signer-public-key",
      PrivateKey.random().toPublicKey().toBase58(),
    ]),
    /--ledger-account-index is required/,
  );
});
