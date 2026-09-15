import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "mina-signer";
import {
  AccountUpdate,
  Bool,
  Field,
  Mina,
  PrivateKey,
  Signature,
  UInt32,
} from "o1js";
import {
  signFieldWithLedgerClient,
  signTransactionWithLedgerClient,
  type LedgerSigningClient,
} from "../../src/signing/ledger-signing.js";
import { TreasuryPauseControllerSmartContract } from "../../src/provable/contracts/treasury-pause-controller/treasury-pause-controller.js";
import {
  MultisigSignature,
  MultisigSignatures,
} from "../../src/provable/contracts/treasury-pause-controller/multisig-signatures.js";

function softwareLedger(keys: PrivateKey[]): LedgerSigningClient {
  return {
    async getAddress(index, show) {
      assert.equal(show, true);
      return {
        returnCode: "9000",
        publicKey: keys[index]!.toPublicKey().toBase58(),
      };
    },
    async signFieldElement(index, network, bytes) {
      assert.equal(network, 0);
      assert.equal(bytes.length, 32);
      const field = Field(
        bytes.reduceRight((n, b) => (n << 8n) + BigInt(b), 0n),
      );
      const signature = Signature.create(keys[index]!, [field]).toJSON();
      return { returnCode: "9000", field: signature.r, scalar: signature.s };
    },
  };
}

async function fixture() {
  const local = await Mina.LocalBlockchain({ proofsEnabled: false });
  Mina.setActiveInstance(local);
  const sender = local.testAccounts[0];
  const other = local.testAccounts[1];
  const tx = await Mina.transaction(
    { sender, fee: 100_000_000, memo: "Ledger review" },
    async () => {
      AccountUpdate.createSigned(sender).send({ to: other, amount: 1 });
      AccountUpdate.createSigned(other).body.useFullCommitment = Bool(false);
    },
  );
  const ledger = softwareLedger([sender.key, other.key]);
  const indices = new Map([
    [sender.toBase58(), 0],
    [other.toBase58(), 1],
  ]);
  return { local, sender, other, tx, ledger, indices };
}

test("Ledger signatures authorize both full and partial commitments on LocalBlockchain", async () => {
  const { tx, ledger, indices } = await fixture();
  const signed = await signTransactionWithLedgerClient(
    tx,
    ledger,
    indices,
    "devnet",
  );
  await (await signed.send()).wait();
});

test("fee-payer signature binds transaction fields and custom-token account updates", async () => {
  const { tx, ledger, indices, sender } = await fixture();
  const raw = JSON.parse(tx.toJSON());
  const original = tx.toJSON();
  raw.accountUpdates[1].body.tokenId = AccountUpdate.createSigned(
    sender,
    Field(2),
  ).toJSON().body.tokenId;
  const signed = await signTransactionWithLedgerClient(
    { toJSON: () => JSON.stringify(raw) },
    ledger,
    indices,
    "devnet",
  );
  const command = JSON.parse(signed.toJSON());
  const client = new Client({ network: "devnet", era: "mesa" });
  const verify = (value: typeof command) =>
    client.verifyZkappCommand({
      data: { zkappCommand: value },
      publicKey: sender.toBase58(),
      signature: value.feePayer.authorization,
    } as Parameters<Client["verifyZkappCommand"]>[0]);
  assert.equal(verify(command), true);
  const mutations: Array<[string, (value: typeof command) => void]> = [
    [
      "fee",
      (c) => {
        c.feePayer.body.fee = "100000001";
      },
    ],
    [
      "nonce",
      (c) => {
        c.feePayer.body.nonce = "1";
      },
    ],
    [
      "validity",
      (c) => {
        c.feePayer.body.validUntil = "42";
      },
    ],
    [
      "recipient",
      (c) => {
        c.accountUpdates[1].body.publicKey = sender.toBase58();
      },
    ],
    [
      "amount",
      (c) => {
        c.accountUpdates[0].body.balanceChange.magnitude = "2";
      },
    ],
    [
      "token",
      (c) => {
        c.accountUpdates[1].body.tokenId = c.accountUpdates[0].body.tokenId;
      },
    ],
    [
      "commitment choice",
      (c) => {
        c.accountUpdates[0].body.useFullCommitment =
          !c.accountUpdates[0].body.useFullCommitment;
      },
    ],
  ];
  for (const [name, mutate] of mutations) {
    const altered = structuredClone(command);
    mutate(altered);
    assert.equal(verify(altered), false, name);
  }
  assert.equal(tx.toJSON(), original);
});

test("rejects invalid indices before device access", async () => {
  const { tx, sender, ledger } = await fixture();
  ledger.getAddress = async () => {
    throw new Error("unexpected device access");
  };
  for (const index of [-1, 0.5, NaN, Infinity, 0x1_0000_0000]) {
    await assert.rejects(
      signTransactionWithLedgerClient(
        tx,
        ledger,
        new Map([[sender.toBase58(), index]]),
        "devnet",
      ),
      /account index must be an integer/,
    );
  }
});

test("rejects substituted field signatures and propagates rejection; a fresh retry succeeds", async () => {
  const { tx, sender, ledger, indices } = await fixture();
  const normal = ledger.signFieldElement.bind(ledger);
  ledger.signFieldElement = async () => ({
    returnCode: "6985",
    field: null,
    scalar: null,
    message: "Rejected",
  });
  await assert.rejects(
    signTransactionWithLedgerClient(tx, ledger, indices, "devnet"),
    /Rejected/,
  );
  ledger.signFieldElement = async () => {
    const wrong = Signature.create(sender.key, [Field(123)]).toJSON();
    return { returnCode: "9000", field: wrong.r, scalar: wrong.s };
  };
  await assert.rejects(
    signTransactionWithLedgerClient(tx, ledger, indices, "devnet"),
    /invalid signature/,
  );
  ledger.signFieldElement = normal;
  const signed = await signTransactionWithLedgerClient(
    tx,
    ledger,
    indices,
    "devnet",
  );
  await (await signed.send()).wait();
  await assert.rejects(signed.send(), /nonce|precondition/i);
});

test("REVIEW DEFECT: Ledger-only signing must reject an omitted required account signer", async () => {
  const { tx, sender, ledger } = await fixture();
  await assert.rejects(
    signTransactionWithLedgerClient(
      tx,
      ledger,
      new Map([[sender.toBase58(), 0]]),
      "devnet",
    ),
    /required.*signer|account index is required/i,
  );
});

test("REVIEW DEFECT: a pause authorization must not be reusable on another controller", async () => {
  const proofsEnabled = process.env.PROOFS_ENABLED === "true";
  const local = await Mina.LocalBlockchain({ proofsEnabled });
  Mina.setActiveInstance(local);
  const payer = local.testAccounts[0];
  const keys = Array.from({ length: 5 }, () => PrivateKey.random());
  TreasuryPauseControllerSmartContract.multisigParticipants = keys.map((key) =>
    key.toPublicKey(),
  );
  if (proofsEnabled) await TreasuryPauseControllerSmartContract.compile();
  const controllers = [PrivateKey.random(), PrivateKey.random()].map((key) => ({
    key,
    contract: new TreasuryPauseControllerSmartContract(key.toPublicKey()),
  }));
  const deploy = await Mina.transaction(payer, async () => {
    AccountUpdate.fundNewAccount(payer, 2);
    for (const { contract } of controllers) await contract.deploy();
  });
  await deploy.prove();
  await (
    await deploy.sign([payer.key, ...controllers.map((c) => c.key)]).send()
  ).wait();
  const nonce = local.getAccount(controllers[0]!.key.toPublicKey()).nonce;
  assert.equal(
    nonce.toString(),
    local.getAccount(controllers[1]!.key.toPublicKey()).nonce.toString(),
  );
  const field = MultisigSignature.dataPauseTreasury(UInt32.from(nonce));
  const ledger = softwareLedger(keys);
  const signatures = new MultisigSignatures({
    signatures: await Promise.all(
      keys.map((key, index) =>
        signFieldWithLedgerClient(field, ledger, key.toPublicKey(), index),
      ),
    ),
  });
  const pause = async (index: number) => {
    const tx = await Mina.transaction(payer, async () => {
      await controllers[index]!.contract.pauseTreasury(signatures, nonce);
    });
    await tx.prove();
    await (await tx.sign([payer.key]).send()).wait();
  };
  try {
    await pause(0);
    assert.equal(controllers[0]!.contract.paused.get().toBoolean(), true);
    await assert.rejects(pause(1), /signature|authorization|deployment/i);
  } finally {
    TreasuryPauseControllerSmartContract.multisigParticipants = [];
  }
});

test("REVIEW DEFECT: one Ledger signature must not satisfy three participant slots", async () => {
  const key = PrivateKey.random();
  const participants = [
    key,
    key,
    key,
    PrivateKey.random(),
    PrivateKey.random(),
  ].map((key) => key.toPublicKey());
  const message = MultisigSignature.dataPauseTreasury(UInt32.from(0));
  const signature = await signFieldWithLedgerClient(
    message,
    softwareLedger([key]),
    key.toPublicKey(),
    0,
  );
  const signatures = new MultisigSignatures({
    signatures: [
      signature,
      signature,
      signature,
      Signature.empty(),
      Signature.empty(),
    ],
  });
  await assert.rejects(
    signatures.verify(
      message,
      MultisigSignatures.createCommitment(participants),
      participants,
    ),
    /distinct|unique|participant|signature/i,
  );
});
