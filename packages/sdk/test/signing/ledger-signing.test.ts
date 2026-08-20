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
    async getAddress() {
      return { returnCode: "9000", publicKey: publicKey.toBase58() };
    },
    async signFieldElement(_account, networkId, bytes) {
      assert.equal(networkId, 1);
      const signature = signatures.get(fieldFromBytes(bytes).toString());
      assert(signature, "expected a prepared mainnet signature");
      const json = signature.toJSON();
      return { returnCode: "9000", field: json.r, scalar: json.s };
    },
  };

  const result = await signTransactionWithLedgerClient(transaction, ledger);
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
    async getAddress() {
      return { returnCode: "9000", publicKey: publicKey.toBase58() };
    },
    async signFieldElement(_account, networkId, bytes) {
      assert.equal(networkId, 1);
      const signature = Signature.create(privateKey, [fieldFromBytes(bytes)]);
      const json = signature.toJSON();
      return { returnCode: "9000", field: json.r, scalar: json.s };
    },
  };

  await assert.rejects(
    signTransactionWithLedgerClient(transaction, ledger),
    /invalid signature/,
  );
});
