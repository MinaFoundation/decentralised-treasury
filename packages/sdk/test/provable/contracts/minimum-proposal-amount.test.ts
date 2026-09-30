import { createTreasurySnapshot, applyTreasurySnapshot } from "../../utils/treasury-snapshot.js";
import assert from "node:assert/strict";
import { it } from "node:test";
import {
  AccountUpdate,
  Field,
  Mina,
  PrivateKey,
  UInt32,
  UInt64,
  VerificationKey,
  ZkappUri,
} from "o1js";
import { TreasuryOwnerSmartContract } from "../../../src/provable/contracts/treasury-owner.js";
import { TreasuryProposalSmartContract } from "../../../src/provable/contracts/treasury-proposal/treasury-proposal.js";
import { TreasuryPauseControllerSmartContract } from "../../../src/provable/contracts/treasury-pause-controller/treasury-pause-controller.js";

it("enforces the proposal minimum through the Owner with the selected proof mode", async () => {
  const proofsEnabled = process.env.PROOFS_ENABLED === "true";
  const local = await Mina.LocalBlockchain({ proofsEnabled });
  Mina.setActiveInstance(local);
  const payer = local.testAccounts[0]!;
  const ownerKey = PrivateKey.random();
  const pauseKey = PrivateKey.random();
  const owner = new TreasuryOwnerSmartContract(ownerKey.toPublicKey());
  const pause = new TreasuryPauseControllerSmartContract(
    pauseKey.toPublicKey(),
  );

  // Creation does not verify vote proofs. Their keys are unused in this test.
  TreasuryProposalSmartContract.voteReducerVerificationKey =
    VerificationKey.dummySync();
  TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey =
    VerificationKey.dummySync();
  TreasuryProposalSmartContract.emptyNullifierRoot = Field(0);
  TreasuryProposalSmartContract.emptyVotingLedgerRoot = Field(0);
  TreasuryPauseControllerSmartContract.multisigParticipants = local.testAccounts
    .slice(0, 5)
    .map((account) => account.key.toPublicKey());
  TreasuryOwnerSmartContract.treasuryDeployedAtSlot = UInt32.from(0);
  TreasuryOwnerSmartContract.pauseControllerPublicKey = pause.address;
  await TreasuryProposalSmartContract.compile();
  await TreasuryPauseControllerSmartContract.compile();
  await TreasuryOwnerSmartContract.compile();

  const deploy = await Mina.transaction(payer, async () => {
    AccountUpdate.fundNewAccount(payer, 2);
    await pause.deploy();
    await owner.deploy();
  });
  await deploy.prove();
  await deploy.sign([payer.key, ownerKey, pauseKey]).send();

  const snapshot = await createTreasurySnapshot(owner.address);
  applyTreasurySnapshot(local, snapshot);

  for (const amount of [9_999_999_999n, 10_000_000_000n, 10_000_000_010n]) {
    const proposalKey = PrivateKey.random();
    const build = () =>
      Mina.transaction(payer, async () => {
        AccountUpdate.fundNewAccount(payer, 1);
        AccountUpdate.createSigned(payer).balance.subInPlace(
          UInt64.from(amount / 10n),
        );
        await owner.createProposal(
          proposalKey.toPublicKey(),
          {
            amount: UInt64.from(amount),
            recipient: local.testAccounts[1]!.key.toPublicKey(),
            zkAppUri: ZkappUri.from("https://example.com/minimum-proposal"),
          },
          UInt32.from(0),
          snapshot.treasuryOwnerAccount,
          snapshot.treasuryOwnerAccountWitness,
        );
      });
    if (amount < 10_000_000_000n) {
      await assert.rejects(build, /Proposal amount must be at least 10 MINA/);
      assert.equal(
        Mina.hasAccount(proposalKey.toPublicKey(), owner.deriveTokenId()),
        false,
      );
      continue;
    }
    const before = local.getAccount(owner.address).balance.toBigInt();
    const transaction = await build();
    await transaction.prove();
    if (proofsEnabled) {
      const updates = JSON.parse(transaction.toJSON()).accountUpdates;
      assert(
        updates.some(
          (update: { authorization: { proof?: string } }) =>
            update.authorization.proof,
        ),
      );
    }
    await transaction.sign([payer.key, proposalKey]).send();
    assert.equal(
      local.getAccount(owner.address).balance.toBigInt(),
      before + amount / 10n,
    );
  }
});
