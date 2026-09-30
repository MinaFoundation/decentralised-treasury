import assert from "node:assert/strict";
import test from "node:test";
import { Mina, PrivateKey, UInt32 } from "o1js";
import { SqliteTreasuryOwnerService } from "../../src/services/sqlite/sqlite-treasury-owner-service.js";
import { createInMemoryTransactionSigner } from "../../src/services/transaction-signing.js";

test("Owner deployment requires a fresh account, including legacy SDK options", async () => {
  const local = await Mina.LocalBlockchain({ proofsEnabled: false });
  Mina.setActiveInstance(local);
  const sender = local.testAccounts[0];
  const service = new SqliteTreasuryOwnerService();

  for (const existing of [false, true]) {
    const owner = PrivateKey.random();
    const controller = PrivateKey.random();
    if (existing) local.addAccount(owner.toPublicKey(), "1000000000");
    const sign = createInMemoryTransactionSigner([
      sender.key,
      owner,
      controller,
    ]);
    let checkedOwnerPrecondition = false;
    // JavaScript callers can still supply removed properties at runtime.
    const options = {
      minaNodeUrl: "unused",
      senderPublicKey: sender,
      treasuryOwnerPublicKey: owner.toPublicKey(),
      pauseControllerPublicKey: controller.toPublicKey(),
      treasuryDeployedAtSlot: UInt32.from(0),
      multisigParticipantsPublicKeys: Array.from({ length: 5 }, () =>
        PrivateKey.random().toPublicKey(),
      ),
      allowDeployToExistingAccount: true,
      transactionSigner: (async (transaction) => {
        const command = JSON.parse(transaction.toJSON()) as {
          accountUpdates: Array<{
            body: {
              publicKey: string;
              preconditions: { account: { isNew: boolean | null } };
            };
          }>;
        };
        const update = command.accountUpdates.find(
          (update) => update.body.publicKey === owner.toPublicKey().toBase58(),
        );
        if (update) {
          const isNew = update.body.preconditions.account.isNew;
          assert.equal(isNew, true);
          checkedOwnerPrecondition = true;
        }
        return sign(transaction);
      }) satisfies typeof sign,
    };

    if (existing) {
      await assert.rejects(
        service.deploy(options),
        /Account_is_new_precondition_unsatisfied/,
      );
      assert.equal(
        local.getAccount(owner.toPublicKey()).balance.toBigInt(),
        1_000_000_000n,
      );
    } else {
      await service.deploy(options);
      assert.equal(local.hasAccount(owner.toPublicKey()), true);
    }
    assert.equal(checkedOwnerPrecondition, true);
  }
});
