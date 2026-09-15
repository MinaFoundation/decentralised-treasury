import assert from "node:assert/strict";
import test from "node:test";
import { AccountUpdate, Bool, Field, Mina, PrivateKey, Signature } from "o1js";
import {
  signFieldWithLedgerClient,
  signTransactionWithLedgerClient,
  type LedgerSigningClient,
} from "@repo/sdk/src/signing/ledger-signing.js";
import { logLedgerSigningProgress } from "../src/ledger/signing-progress.js";

for (const validSignature of [true, false]) {
  test(`Ledger field progress ${validSignature ? "reports verified signatures" : "does not report invalid signatures as verified"}`, async (t) => {
    const key = PrivateKey.random();
    const publicKey = key.toPublicKey();
    const hash = Field(12345);
    const logs: string[] = [];
    t.mock.method(console, "error", (message: string) => logs.push(message));
    const stdout = t.mock.method(console, "log", () => {});
    const ledger: LedgerSigningClient = {
      async getAddress(index, showOnDevice) {
        assert.equal(index, 3);
        assert.equal(showOnDevice, true);
        assert.match(logs.at(-1)!, /Verify account on the Ledger device/);
        assert.ok(!logs.some((line) => line.includes("Account verified")));
        return { returnCode: "9000", publicKey: publicKey.toBase58() };
      },
      async signFieldElement(index, network, bytes) {
        assert.equal(index, 3);
        assert.equal(network, 0);
        assert.deepEqual(bytes, new Uint8Array(Field.toBytes(hash)));
        assert.match(logs.at(-2)!, /Account verified/);
        assert.match(logs.at(-1)!, /Waiting for signature/);
        assert.ok(logs.at(-1)!.includes(`Device hash: ${"0".repeat(60)}3039`));
        assert.ok(logs.at(-1)!.includes(publicKey.toBase58()));
        const signature = Signature.create(
          validSignature ? key : PrivateKey.random(),
          [hash],
        ).toJSON();
        return { returnCode: "9000", field: signature.r, scalar: signature.s };
      },
    };
    const signing = signFieldWithLedgerClient(
      hash,
      ledger,
      publicKey,
      3,
      logLedgerSigningProgress,
    );
    if (validSignature) {
      await signing;
      assert.match(logs.at(-1)!, /Signature verified/);
      assert.ok(logs.at(-1)!.includes(`deviceHash=${"0".repeat(60)}3039`));
    } else {
      await assert.rejects(signing, /invalid field signature/);
      assert.ok(!logs.some((line) => line.includes("Signature verified")));
    }
    assert.equal(stdout.mock.callCount(), 0);
  });
}

// Fixed vectors cover leading zeros, letter case, byte order, and the field limit.
for (const [decimal, expectedHex] of [
  ["0", "0000000000000000000000000000000000000000000000000000000000000000"],
  ["12345", "0000000000000000000000000000000000000000000000000000000000003039"],
  [
    "11259375",
    "0000000000000000000000000000000000000000000000000000000000abcdef",
  ],
  [
    "28948022309329048855892746252171976963363056481941560715954676764349967630336",
    "40000000000000000000000000000000224698fc094cf91b992d30ed00000000",
  ],
]) {
  test(`Ledger device hash matches the firmware display for field ${decimal}`, async (t) => {
    const key = PrivateKey.random();
    const logs: string[] = [];
    t.mock.method(console, "error", (message: string) => logs.push(message));
    const ledger: LedgerSigningClient = {
      async getAddress() {
        return { returnCode: "9000", publicKey: key.toPublicKey().toBase58() };
      },
      async signFieldElement(_index, _network, bytes) {
        // The firmware reverses the incoming bytes for its hex display.
        const firmwareDisplay = Buffer.from(bytes).reverse().toString("hex");
        assert.equal(firmwareDisplay, expectedHex);
        assert.equal(
          logs.at(-1)!.match(/Device hash: ([0-9a-f]{64})\n/)?.[1],
          firmwareDisplay,
        );
        const signature = Signature.create(key, [Field(decimal)]).toJSON();
        return { returnCode: "9000", field: signature.r, scalar: signature.s };
      },
    };
    await signFieldWithLedgerClient(
      Field(decimal),
      ledger,
      key.toPublicKey(),
      0,
      logLedgerSigningProgress,
    );
  });
}

test("each transaction signature shows the commitment sent to Ledger", async (t) => {
  const local = await Mina.LocalBlockchain({ proofsEnabled: false });
  Mina.setActiveInstance(local);
  const sender = local.testAccounts[0];
  const transaction = await Mina.transaction(sender, async () => {
    AccountUpdate.createSigned(sender).body.useFullCommitment = Bool(false);
  });
  const logs: string[] = [];
  t.mock.method(console, "error", (message: string) => logs.push(message));
  const stdout = t.mock.method(console, "log", () => {});
  const deviceHashes: string[] = [];
  const ledger: LedgerSigningClient = {
    async getAddress() {
      return { returnCode: "9000", publicKey: sender.toBase58() };
    },
    async signFieldElement(_index, network, bytes) {
      assert.equal(network, 0);
      const firmwareDisplay = Buffer.from(bytes).reverse().toString("hex");
      assert.equal(
        logs.at(-1)!.match(/Device hash: ([0-9a-f]{64})\n/)?.[1],
        firmwareDisplay,
      );
      deviceHashes.push(firmwareDisplay);
      const signature = Signature.create(sender.key, [
        Field(BigInt(`0x${firmwareDisplay}`)),
      ]).toJSON();
      return { returnCode: "9000", field: signature.r, scalar: signature.s };
    },
  };
  await signTransactionWithLedgerClient(
    transaction,
    ledger,
    new Map([[sender.toBase58(), 0]]),
    "devnet",
    logLedgerSigningProgress,
  );
  assert.equal(deviceHashes.length, 2);
  assert.notEqual(deviceHashes[0], deviceHashes[1]);
  assert.ok(logs[0].includes(`fullCommitment=${deviceHashes[0]}`));
  assert.ok(logs[0].includes(`commitment=${deviceHashes[1]}`));
  assert.equal(
    logs.filter((line) => line.includes("Signature verified")).length,
    2,
  );
  assert.equal(stdout.mock.callCount(), 0);
});
