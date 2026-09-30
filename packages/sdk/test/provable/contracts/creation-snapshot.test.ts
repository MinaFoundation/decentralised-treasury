import assert from "node:assert/strict";
import { it } from "node:test";
import {
  AccountUpdate,
  Field,
  Mina,
  PrivateKey,
  UInt32,
  UInt64,
  ZkappUri,
} from "o1js";
import { Account } from "../../../src/provable/account.js";
import {
  compileAuthorizationContracts,
  createOwnerDeploymentFixture,
} from "../../assurance/contracts/helpers.js";

it("rejects unusable Owner snapshots before creation and accepts a positive default-token member", async () => {
  assert.notEqual(
    process.env.PROOFS_ENABLED,
    "true",
    "This test is proof-off only",
  );
  Mina.setActiveInstance(await Mina.LocalBlockchain({ proofsEnabled: false }));
  await compileAuthorizationContracts(false);
  const fixture = await createOwnerDeploymentFixture();
  const {
    blockchain,
    owner,
    feePayer,
    treasuryOwnerAccount,
    treasuryOwnerAccountWitness,
    root,
  } = fixture;
  const snapshotState = blockchain.getNetworkState();
  const clone = () => Account.fromJSON(Account.toJSON(treasuryOwnerAccount));
  const wrongKey = clone();
  wrongKey.pk = PrivateKey.random().toPublicKey();
  const wrongToken = clone();
  wrongToken.tokenId = Field(9);
  const zeroBalance = clone();
  zeroBalance.balance = UInt64.zero;
  for (const [account, rootValue, error] of [
    [wrongKey, root, /public key does not match/],
    [wrongToken, root, /token id does not match/],
    [zeroBalance, root, /snapshot balance must be positive/],
    [
      treasuryOwnerAccount,
      Field(0),
      /witness does not match staking ledger hash/,
    ],
  ] as const) {
    blockchain.setNetworkState({
      ...snapshotState,
      stakingEpochData: {
        ...snapshotState.stakingEpochData,
        ledger: { ...snapshotState.stakingEpochData.ledger, hash: rootValue },
      },
    });
    const proposalKey = PrivateKey.random();
    const balanceBefore = blockchain
      .getAccount(owner.address)
      .balance.toBigInt();
    await assert.rejects(
      () =>
        Mina.transaction(feePayer, async () => {
          AccountUpdate.fundNewAccount(feePayer, 1);
          AccountUpdate.createSigned(feePayer).balance.subInPlace(
            UInt64.from(1_000_000_000),
          );
          await owner.createProposal(
            proposalKey.toPublicKey(),
            {
              amount: UInt64.from(10_000_000_000),
              recipient: feePayer,
              zkAppUri: ZkappUri.from("https://example.com/snapshot"),
            },
            UInt32.from(0),
            account,
            treasuryOwnerAccountWitness,
          );
        }),
      error,
    );
    assert.equal(
      Mina.hasAccount(proposalKey.toPublicKey(), owner.deriveTokenId()),
      false,
    );
    assert.equal(
      blockchain.getAccount(owner.address).balance.toBigInt(),
      balanceBefore,
    );
  }
  blockchain.setNetworkState(snapshotState);
  const proposalKey = PrivateKey.random();
  const transaction = await Mina.transaction(feePayer, async () => {
    AccountUpdate.fundNewAccount(feePayer, 1);
    AccountUpdate.createSigned(feePayer).balance.subInPlace(
      UInt64.from(1_000_000_000),
    );
    await owner.createProposal(
      proposalKey.toPublicKey(),
      {
        amount: UInt64.from(10_000_000_000),
        recipient: feePayer,
        zkAppUri: ZkappUri.from("https://example.com/snapshot"),
      },
      UInt32.from(0),
      treasuryOwnerAccount,
      treasuryOwnerAccountWitness,
    );
  });
  await transaction.prove();
  await transaction.sign([feePayer.key, proposalKey]).send();
  assert.equal(
    Mina.hasAccount(proposalKey.toPublicKey(), owner.deriveTokenId()),
    true,
  );
  // Creation records the exact root, including when the live Owner balance is zero.
  assert.equal(
    blockchain
      .getAccount(proposalKey.toPublicKey(), owner.deriveTokenId())
      .zkapp!.appState[3]!.toString(),
    root.toString(),
  );
});
