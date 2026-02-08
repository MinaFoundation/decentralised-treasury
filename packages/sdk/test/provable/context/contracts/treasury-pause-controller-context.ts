import {
  AccountUpdate,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  UInt32,
  UInt64,
} from "o1js";
import { TreasuryPauseControllerSmartContract } from "../../../../src/provable/contracts/treasury-pause-controller/treasury-pause-controller.js";
import { MultisigSignature } from "../../../../src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import {
  createMultisigSignaturesTestContext,
  MultisigParticipant,
} from "./multisig-signatures-context.js";

export function createPauseControllerTestContext() {
  const privateKey = PrivateKey.random();
  const publicKey = privateKey.toPublicKey();
  const contract = new TreasuryPauseControllerSmartContract(publicKey);
  const multisigContext = createMultisigSignaturesTestContext();

  const compile = async (
    options?: Parameters<
      typeof TreasuryPauseControllerSmartContract.compile
    >[0],
  ) => {
    return await TreasuryPauseControllerSmartContract.compile(options);
  };

  const deploy = async (
    feePayer: { key: PrivateKey },
    fee = UInt64.from(1 * 10 ** 9),
  ) => {
    const tx = await Mina.transaction(
      { sender: feePayer.key.toPublicKey(), fee },
      async () => {
        AccountUpdate.fundNewAccount(feePayer.key.toPublicKey(), 1);
        await contract.deploy();
      },
    );

    tx.sign([feePayer.key, privateKey]);
    await tx.prove();
    const pendingTx = await tx.send();
    await pendingTx.wait();

    return { privateKey, publicKey, contract };
  };

  const createPauseTreasurySignatures = (
    nonce: UInt32,
    validCount = multisigContext.getParticipants().length,
  ) => {
    const data = MultisigSignature.dataPauseTreasury(nonce);
    return multisigContext.createSignatures(data, validCount);
  };

  const createUnpauseTreasurySignatures = (
    nonce: UInt32,
    validCount = multisigContext.getParticipants().length,
  ) => {
    const data = MultisigSignature.dataUnpauseTreasury(nonce);
    return multisigContext.createSignatures(data, validCount);
  };

  const createTogglePauseProposalSignatures = (
    proposalPublicKey: PublicKey,
    nonce: UInt32,
    validCount = multisigContext.getParticipants().length,
  ) => {
    const data = MultisigSignature.dataTogglePauseProposal(
      proposalPublicKey,
      nonce,
    );
    return multisigContext.createSignatures(data, validCount);
  };

  const createRotateMultisigKeysSignatures = (
    oldCommitment: Field,
    newCommitment: Field,
    nonce: UInt32,
    validCount = multisigContext.getParticipants().length,
  ) => {
    const data = MultisigSignature.dataRotateMultisigKeys(
      oldCommitment,
      newCommitment,
      nonce,
    );
    return multisigContext.createSignatures(data, validCount);
  };

  const getPaused = async () => {
    return await contract.paused.fetch();
  };

  const getNonce = (blockchain: Mina.LocalBlockchain) => {
    return blockchain.getAccount(publicKey).nonce;
  };

  return {
    compile,
    deploy,
    generateMultisigParticipants: multisigContext.generateParticipants,
    getMultisigParticipants: () => {
      return {
        participants: multisigContext.getParticipants(),
        publicKeys: multisigContext.getPublicKeys(),
        privateKeys: multisigContext.getPrivateKeys(),
      };
    },
    createPauseTreasurySignatures,
    createUnpauseTreasurySignatures,
    createTogglePauseProposalSignatures,
    createRotateMultisigKeysSignatures,
    getPaused,
    getNonce,
    privateKey,
    publicKey,
    contract,
  };
}
