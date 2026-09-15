import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountUpdate,
  Field,
  Mina,
  PrivateKey,
  Signature,
  UInt32,
} from "o1js";
import { SqlitePauseControllerService } from "@repo/sdk/src/services/sqlite/sqlite-pause-controller-service.js";
import { TreasuryPauseControllerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.js";
import {
  MultisigSignature,
  MultisigSignatures,
} from "@repo/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import {
  signFieldWithLedgerClient,
  signTransactionWithLedgerClient,
  type LedgerSigningClient,
} from "@repo/sdk/src/signing/ledger-signing.js";
import {
  createTransactionSigner,
  resolveSigningAccount,
} from "../src/ledger/transaction-signer.js";

for (const signer of ["in-memory", "ledger"] as const) {
  test(`${signer} pause service signs pause, unpause, and key rotation`, async (t) => {
    const local = await Mina.LocalBlockchain({ proofsEnabled: false });
    Mina.setActiveInstance(local);
    const payer = local.testAccounts[0];
    const controller = PrivateKey.random();
    const participants = Array.from({ length: 5 }, () => PrivateKey.random());
    const keys = [payer.key, controller, ...participants];
    const ledger: LedgerSigningClient = {
      async getAddress(index) {
        return {
          returnCode: "9000",
          publicKey: keys[index]!.toPublicKey().toBase58(),
        };
      },
      async signFieldElement(index, network, bytes) {
        assert.equal(network, 0);
        const field = Field(
          bytes.reduceRight((n, b) => (n << 8n) + BigInt(b), 0n),
        );
        const signature = Signature.create(keys[index]!, [field]).toJSON();
        return { returnCode: "9000", field: signature.r, scalar: signature.s };
      },
    };
    const transactionSigner = createTransactionSigner(
      keys.map((key, index) =>
        resolveSigningAccount({
          signer,
          label: `Account ${index}`,
          ...(signer === "ledger"
            ? { publicKey: key.toPublicKey(), ledgerAccountIndex: index }
            : { privateKey: key }),
        }),
      ),
      "devnet",
      (tx, indices) =>
        signTransactionWithLedgerClient(tx, ledger, indices, "devnet"),
    );
    const signaturesFor = async (field: Field) =>
      new MultisigSignatures({
        signatures: await Promise.all(
          participants.map((key, index) =>
            signer === "ledger"
              ? signFieldWithLedgerClient(
                  field,
                  ledger,
                  key.toPublicKey(),
                  index + 2,
                )
              : Promise.resolve(Signature.create(key, [field])),
          ),
        ),
      });
    const service = new SqlitePauseControllerService();
    await service.compile({ proofsEnabled: false });
    const options = {
      minaNodeUrl: "unused",
      senderPublicKey: payer,
      pauseControllerPublicKey: controller.toPublicKey(),
      multisigParticipantsPublicKeys: participants.map((key) =>
        key.toPublicKey(),
      ),
      transactionSigner,
    };
    try {
      await service.deploy(options);
      const extra = await Mina.transaction(payer, async () => {
        AccountUpdate.createSigned(payer).send({
          to: local.testAccounts[1],
          amount: 1,
        });
      });
      await (await (await transactionSigner(extra)).send()).wait?.();
      const nonce = () => local.getAccount(controller.toPublicKey()).nonce;
      const feePayerNonce = () =>
        Number(local.getAccount(payer).nonce.toBigint());
      const controllerNonce = () => Number(nonce().toBigint());
      assert.notEqual(feePayerNonce(), controllerNonce());
      const contract = new TreasuryPauseControllerSmartContract(
        controller.toPublicKey(),
      );
      await t.test(
        "pause with a separately resolved controller nonce",
        async () => {
          await service.pauseTreasury({
            ...options,
            signatures: await signaturesFor(
              MultisigSignature.dataPauseTreasury(nonce()),
            ),
          });
          assert.equal(contract.paused.get().toBoolean(), true);
        },
      );
      await t.test("unpause with an explicit fee-payer nonce", async () => {
        await service.unpauseTreasury({
          ...options,
          nonce: feePayerNonce(),
          signatures: await signaturesFor(
            MultisigSignature.dataUnpauseTreasury(nonce()),
          ),
        });
        assert.equal(contract.paused.get().toBoolean(), false);
      });
      await t.test(
        "pause with an explicit fee-payer nonce and an automatic controller nonce",
        async () => {
          await service.pauseTreasury({
            ...options,
            signatures: await signaturesFor(
              MultisigSignature.dataPauseTreasury(nonce()),
            ),
            nonce: feePayerNonce(),
          });
        },
      );
      await t.test(
        "unpause with only an explicit controller nonce",
        async () => {
          const expectedNonce = controllerNonce();
          const result = await service.unpauseTreasury({
            ...options,
            controllerNonce: expectedNonce,
            signatures: await signaturesFor(
              MultisigSignature.dataUnpauseTreasury(nonce()),
            ),
          });
          assert.equal(result.nonce, String(expectedNonce));
          assert.equal(contract.paused.get().toBoolean(), false);
        },
      );
      await t.test("pause with two independent explicit nonces", async () => {
        const expectedNonce = controllerNonce();
        const expectedFeePayerNonce = feePayerNonce();
        assert.notEqual(expectedFeePayerNonce, expectedNonce);
        const result = await service.pauseTreasury({
          ...options,
          nonce: expectedFeePayerNonce,
          controllerNonce: expectedNonce,
          signatures: await signaturesFor(
            MultisigSignature.dataPauseTreasury(nonce()),
          ),
        });
        assert.equal(result.nonce, String(expectedNonce));
        assert.equal(controllerNonce(), expectedNonce + 1);
        assert.equal(feePayerNonce(), expectedFeePayerNonce + 1);
        assert.equal(contract.paused.get().toBoolean(), true);
      });
      await t.test("reject a stale explicit controller nonce", async () => {
        const expectedNonce = controllerNonce();
        const expectedFeePayerNonce = feePayerNonce();
        const staleNonce = expectedNonce - 1;
        const signatures = await signaturesFor(
          MultisigSignature.dataUnpauseTreasury(UInt32.from(staleNonce)),
        );
        await assert.rejects(
          () =>
            service.unpauseTreasury({
              ...options,
              nonce: expectedFeePayerNonce,
              controllerNonce: staleNonce,
              signatures,
            }),
          /nonce|precondition/i,
        );
        assert.equal(controllerNonce(), expectedNonce);
        // An included transaction can consume the fee-payer nonce when its updates fail.
        assert.equal(feePayerNonce(), expectedFeePayerNonce + 1);
        assert.equal(contract.paused.get().toBoolean(), true);
      });
      await t.test(
        "rotate the participant keys with separate explicit nonces",
        async () => {
          const next = Array.from({ length: 5 }, () =>
            PrivateKey.random().toPublicKey(),
          );
          const oldCommitment = MultisigSignatures.createCommitment(
            options.multisigParticipantsPublicKeys,
          );
          const newCommitment = MultisigSignatures.createCommitment(next);
          await service.rotateMultisigKeys({
            ...options,
            nonce: feePayerNonce(),
            controllerNonce: controllerNonce(),
            currentMultisigParticipantsPublicKeys:
              options.multisigParticipantsPublicKeys,
            newMultisigParticipantsPublicKeys: next,
            signatures: await signaturesFor(
              MultisigSignature.dataRotateMultisigKeys(
                oldCommitment,
                newCommitment,
                nonce(),
              ),
            ),
          });
          assert.equal(
            contract.multisigCommitment.get().toString(),
            newCommitment.toString(),
          );
        },
      );
    } finally {
      TreasuryPauseControllerSmartContract.multisigParticipants = [];
    }
  });
}
