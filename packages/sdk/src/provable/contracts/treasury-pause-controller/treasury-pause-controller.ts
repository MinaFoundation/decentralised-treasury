import {
  Bool,
  Field,
  method,
  Permissions,
  Provable,
  PublicKey,
  SmartContract,
  state,
  State,
  UInt32,
} from "o1js";
import { provableLog } from "../../../logging/logger.js";
import {
  MULTISIG_PARTICIPANTS_COUNT,
  MultisigSignature,
  MultisigSignatures,
} from "./multisig-signatures.js";

export const TreasuryPauseControllerErrors = {
  NOT_ENOUGH_PARTICIPANTS: "Not enough multisig participants",
  TREASURY_PAUSED: "Treasury is paused",
} as const;

/**
 * Pause controller for treasury actions guarded by multisig signatures.
 * Maintains a commitment to the current multisig participants and a pause flag
 */
export class TreasuryPauseControllerSmartContract extends SmartContract {
  /**
   * Off-chain participants used to build the on-chain commitment.
   * These are supplied out-of-circuit and witnessed during signature checks.
   */
  public static multisigParticipants: PublicKey[] = [];

  /**
   * Lock down the account to proof-only permissions.
   * The verification key cannot be changed during the current protocol version,
   * only after a new protocol version is (hardfork) live.
   */
  public static permissions = {
    ...Permissions.allImpossible(),
    editState: Permissions.proof(),
    access: Permissions.proof(),
    incrementNonce: Permissions.proof(),
    setVerificationKey:
      Permissions.VerificationKey.impossibleDuringCurrentVersion(),
  };

  // on-chain commitment to multisig participants.
  @state(Field) multisigCommitment = State<Field>();
  // treasury pause flag.
  @state(Bool) paused = State<Bool>();

  /**
   * Initialize with the multisig commitment and default paused state.
   */
  public async init() {
    super.init();
    this.account.permissions.set(
      TreasuryPauseControllerSmartContract.permissions,
    );

    if (
      TreasuryPauseControllerSmartContract.multisigParticipants.length <
      MULTISIG_PARTICIPANTS_COUNT
    ) {
      throw new Error(
        `${TreasuryPauseControllerErrors.NOT_ENOUGH_PARTICIPANTS}: ${TreasuryPauseControllerSmartContract.multisigParticipants.length} < ${MULTISIG_PARTICIPANTS_COUNT}`,
      );
    }

    const multisigCommitment = MultisigSignatures.createCommitment(
      TreasuryPauseControllerSmartContract.multisigParticipants,
    );

    provableLog("Treasury pause controller initializing with", {
      multisigCommitment,
      multisigParticipants:
        TreasuryPauseControllerSmartContract.multisigParticipants,
    });

    this.multisigCommitment.set(multisigCommitment);
    this.paused.set(Bool(false));
  }

  /**
   * Require the current nonce and increment it for the tx.
   *
   * @param nonce - Expected account nonce for this transaction.
   */
  public async requireAndIncrementNonce(nonce: UInt32) {
    this.account.nonce.requireEquals(nonce);
    this.self.body.incrementNonce = Bool(true);
  }

  /**
   * Verify signatures against the current commitment.
   *
   * @param signatures - Multisig signatures to verify.
   * @param data - Message hash that was signed.
   */
  public async verifySignatures(signatures: MultisigSignatures, data: Field) {
    const currentCommitment = this.multisigCommitment.getAndRequireEquals();
    const multisigParticipants = Provable.witness(
      Provable.Array(PublicKey, MULTISIG_PARTICIPANTS_COUNT),
      () => {
        const multisigParticipants =
          TreasuryPauseControllerSmartContract.multisigParticipants;
        if (multisigParticipants.length !== MULTISIG_PARTICIPANTS_COUNT) {
          throw new Error(
            `${TreasuryPauseControllerErrors.NOT_ENOUGH_PARTICIPANTS}: expected ${MULTISIG_PARTICIPANTS_COUNT}, got ${multisigParticipants.length}`,
          );
        }
        return multisigParticipants;
      },
    );
    await signatures.verify(data, currentCommitment, multisigParticipants);
  }

  /**
   * Rotate multisig participants by setting a new commitment.
   * The signed payload includes both the current and next commitment so that
   * signatures are bound to the exact rotation.
   *
   * @param multisigCommitment - New commitment for the next participant set.
   * @param nonce - Expected account nonce for this transaction.
   * @param signatures - Multisig signatures authorizing the rotation.
   */
  @method
  public async rotateMultisigKeys(
    multisigCommitment: Field,
    nonce: UInt32,
    signatures: MultisigSignatures,
  ) {
    const currentCommitment = this.multisigCommitment.getAndRequireEquals();
    const data = MultisigSignature.dataRotateMultisigKeys(
      currentCommitment,
      multisigCommitment,
      nonce,
    );
    await this.verifySignatures(signatures, data);
    await this.requireAndIncrementNonce(nonce);
    this.multisigCommitment.set(multisigCommitment);
  }

  /**
   * Ensure the treasury is not paused.
   * Use this as a guard in methods that must be disabled while paused.
   *
   * This method works by issuing an account update with a precondition
   * on the paused state (false) that must be satisfied on-chain.
   *
   * Intended to be cross-called by other smart contracts to ensure the treasury is not paused.
   */
  @method
  public async requireNotPaused() {
    this.paused
      .getAndRequireEquals()
      .assertFalse(TreasuryPauseControllerErrors.TREASURY_PAUSED);
  }

  /**
   * Mark
   * Requires valid multisig signatures for the pause intent.
   *
   * @param signatures - Multisig signatures authorizing the pause.
   * @param nonce - Expected account nonce for this transaction.
   */
  @method
  public async pauseTreasury(signatures: MultisigSignatures, nonce: UInt32) {
    const data = MultisigSignature.dataPauseTreasury(nonce);
    await this.verifySignatures(signatures, data);

    await this.requireAndIncrementNonce(nonce);
    this.paused.set(Bool(true));
  }

  /**
   * Unpause treasury actions.
   * Requires valid multisig signatures for the unpause intent.
   *
   * @param signatures - Multisig signatures authorizing the unpause.
   * @param nonce - Expected account nonce for this transaction.
   */
  @method
  public async unpauseTreasury(signatures: MultisigSignatures, nonce: UInt32) {
    const data = MultisigSignature.dataUnpauseTreasury(nonce);
    await this.verifySignatures(signatures, data);

    await this.requireAndIncrementNonce(nonce);
    this.paused.set(Bool(false));
  }

  /**
   * Toggle pause state for a specific proposal (validated by multisig).
   * This does not mutate contract state directly; it only enforces authorization.
   *
   * @param proposalPublicKey - Proposal public key whose pause flag is toggled.
   * @param signatures - Multisig signatures authorizing the toggle.
   * @param nonce - Expected account nonce for this transaction.
   */
  @method
  public async togglePauseProposal(
    proposalPublicKey: PublicKey,
    signatures: MultisigSignatures,
    nonce: UInt32,
  ) {
    const data = MultisigSignature.dataTogglePauseProposal(
      proposalPublicKey,
      nonce,
    );
    await this.verifySignatures(signatures, data);

    await this.requireAndIncrementNonce(nonce);
  }
}
