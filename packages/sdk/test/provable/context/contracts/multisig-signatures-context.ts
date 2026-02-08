import { Field, PrivateKey, PublicKey } from "o1js";
import {
  MULTISIG_PARTICIPANTS_COUNT,
  MultisigSignature,
  MultisigSignatures,
} from "../../../../src/provable/contracts/treasury-pause-controller/multisig-signatures.js";

export interface MultisigParticipant {
  privateKey: PrivateKey;
  publicKey: PublicKey;
}

export function createMultisigSignaturesTestContext() {
  let participants: MultisigParticipant[] = [];
  let commitment: Field | null = null;

  const generateParticipants = (
    count = MULTISIG_PARTICIPANTS_COUNT,
  ): MultisigParticipant[] => {
    participants = Array.from({ length: count }, () => {
      const privateKey = PrivateKey.random();
      return { privateKey, publicKey: privateKey.toPublicKey() };
    });
    return participants;
  };

  const createCommitment = (
    providedParticipants: MultisigParticipant[] = participants,
  ) => {
    commitment = MultisigSignatures.createCommitment(
      providedParticipants.map(({ publicKey }) => publicKey),
    );
    return commitment;
  };

  const createSignatures = (
    data: Field,
    validCount = participants.length,
    providedParticipants: MultisigParticipant[] = participants,
  ) => {
    const signatures = Array.from(
      { length: MULTISIG_PARTICIPANTS_COUNT },
      (_, i) => {
        const participant = providedParticipants[i];
        if (participant && i < validCount) {
          return MultisigSignature.create(participant.privateKey, [data]);
        }
        return MultisigSignature.empty();
      },
    );

    return new MultisigSignatures({ signatures });
  };

  return {
    generateParticipants,
    createCommitment,
    createSignatures,
    getParticipants: () => participants,
    getPublicKeys: () => participants.map(({ publicKey }) => publicKey),
    getPrivateKeys: () => participants.map(({ privateKey }) => privateKey),
    getCommitment: () => commitment,
  };
}
