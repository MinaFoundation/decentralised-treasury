import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountUpdate,
  Mina,
  Permissions,
  PrivateKey,
  UInt32,
  UInt64,
} from "o1js";
import { TreasuryOwnerSmartContract } from "../../src/provable/contracts/treasury-owner.js";
import { SqliteTreasuryOwnerService } from "../../src/services/sqlite/sqlite-treasury-owner-service.js";

type LocalTransaction = Awaited<ReturnType<typeof Mina.transaction>>;
type AccountPermission = ReturnType<typeof Permissions.proof>;

function assertPermissionEqual(
  actual: AccountPermission,
  expected: AccountPermission,
): void {
  assert.equal(actual.constant.toBoolean(), expected.constant.toBoolean());
  assert.equal(
    actual.signatureNecessary.toBoolean(),
    expected.signatureNecessary.toBoolean(),
  );
  assert.equal(
    actual.signatureSufficient.toBoolean(),
    expected.signatureSufficient.toBoolean(),
  );
}

async function submit(
  transaction: LocalTransaction,
  privateKeys: PrivateKey[],
): Promise<void> {
  await transaction.prove();
  const pendingTransaction = await transaction.sign(privateKeys).send();
  await pendingTransaction.wait();
}

test("a default Treasury Owner requires proof authorization for withdrawals", async () => {
  const blockchain = await Mina.LocalBlockchain({ proofsEnabled: false });
  Mina.setActiveInstance(blockchain);

  const feePayer = blockchain.testAccounts[0];
  const recipient = blockchain.testAccounts[1];
  const treasuryOwnerPrivateKey = PrivateKey.random();
  const treasuryOwnerPublicKey = treasuryOwnerPrivateKey.toPublicKey();
  const treasuryOwner = new TreasuryOwnerSmartContract(treasuryOwnerPublicKey);
  const treasuryBalance = UInt64.from(5_000_000_000);

  TreasuryOwnerSmartContract.treasuryDeployedAtSlot = UInt32.from(0);
  TreasuryOwnerSmartContract.pauseControllerPublicKey =
    PrivateKey.random().toPublicKey();

  const deployTransaction = await Mina.transaction(feePayer, async () => {
    AccountUpdate.fundNewAccount(feePayer, 1);
    await treasuryOwner.deploy();
  });
  await submit(deployTransaction, [feePayer.key, treasuryOwnerPrivateKey]);

  const permissions = blockchain.getAccount(treasuryOwnerPublicKey).permissions;
  assertPermissionEqual(permissions.access, Permissions.proof());
  assertPermissionEqual(permissions.send, Permissions.proof());

  const fundingTransaction = await Mina.transaction(feePayer, async () => {
    const fundingAccountUpdate = AccountUpdate.createSigned(feePayer);
    fundingAccountUpdate.balance.subInPlace(treasuryBalance);
    await treasuryOwner.receive(treasuryBalance);
  });
  await submit(fundingTransaction, [feePayer.key]);

  const treasuryBalanceBefore = blockchain.getAccount(
    treasuryOwnerPublicKey,
  ).balance;
  const service = new SqliteTreasuryOwnerService();
  await assert.rejects(
    service.emergencyWithdraw({
      minaNodeUrl: "http://127.0.0.1:8080/graphql",
      senderPrivateKey: feePayer.key,
      treasuryOwnerPrivateKey,
      recipientPublicKey: recipient,
      amount: UInt64.from(1_000_000_000),
    }),
    /does not permit an emergency signature withdrawal/iu,
  );
  assert.equal(
    blockchain.getAccount(treasuryOwnerPublicKey).balance.toBigInt(),
    treasuryBalanceBefore.toBigInt(),
  );
});

test("an opted-in Treasury Owner supports a signature-authorized emergency withdrawal", async () => {
  const blockchain = await Mina.LocalBlockchain({ proofsEnabled: false });
  Mina.setActiveInstance(blockchain);

  const feePayer = blockchain.testAccounts[0];
  const recipient = blockchain.testAccounts[1];
  const treasuryOwnerPrivateKey = PrivateKey.random();
  const treasuryOwnerPublicKey = treasuryOwnerPrivateKey.toPublicKey();
  const treasuryOwner = new TreasuryOwnerSmartContract(treasuryOwnerPublicKey);
  const treasuryBalance = UInt64.from(20_000_000_000);
  const withdrawalAmount = UInt64.from(3_000_000_000);

  TreasuryOwnerSmartContract.treasuryDeployedAtSlot = UInt32.from(0);
  TreasuryOwnerSmartContract.pauseControllerPublicKey =
    PrivateKey.random().toPublicKey();

  const deployTransaction = await Mina.transaction(feePayer, async () => {
    AccountUpdate.fundNewAccount(feePayer, 1);
    await treasuryOwner.deployWithWithdrawalPermission("proofOrSignature");
  });
  await submit(deployTransaction, [feePayer.key, treasuryOwnerPrivateKey]);

  const permissions = blockchain.getAccount(treasuryOwnerPublicKey).permissions;
  assertPermissionEqual(permissions.access, Permissions.proofOrSignature());
  assertPermissionEqual(permissions.send, Permissions.proofOrSignature());
  assertPermissionEqual(permissions.editState, Permissions.proof());
  assertPermissionEqual(permissions.receive, Permissions.proof());

  const fundingTransaction = await Mina.transaction(feePayer, async () => {
    const fundingAccountUpdate = AccountUpdate.createSigned(feePayer);
    fundingAccountUpdate.balance.subInPlace(treasuryBalance);
    await treasuryOwner.receive(treasuryBalance);
  });
  await submit(fundingTransaction, [feePayer.key]);

  const unsignedWithdrawal = await Mina.transaction(feePayer, async () => {
    const treasuryOwnerAccountUpdate = AccountUpdate.createSigned(
      treasuryOwnerPublicKey,
    );
    treasuryOwnerAccountUpdate.send({
      to: recipient,
      amount: withdrawalAmount,
    });
  });
  unsignedWithdrawal.sign([feePayer.key]);
  await assert.rejects(
    async () => unsignedWithdrawal.send(),
    /signature|authorization|verify/iu,
  );

  const treasuryBalanceBefore = blockchain.getAccount(
    treasuryOwnerPublicKey,
  ).balance;
  const recipientBalanceBefore = blockchain.getAccount(recipient).balance;
  const service = new SqliteTreasuryOwnerService();
  const result = await service.emergencyWithdraw({
    minaNodeUrl: "http://127.0.0.1:8080/graphql",
    senderPrivateKey: feePayer.key,
    treasuryOwnerPrivateKey,
    recipientPublicKey: recipient,
    amount: withdrawalAmount,
  });

  assert.equal(result.authorization, "treasury-owner-signature");
  assert.equal(result.sender, feePayer.toBase58());
  assert.equal(result.from, treasuryOwnerPublicKey.toBase58());
  assert.equal(result.to, recipient.toBase58());
  assert.equal(result.amount, withdrawalAmount.toString());
  assert.ok(result.emergencyWithdrawalTxHash);
  assert.equal(
    blockchain.getAccount(treasuryOwnerPublicKey).balance.toBigInt(),
    treasuryBalanceBefore.sub(withdrawalAmount).toBigInt(),
  );
  assert.equal(
    blockchain.getAccount(recipient).balance.toBigInt(),
    recipientBalanceBefore.add(withdrawalAmount).toBigInt(),
  );
});

test("an external signer authorizes an opted-in emergency withdrawal without a proof", async () => {
  const blockchain = await Mina.LocalBlockchain({ proofsEnabled: false });
  Mina.setActiveInstance(blockchain);

  const feePayer = blockchain.testAccounts[0];
  const recipient = blockchain.testAccounts[1];
  const treasuryOwnerPrivateKey = PrivateKey.random();
  const treasuryOwnerPublicKey = treasuryOwnerPrivateKey.toPublicKey();
  const treasuryOwner = new TreasuryOwnerSmartContract(treasuryOwnerPublicKey);
  const treasuryBalance = UInt64.from(5_000_000_000);
  const withdrawalAmount = UInt64.from(1_000_000_000);

  TreasuryOwnerSmartContract.treasuryDeployedAtSlot = UInt32.from(0);
  TreasuryOwnerSmartContract.pauseControllerPublicKey =
    PrivateKey.random().toPublicKey();

  const deployTransaction = await Mina.transaction(feePayer, async () => {
    AccountUpdate.fundNewAccount(feePayer, 1);
    await treasuryOwner.deployWithWithdrawalPermission("proofOrSignature");
  });
  await submit(deployTransaction, [feePayer.key, treasuryOwnerPrivateKey]);

  const fundingTransaction = await Mina.transaction(feePayer, async () => {
    const fundingAccountUpdate = AccountUpdate.createSigned(feePayer);
    fundingAccountUpdate.balance.subInPlace(treasuryBalance);
    await treasuryOwner.receive(treasuryBalance);
  });
  await submit(fundingTransaction, [feePayer.key]);

  let signerCalled = false;
  const service = new SqliteTreasuryOwnerService();
  const result = await service.emergencyWithdraw({
    minaNodeUrl: "http://127.0.0.1:8080/graphql",
    senderPublicKey: feePayer,
    treasuryOwnerPublicKey,
    recipientPublicKey: recipient,
    amount: withdrawalAmount,
    transactionSigner: async (transaction) => {
      signerCalled = true;
      const json = JSON.parse(transaction.toJSON()) as {
        accountUpdates: Array<{
          body: {
            publicKey: string;
            authorizationKind: {
              isSigned: boolean;
              isProved: boolean;
            };
          };
        }>;
      };
      const treasuryOwnerUpdates = json.accountUpdates.filter(
        (update) => update.body.publicKey === treasuryOwnerPublicKey.toBase58(),
      );
      assert.equal(treasuryOwnerUpdates.length, 1);
      assert.equal(
        treasuryOwnerUpdates[0]?.body.authorizationKind.isSigned,
        true,
      );
      assert.equal(
        treasuryOwnerUpdates[0]?.body.authorizationKind.isProved,
        false,
      );

      return (transaction as LocalTransaction).sign([
        feePayer.key,
        treasuryOwnerPrivateKey,
      ]);
    },
  });

  assert.equal(signerCalled, true);
  assert.equal(result.authorization, "treasury-owner-signature");
  assert.ok(result.emergencyWithdrawalTxHash);
});
