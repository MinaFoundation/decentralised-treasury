import assert from "node:assert/strict";
import test from "node:test";
import { Client as MinaSignerClient } from "mina-signer";
import {
  AccountUpdate,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  Signature,
  UInt64,
} from "o1js";
import {
  type LedgerSigningClient,
  signTransactionWithLedgerClient,
} from "../../src/signing/ledger-signing.js";

function fieldFromBytes(bytes: Uint8Array): Field {
  const value = [...bytes].reduceRight(
    (result, byte) => (result << 8n) + BigInt(byte),
    0n,
  );
  return Field(value);
}

async function createSignedMainnetTransaction(privateKey: PrivateKey) {
  const local = await Mina.LocalBlockchain({ proofsEnabled: false });
  Mina.setActiveInstance(local);
  const publicKey = privateKey.toPublicKey();
  local.addAccount(publicKey, "100000000000");
  const transaction = await Mina.transaction(
    {
      sender: publicKey,
      fee: UInt64.from(100_000_000),
    },
    async () => {
      AccountUpdate.createSigned(publicKey);
    },
  );

  Mina.setActiveInstance(
    Mina.Network({
      mina: "http://127.0.0.1:1/graphql",
      networkId: "mainnet",
    }),
  );
  transaction.sign([privateKey]);
  return transaction;
}

test("accepts valid mainnet Ledger field signatures", async () => {
  const privateKey = PrivateKey.random();
  const publicKey = privateKey.toPublicKey();
  const transaction = await createSignedMainnetTransaction(privateKey);
  const signedCommand = JSON.parse(transaction.toJSON()) as {
    feePayer: {
      body: { publicKey: string };
      authorization: string;
    };
    accountUpdates: Array<{
      body: { useFullCommitment: boolean };
      authorization: { signature?: string };
    }>;
  };
  const minaSigner = new MinaSignerClient({ network: "mainnet", era: "mesa" });
  const commitments = minaSigner.getZkappCommandCommitmentsFromJSON(
    signedCommand as never,
  );
  const signatures = new Map<string, Signature>();
  signatures.set(
    commitments.fullCommitment.toString(),
    Signature.fromBase58(signedCommand.feePayer.authorization),
  );
  for (const update of signedCommand.accountUpdates) {
    if (!update.authorization.signature) continue;
    const commitment = update.body.useFullCommitment
      ? commitments.fullCommitment
      : commitments.commitment;
    signatures.set(
      commitment.toString(),
      Signature.fromBase58(update.authorization.signature),
    );
  }

  const ledger: LedgerSigningClient = {
    async getAddress(accountIndex) {
      assert.equal(accountIndex, 7);
      return { returnCode: "9000", publicKey: publicKey.toBase58() };
    },
    async signFieldElement(accountIndex, networkId, bytes) {
      assert.equal(accountIndex, 7);
      assert.equal(networkId, 1);
      const signature = signatures.get(fieldFromBytes(bytes).toString());
      assert(signature, "expected a prepared mainnet signature");
      const json = signature.toJSON();
      return { returnCode: "9000", field: json.r, scalar: json.s };
    },
  };

  const result = await signTransactionWithLedgerClient(
    transaction,
    ledger,
    new Map([[publicKey.toBase58(), 7]]),
  );
  assert.equal(
    JSON.parse(result.toJSON()).feePayer.authorization,
    signedCommand.feePayer.authorization,
  );
});

test("rejects a testnet-domain signature for a mainnet transaction", async () => {
  const privateKey = PrivateKey.random();
  const publicKey: PublicKey = privateKey.toPublicKey();
  const transaction = await createSignedMainnetTransaction(privateKey);
  const ledger: LedgerSigningClient = {
    async getAddress(accountIndex) {
      assert.equal(accountIndex, 9);
      return { returnCode: "9000", publicKey: publicKey.toBase58() };
    },
    async signFieldElement(accountIndex, networkId, bytes) {
      assert.equal(accountIndex, 9);
      assert.equal(networkId, 1);
      const signature = Signature.create(privateKey, [fieldFromBytes(bytes)]);
      const json = signature.toJSON();
      return { returnCode: "9000", field: json.r, scalar: json.s };
    },
  };

  await assert.rejects(
    signTransactionWithLedgerClient(
      transaction,
      ledger,
      new Map([[publicKey.toBase58(), 9]]),
    ),
    /invalid signature/,
  );
});

test("rejects a Ledger index that returns another public key", async () => {
  const privateKey = PrivateKey.random();
  const publicKey = privateKey.toPublicKey();
  const transaction = await createSignedMainnetTransaction(privateKey);
  const ledger: LedgerSigningClient = {
    async getAddress(accountIndex) {
      assert.equal(accountIndex, 4);
      return {
        returnCode: "9000",
        publicKey: PrivateKey.random().toPublicKey().toBase58(),
      };
    },
    async signFieldElement() {
      throw new Error("must not sign with a mismatched account index");
    },
  };

  await assert.rejects(
    signTransactionWithLedgerClient(
      transaction,
      ledger,
      new Map([[publicKey.toBase58(), 4]]),
    ),
    /returned .* expected/,
  );
});

test("preserves signatures owned by another signing provider", async () => {
  const feePayerKey = PrivateKey.random();
  const otherSignerKey = PrivateKey.random();
  const local = await Mina.LocalBlockchain({ proofsEnabled: false });
  Mina.setActiveInstance(local);
  local.addAccount(feePayerKey.toPublicKey(), "100000000000");
  local.addAccount(otherSignerKey.toPublicKey(), "100000000000");
  const transaction = await Mina.transaction(
    { sender: feePayerKey.toPublicKey(), fee: UInt64.from(100_000_000) },
    async () => {
      AccountUpdate.createSigned(otherSignerKey.toPublicKey());
    },
  );
  Mina.setActiveInstance(
    Mina.Network({
      mina: "http://127.0.0.1:1/graphql",
      networkId: "devnet",
    }),
  );
  transaction.sign([feePayerKey, otherSignerKey]);
  const original = JSON.parse(transaction.toJSON()) as {
    feePayer: { authorization: string };
    accountUpdates: Array<{ authorization: { signature?: string } }>;
  };
  const feePayerSignature = Signature.fromBase58(
    original.feePayer.authorization,
  );
  const ledger: LedgerSigningClient = {
    async getAddress(accountIndex) {
      assert.equal(accountIndex, 5);
      return {
        returnCode: "9000",
        publicKey: feePayerKey.toPublicKey().toBase58(),
      };
    },
    async signFieldElement() {
      const json = feePayerSignature.toJSON();
      return { returnCode: "9000", field: json.r, scalar: json.s };
    },
  };

  const signed = await signTransactionWithLedgerClient(
    transaction,
    ledger,
    new Map([[feePayerKey.toPublicKey().toBase58(), 5]]),
  );
  const result = JSON.parse(signed.toJSON()) as typeof original;

  assert.equal(
    result.accountUpdates[0]?.authorization.signature,
    original.accountUpdates[0]?.authorization.signature,
  );
});

test("requires the Ledger signer map to contain the fee payer", async () => {
  const privateKey = PrivateKey.random();
  const transaction = await createSignedMainnetTransaction(privateKey);
  await assert.rejects(
    signTransactionWithLedgerClient(
      transaction,
      {
        async getAddress() {
          throw new Error("must not open Ledger");
        },
        async signFieldElement() {
          throw new Error("must not sign");
        },
      },
      new Map(),
    ),
    /required for fee payer/,
  );
});
