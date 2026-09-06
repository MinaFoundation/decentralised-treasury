import assert from "node:assert/strict";
import test from "node:test";
import { PrivateKey } from "o1js";
import {
  createLedgerTransactionSigner,
  resolveSigningAccount,
  selectTransactionLedgerAccountIndices,
} from "../src/ledger/transaction-signer.js";

test("Ledger mode requires an explicit public key and account index", () => {
  const publicKey = PrivateKey.random().toPublicKey();
  assert.throws(
    () =>
      resolveSigningAccount({
        signer: "ledger",
        label: "Sender",
        ledgerAccountIndex: 0,
      }),
    /public key is required/u,
  );
  assert.throws(
    () =>
      resolveSigningAccount({
        signer: "ledger",
        label: "Sender",
        publicKey,
      }),
    /account index is required/u,
  );
});

test("Ledger mode validates the full UInt32 account-index range", () => {
  const publicKey = PrivateKey.random().toPublicKey();
  for (const ledgerAccountIndex of [-1, 1.5, 0x1_0000_0000]) {
    assert.throws(
      () =>
        resolveSigningAccount({
          signer: "ledger",
          label: "Sender",
          publicKey,
          ledgerAccountIndex,
        }),
      /integer from 0 through 4294967295/u,
    );
  }
  assert.equal(
    resolveSigningAccount({
      signer: "ledger",
      label: "Sender",
      publicKey,
      ledgerAccountIndex: 0xffff_ffff,
    }).ledgerAccountIndex,
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
    () => createLedgerTransactionSigner("ledger", [first, second], "devnet"),
    /cannot identify both/u,
  );
});

test("in-memory mode derives the public key and does not create a Ledger signer", () => {
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
  assert.equal(
    createLedgerTransactionSigner("in-memory", [account]),
    undefined,
  );
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

test("in-memory signers do not require Ledger account indices", () => {
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

  assert.deepEqual(
    [
      ...selectTransactionLedgerAccountIndices(
        transaction,
        new Map([[sender, 4]]),
        new Set([proposal]),
      ),
    ],
    [[sender, 4]],
  );
});
