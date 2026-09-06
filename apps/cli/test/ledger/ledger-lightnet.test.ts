import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountUpdate,
  fetchAccount,
  Field,
  Lightnet,
  Mina,
  PrivateKey,
  PublicKey,
  Signature,
  UInt32,
  UInt64,
} from "o1js";
import {
  signFieldWithLedgerClient,
  signTransactionWithLedgerClient,
  type LedgerSigningClient,
} from "@repo/sdk/src/signing/ledger-signing.js";
import { MultisigSignature } from "@repo/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import {
  createLedgerTransactionSigner,
  resolveSigningAccount,
} from "../../src/ledger/transaction-signer.js";

const MINA_NODE_URL =
  process.env.MINA_NODE_URL ?? "http://127.0.0.1:8080/graphql";
const LIGHTNET_ACCOUNT_MANAGER_ENDPOINT =
  process.env.LIGHTNET_ACCOUNT_MANAGER_ENDPOINT ?? "http://127.0.0.1:8181";
const ACCOUNT_INDEX = Number(process.env.LEDGER_ACCOUNT_INDEX ?? "17");

if (!Number.isSafeInteger(ACCOUNT_INDEX) || ACCOUNT_INDEX < 0) {
  throw new Error("LEDGER_ACCOUNT_INDEX must be a non-negative integer");
}

function softwareLedger(
  accountIndex: number,
  privateKey: PrivateKey,
): LedgerSigningClient {
  return {
    async getAddress(requestedIndex) {
      assert.equal(
        requestedIndex,
        accountIndex,
        "Ledger address lookup must use the configured account index",
      );
      return {
        returnCode: "9000",
        publicKey: privateKey.toPublicKey().toBase58(),
      };
    },
    async signFieldElement(requestedIndex, networkId, bytes) {
      assert.equal(
        requestedIndex,
        accountIndex,
        "Ledger signing must use the configured account index",
      );
      assert.equal(networkId, 0, "Lightnet must use the Ledger testnet ID");
      const value = [...bytes].reduceRight(
        (result, byte) => (result << 8n) + BigInt(byte),
        0n,
      );
      const signature = Signature.create(privateKey, [Field(value)]).toJSON();
      return {
        returnCode: "9000",
        field: signature.r,
        scalar: signature.s,
      };
    },
  };
}

test(
  "software Ledger signs a real Lightnet payment with its explicit account index",
  { timeout: 300_000 },
  async () => {
    Mina.setActiveInstance(
      Mina.Network({
        mina: MINA_NODE_URL,
        networkId: "devnet",
        lightnetAccountManager: LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
      }),
    );

    const keyPair = await Lightnet.acquireKeyPair({
      lightnetAccountManagerEndpoint: LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
    });
    const sender = keyPair.publicKey;
    const recipient = PrivateKey.random().toPublicKey();
    const ledger = softwareLedger(ACCOUNT_INDEX, keyPair.privateKey);

    try {
      const transaction = await Mina.transaction(
        {
          sender,
          fee: UInt64.from(100_000_000),
          memo: `Ledger index ${ACCOUNT_INDEX} Lightnet test`,
        },
        async () => {
          AccountUpdate.fundNewAccount(sender);
          const payment = AccountUpdate.createSigned(sender);
          payment.send({ to: recipient, amount: UInt64.from(2_000_000_000) });
        },
      );

      const signingAccount = resolveSigningAccount({
        signer: "ledger",
        label: "Lightnet sender",
        publicKey: sender,
        ledgerAccountIndex: ACCOUNT_INDEX,
      });
      const transactionSigner = createLedgerTransactionSigner(
        "ledger",
        [signingAccount],
        "devnet",
        async (unsignedTransaction, accountIndices, networkId) =>
          await signTransactionWithLedgerClient(
            unsignedTransaction,
            ledger,
            accountIndices,
            networkId,
          ),
      );
      assert(transactionSigner);
      const signedTransaction = await transactionSigner(transaction);
      const pendingTransaction = (await signedTransaction.send()) as Awaited<
        ReturnType<typeof transaction.send>
      >;
      const includedTransaction = await pendingTransaction.safeWait();
      if (includedTransaction.status === "rejected") {
        assert.fail(
          `Lightnet rejected the Ledger transaction: ${JSON.stringify(includedTransaction.errors)}`,
        );
      }

      const { account: recipientAccount, error } = await fetchAccount({
        publicKey: recipient,
      });
      assert.equal(error, undefined);
      assert(recipientAccount);
      assert.equal(recipientAccount.balance.toBigInt(), 2_000_000_000n);

      const breakGlassField = MultisigSignature.dataPauseTreasury(
        UInt32.from(7),
      );
      const breakGlassSignature = await signFieldWithLedgerClient(
        breakGlassField,
        ledger,
        PublicKey.fromBase58(sender.toBase58()),
        ACCOUNT_INDEX,
      );
      assert.equal(
        breakGlassSignature.verify(sender, [breakGlassField]).toBoolean(),
        true,
      );

      console.log(
        `Lightnet included Ledger transaction ${pendingTransaction.hash}; accountIndex=${ACCOUNT_INDEX}; recipientBalance=${recipientAccount.balance.toString()}; break-glass signature valid`,
      );
    } finally {
      await Lightnet.releaseKeyPair({
        publicKey: sender.toBase58(),
        lightnetAccountManagerEndpoint: LIGHTNET_ACCOUNT_MANAGER_ENDPOINT,
      });
    }
  },
);
