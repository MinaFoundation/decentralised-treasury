import {
  Bool,
  Field,
  method,
  Permissions,
  Poseidon,
  Provable,
  PublicKey,
  Signature,
  SmartContract,
  state,
  State,
  Struct,
  UInt32,
} from "o1js";
import { hashWithPrefix } from "../hashing-helpers.js";

export const MULTISIG_PARTICIPANTS_COUNT = 5;
export const MIN_VALID_MULTISIG_SIGNATURES_COUNT = 3;

// Mina Foundation Decentralized Treasury
export const multisigPrefix = "MFDT";
export class MultisigSignature extends Signature {
  public static prefixTogglePauseProposal = `${multisigPrefix}tpp`;

  public static prefixPauseTreasury = `${multisigPrefix}pt`;
  public static prefixUnpauseTreasury = `${multisigPrefix}upt`;

  public static prefixRotateMultisigKeys = `${multisigPrefix}rmk`;

  public static dataTogglePauseProposal(
    proposalPublicKey: PublicKey,
    nonce: UInt32,
  ) {
    return hashWithPrefix(this.prefixTogglePauseProposal, [
      ...proposalPublicKey.toFields(),
      ...nonce.toFields(),
    ]);
  }

  public static dataPauseTreasury(nonce: UInt32) {
    return hashWithPrefix(this.prefixPauseTreasury, [...nonce.toFields()]);
  }

  public static dataUnpauseTreasury(nonce: UInt32) {
    return hashWithPrefix(this.prefixUnpauseTreasury, [...nonce.toFields()]);
  }

  public static dataRotateMultisigKeys(
    multisigCommitment: Field,
    nonce: UInt32,
  ) {
    return hashWithPrefix(this.prefixRotateMultisigKeys, [
      multisigCommitment,
      ...nonce.toFields(),
    ]);
  }
}

export class MultisigSignatures extends Struct({
  signatures: Provable.Array(MultisigSignature, MULTISIG_PARTICIPANTS_COUNT),
}) {}

export class TreasuryPauseControllerSmartContract extends SmartContract {
  public static multisigParticipants: PublicKey[] = [];
  public static multisigCommitment: Field;

  // hash of multisig addresses
  @state(Field) multisigCommitment = State<Field>();
  @state(Bool) paused = State<Bool>();

  public init() {
    super.init();
    this.account.permissions.set({
      ...Permissions.default(),
      incrementNonce: Permissions.proof(),
    });

    this.multisigCommitment.set(
      TreasuryPauseControllerSmartContract.multisigCommitment,
    );
  }

  @method
  public async verifyMultisigSignatures(
    data: Field,
    { signatures }: MultisigSignatures,
  ) {
    const multiSigCommitment = this.multisigCommitment.getAndRequireEquals();
    const multisigParticipants = Provable.witness(
      Provable.Array(PublicKey, MULTISIG_PARTICIPANTS_COUNT),
      () => {
        return TreasuryPauseControllerSmartContract.multisigParticipants;
      },
    );

    const signaturesValid = signatures.map((signature, i) => {
      return signature.verify(multisigParticipants[i], [data]);
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
      .assertTrue("Not enough valid signatures");

    const currentMultiSigCommitment = Poseidon.hash([
      ...multisigParticipants.flatMap((participant) => participant.toFields()),
    ]);

    currentMultiSigCommitment
      .equals(multiSigCommitment)
      .assertTrue("Invalid multisig commitment");
  }

  public async requireAndIncrementNonce(nonce: UInt32) {
    this.account.nonce.requireEquals(nonce);
    this.self.body.incrementNonce = Bool(true);
  }

  // @method
  public async rotateMultisigKeys(
    multisigCommitment: Field,
    nonce: UInt32,
    signatures: MultisigSignatures,
  ) {
    const data = MultisigSignature.dataRotateMultisigKeys(
      multisigCommitment,
      nonce,
    );
    await this.verifyMultisigSignatures(data, signatures);
    await this.requireAndIncrementNonce(nonce);
    this.multisigCommitment.set(multisigCommitment);
  }

  @method
  public async requireNotPaused() {
    this.paused.getAndRequireEquals().assertFalse("Treasury is paused");
  }

  @method
  public async pauseTreasury(signatures: MultisigSignatures, nonce: UInt32) {
    const data = MultisigSignature.dataPauseTreasury(nonce);
    await this.verifyMultisigSignatures(data, signatures);

    await this.requireAndIncrementNonce(nonce);
    this.paused.set(Bool(true));
  }

  @method
  public async unpauseTreasury(signatures: MultisigSignatures, nonce: UInt32) {
    const data = MultisigSignature.dataUnpauseTreasury(nonce);
    await this.verifyMultisigSignatures(data, signatures);

    await this.requireAndIncrementNonce(nonce);
    this.paused.set(Bool(false));
  }

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
    await this.verifyMultisigSignatures(data, signatures);

    await this.requireAndIncrementNonce(nonce);
  }
}
