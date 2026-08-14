import {
  Field,
  Poseidon,
  Provable,
  PublicKey,
  Signature,
  Struct,
  UInt32,
} from "o1js";
import { hashWithPrefix } from "../../hashing-helpers.js";

export const MultisigSignaturesErrors = {
  NOT_ENOUGH_VALID_SIGNATURES: "Not enough valid signatures",
  INVALID_MULTISIG_COMMITMENT: "Invalid multisig commitment",
} as const;

// total number of multisig participants
export const MULTISIG_PARTICIPANTS_COUNT = 5;
// minimum number of valid signatures required
export const MIN_VALID_MULTISIG_SIGNATURES_COUNT = 3;

// prefix namespace for multisig message hashes
export const multisigPrefix = "MFDT";

/**
 * Signature utilities for multisig actions.
 */
export class MultisigSignature extends Signature {
  // hash prefix for toggle pause proposal
  public static prefixTogglePauseProposal = `${multisigPrefix}tpp`;

  // hash prefix for pause treasury
  public static prefixPauseTreasury = `${multisigPrefix}pt`;
  // hash prefix for unpause treasury
  public static prefixUnpauseTreasury = `${multisigPrefix}upt`;

  // hash prefix for rotating multisig keys
  public static prefixRotateMultisigKeys = `${multisigPrefix}rmk`;

  /**
   * Build the message hash for toggling a proposal pause state.
   *
   * @param proposalPublicKey - Proposal public key to scope the toggle.
   * @param nonce - Expected account nonce for this transaction.
   */
  public static dataTogglePauseProposal(
    proposalPublicKey: PublicKey,
    nonce: UInt32,
  ) {
    return hashWithPrefix(this.prefixTogglePauseProposal, [
      ...proposalPublicKey.toFields(),
      ...nonce.toFields(),
    ]);
  }

  /**
   * Build the message hash for pausing the treasury.
   *
   * @param nonce - Expected account nonce for this transaction.
   */
  public static dataPauseTreasury(nonce: UInt32) {
    return hashWithPrefix(this.prefixPauseTreasury, [...nonce.toFields()]);
  }

  /**
   * Build the message hash for unpausing the treasury.
   *
   * @param nonce - Expected account nonce for this transaction.
   */
  public static dataUnpauseTreasury(nonce: UInt32) {
    return hashWithPrefix(this.prefixUnpauseTreasury, [...nonce.toFields()]);
  }

  /**
   * Build the message hash for rotating multisig keys.
   *
   * @param oldMultisigCommitment - Current multisig commitment.
   * @param newMultisigCommitment - Next multisig commitment.
   * @param nonce - Expected account nonce for this transaction.
   */
  public static dataRotateMultisigKeys(
    oldMultisigCommitment: Field,
    newMultisigCommitment: Field,
    nonce: UInt32,
  ) {
    return hashWithPrefix(this.prefixRotateMultisigKeys, [
      oldMultisigCommitment,
      newMultisigCommitment,
      ...nonce.toFields(),
    ]);
  }
}

/**
 * Multisig signature set with verification helpers.
 */
export class MultisigSignatures extends Struct({
  signatures: Provable.Array(MultisigSignature, MULTISIG_PARTICIPANTS_COUNT),
}) {
  /**
   * Create a commitment hash for a participant list.
   *
   * @param multisigParticipants - Public keys in participant order.
   */
  public static createCommitment(multisigParticipants: PublicKey[]) {
    return Poseidon.hash([
      ...multisigParticipants.flatMap((participant) => participant.toFields()),
    ]);
  }

  /**
   * Verify signatures against a data hash and commitment.
   *
   * @param data - Message hash that was signed.
   * @param multisigCommitment - Expected commitment for participants.
   * @param multisigParticipants - Public keys aligned with signatures.
   */
  public async verify(
    data: Field,
    multisigCommitment: Field,
    multisigParticipants: PublicKey[],
  ) {
    const currentMultiSigCommitment =
      MultisigSignatures.createCommitment(multisigParticipants);

    currentMultiSigCommitment
      .equals(multisigCommitment)
      .assertTrue(MultisigSignaturesErrors.INVALID_MULTISIG_COMMITMENT);

    const signaturesValid = this.signatures.map((signature, i) => {
      // non-null: both arrays are fixed at MULTISIG_PARTICIPANTS_COUNT length.
      return signature.verify(multisigParticipants[i]!, [data]);
    });

    const validSignaturesCount = signaturesValid.reduce(
      (signaturesValid, isValid) =>
        signaturesValid.add(
          Provable.if(isValid, UInt32.from(1), UInt32.from(0)),
        ),
      UInt32.from(0),
    );

    validSignaturesCount
      .greaterThanOrEqual(UInt32.from(MIN_VALID_MULTISIG_SIGNATURES_COUNT))
      .assertTrue(MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES);
  }
}
