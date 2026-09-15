import assert from "node:assert/strict";
import test from "node:test";
import { Command, Option } from "commander";
import { AccountUpdate, Mina, PrivateKey, Transaction } from "o1js";
import {
  addTransactionSignerOptions,
  createTransactionSigner,
  resolveSigningAccount,
  selectTransactionLedgerAccountIndices,
} from "../src/ledger/transaction-signer.js";

function parseSigningOptions(args: string[]) {
  const command = new Command()
    .exitOverride()
    .configureOutput({ writeErr: () => {} });
  command.addOption(
    new Option("--sender-private-key <key>")
      .env("SENDER_PRIVATE_KEY")
      .argParser(PrivateKey.fromBase58),
  );
  addTransactionSignerOptions(command, [{ role: "sender", label: "Sender" }]);
  command.action(() => {});
  command.parse(args, { from: "user" });
  return command.opts();
}

test("Commander requires the options for the selected signer", () => {
  const publicKey = PrivateKey.random().toPublicKey().toBase58();
  assert.throws(
    () => parseSigningOptions(["--signer", "ledger"]),
    /--sender-public-key is required/,
  );
  assert.throws(
    () =>
      parseSigningOptions([
        "--signer",
        "ledger",
        "--sender-public-key",
        publicKey,
      ]),
    /--sender-ledger-account-index is required/,
  );
  assert.throws(
    () => parseSigningOptions([]),
    /--sender-private-key is required/,
  );
  assert.throws(
    () => parseSigningOptions(["--signer", "other"]),
    /Allowed choices/,
  );
});

test("Commander validates the full UInt32 account-index range", () => {
  const args = [
    "--signer",
    "ledger",
    "--sender-public-key",
    PrivateKey.random().toPublicKey().toBase58(),
    "--sender-ledger-account-index",
  ];
  for (const index of ["-1", "1.5", "4294967296", "abc", ""]) {
    assert.throws(() => parseSigningOptions([...args, index]), /integer/);
  }
  assert.equal(
    parseSigningOptions([...args, "4294967295"]).senderLedgerAccountIndex,
    0xffff_ffff,
  );
});

test("one Ledger index cannot identify two public keys", () => {
  const first = resolveSigningAccount({
    signer: "ledger",
    label: "Sender",
    publicKey: PrivateKey.random().toPublicKey(),
    ledgerAccountIndex: 7,
  });
  const second = resolveSigningAccount({
    signer: "ledger",
    label: "Proposal",
    publicKey: PrivateKey.random().toPublicKey(),
    ledgerAccountIndex: 7,
  });
  assert.throws(
    () => createTransactionSigner([first, second], "devnet"),
    /cannot identify both/u,
  );
});

test("in-memory mode derives the public key and creates a signer", () => {
  const privateKey = PrivateKey.random();
  const account = resolveSigningAccount({
    signer: "in-memory",
    label: "Sender",
    privateKey,
  });
  assert.equal(
    account.publicKey.toBase58(),
    privateKey.toPublicKey().toBase58(),
  );
  assert.equal(typeof createTransactionSigner([account]), "function");
});

test("multi-transaction deployment selects only the indices required by each transaction", () => {
  const sender = PrivateKey.random().toPublicKey().toBase58();
  const pauseController = PrivateKey.random().toPublicKey().toBase58();
  const treasuryOwner = PrivateKey.random().toPublicKey().toBase58();
  const configured = new Map([
    [sender, 1],
    [pauseController, 2],
    [treasuryOwner, 3],
  ]);
  const transaction = (contractPublicKey: string) => ({
    toJSON: () =>
      JSON.stringify({
        feePayer: { body: { publicKey: sender } },
        accountUpdates: [
          {
            body: {
              publicKey: contractPublicKey,
              authorizationKind: { isSigned: true },
            },
          },
        ],
      }),
  });

  assert.deepEqual(
    [
      ...selectTransactionLedgerAccountIndices(
        transaction(pauseController),
        configured,
      ),
    ],
    [
      [sender, 1],
      [pauseController, 2],
    ],
  );
  assert.deepEqual(
    [
      ...selectTransactionLedgerAccountIndices(
        transaction(treasuryOwner),
        configured,
      ),
    ],
    [
      [sender, 1],
      [treasuryOwner, 3],
    ],
  );
});

test("Ledger signing rejects a missing contract account index", () => {
  const sender = PrivateKey.random().toPublicKey().toBase58();
  const proposal = PrivateKey.random().toPublicKey().toBase58();
  const transaction = {
    toJSON: () =>
      JSON.stringify({
        feePayer: { body: { publicKey: sender } },
        accountUpdates: [
          {
            body: {
              publicKey: proposal,
              authorizationKind: { isSigned: true },
            },
          },
        ],
      }),
  };

  assert.throws(
    () =>
      selectTransactionLedgerAccountIndices(
        transaction,
        new Map([[sender, 4]]),
      ),
    /Ledger account index is required/,
  );
});

test("signing modes cannot be combined", () => {
  const privateKey = PrivateKey.random();
  const publicKey = privateKey.toPublicKey();
  assert.throws(
    () =>
      parseSigningOptions([
        "--signer",
        "ledger",
        "--sender-private-key",
        privateKey.toBase58(),
      ]),
    /cannot be used/,
  );
  assert.throws(
    () =>
      parseSigningOptions([
        "--sender-private-key",
        privateKey.toBase58(),
        "--sender-ledger-account-index",
        "0",
      ]),
    /cannot be used/,
  );
  const memory = resolveSigningAccount({
    signer: "in-memory",
    label: "Sender",
    privateKey,
  });
  const ledger = resolveSigningAccount({
    signer: "ledger",
    label: "Contract",
    publicKey,
    ledgerAccountIndex: 0,
  });
  assert.throws(() => createTransactionSigner([memory, ledger]), /same signer/);
  assert.throws(() => createTransactionSigner([]), /same signer/);
});

test("Commander rejects Ledger public keys in in-memory mode", () => {
  assert.throws(
    () =>
      parseSigningOptions([
        "--sender-public-key",
        PrivateKey.random().toPublicKey().toBase58(),
      ]),
    /cannot be used/,
  );
});

test("Commander checks conflicts from environment variables", () => {
  const previous = process.env.SENDER_PRIVATE_KEY;
  process.env.SENDER_PRIVATE_KEY = PrivateKey.random().toBase58();
  try {
    assert.throws(
      () =>
        parseSigningOptions([
          "--signer",
          "ledger",
          "--sender-public-key",
          PrivateKey.random().toPublicKey().toBase58(),
          "--sender-ledger-account-index",
          "0",
        ]),
      /cannot be used/,
    );
  } finally {
    if (previous === undefined) delete process.env.SENDER_PRIVATE_KEY;
    else process.env.SENDER_PRIVATE_KEY = previous;
  }
});

test("one Ledger public key cannot use two indices", () => {
  const publicKey = PrivateKey.random().toPublicKey();
  const accounts = [0, 1].map((ledgerAccountIndex) =>
    resolveSigningAccount({
      signer: "ledger",
      label: "Sender",
      publicKey,
      ledgerAccountIndex,
    }),
  );
  assert.throws(() => createTransactionSigner(accounts), /cannot use both/);
});

test("in-memory signing logs its hash, requires all keys, and ignores proof-only accounts", async (t) => {
  const sender = PrivateKey.random();
  const contract = PrivateKey.random();
  const proofAccount = PrivateKey.random();
  const local = await Mina.LocalBlockchain({ proofsEnabled: false });
  Mina.setActiveInstance(local);
  local.addAccount(sender.toPublicKey(), "100000000000");
  const unsigned = await Mina.transaction(sender.toPublicKey(), async () => {
    AccountUpdate.createSigned(contract.toPublicKey());
    AccountUpdate.create(proofAccount.toPublicKey());
  });
  const hash = await Transaction.hash(unsigned.toJSON());
  const logs: string[] = [];
  t.mock.method(console, "error", (message: string) => logs.push(message));
  const transaction = {
    toJSON: () => unsigned.toJSON(),
    sign(keys: PrivateKey[]) {
      assert.equal(
        logs.at(-2),
        `[signing] Transaction ID before signing: ${hash}`,
      );
      assert.match(logs.at(-1)!, /Waiting for signatures/);
      assert.deepEqual(keys, [sender, contract]);
      return { send: async () => ({ hash: "signed" }) };
    },
  };
  const accounts = [sender, contract].map((privateKey) =>
    resolveSigningAccount({
      signer: "in-memory",
      label: "Account",
      privateKey,
    }),
  );
  await assert.rejects(
    createTransactionSigner([accounts[0]])(transaction),
    /Private key is required/,
  );
  const signed = await createTransactionSigner(accounts)(transaction);
  assert.equal((await signed.send()).hash, "signed");
});
