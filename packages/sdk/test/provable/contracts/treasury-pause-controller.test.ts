import { it } from "node:test";
import {
  AccountUpdate,
  fetchAccount,
  Field,
  Mina,
  Poseidon,
  PrivateKey,
  Provable,
  PublicKey,
  UInt64,
} from "o1js";
import { TreasuryPauseControllerSmartContract } from "../../../src/provable/contracts/treasury-pause-controller.js";
import { equal } from "node:assert";

const proofsEnabled = process.env.PROOFS_ENABLED === "true";
const Local = await Mina.LocalBlockchain({ proofsEnabled });
Mina.setActiveInstance(Local);

const deployer = Local.testAccounts[0];
const deployerPublicKey = deployer.key.toPublicKey();
const pauseControllerPrivateKey = PrivateKey.random();
const pauseControllerPublicKey = pauseControllerPrivateKey.toPublicKey();

const multisigPrivateKey1 = PrivateKey.random();
const multisigPublicKey1 = multisigPrivateKey1.toPublicKey();
const multisigPrivateKey2 = PrivateKey.random();
const multisigPublicKey2 = multisigPrivateKey2.toPublicKey();
const multisigPrivateKey3 = PrivateKey.random();
const multisigPublicKey3 = multisigPrivateKey3.toPublicKey();
const multisigPrivateKey4 = PrivateKey.random();
const multisigPublicKey4 = multisigPrivateKey4.toPublicKey();
const multisigPrivateKey5 = PrivateKey.random();
const multisigPublicKey5 = multisigPrivateKey5.toPublicKey();

const multisigSigners: [PrivateKey, PublicKey][] = [
  [multisigPrivateKey1, multisigPublicKey1],
  [multisigPrivateKey2, multisigPublicKey2],
  [multisigPrivateKey3, multisigPublicKey3],
  [multisigPrivateKey4, multisigPublicKey4],
  [multisigPrivateKey5, multisigPublicKey5],
]

const multiSigCommitment = Poseidon.hash([
  ...[multisigPublicKey1, multisigPublicKey2, multisigPublicKey3, multisigPublicKey4, multisigPublicKey5].flatMap(
    (participant) => participant.toFields()
  ),
]);

it('should compile', async () => {
  await TreasuryPauseControllerSmartContract.compile();
})

it('should deploy', async () => {
  const pauseController = new TreasuryPauseControllerSmartContract(
    pauseControllerPublicKey
  );

  TreasuryPauseControllerSmartContract.multisigCommitment = multiSigCommitment

  const tx = await Mina.transaction(
    { sender: deployerPublicKey, fee: UInt64.from(1 * 10 ** 9) },
    async () => {
      AccountUpdate.fundNewAccount(deployerPublicKey, 1);
      await pauseController.deploy();
    }
  );

  tx.sign([deployer.key, pauseControllerPrivateKey]);
  await tx.prove();
  const pendingTx = await tx.send();
  await pendingTx.wait();

  const multisigCommitment = await pauseController.multisigCommitment.fetch();
  equal(multisigCommitment.toBigInt(), multiSigCommitment.toBigInt(), "Multisig commitment mismatch");
});