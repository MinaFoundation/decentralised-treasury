import {
  AccountUpdate,
  AccountUpdateForest,
  Bool,
  Field,
  Permissions,
  Poseidon,
  Provable,
  PublicKey,
  Signature,
  State,
  Struct,
  TokenContract,
  UInt32,
  UInt64,
  method,
  state,
} from "o1js";
import {
  SideLoadedVoteReducerProof,
  Vote,
} from "./treasury-proposal/vote-reducer.js";
import { TreasuryProposalSmartContract } from "./treasury-proposal/treasury-proposal.js";
import { SideLoadedStakingLedgerToVotingLedgerProof } from "../staking-ledger-to-voting-ledger.js";
import { hashWithPrefix } from "../hashing-helpers.js";
import { Proposal } from "./treasury-proposal/treasury-proposal.js";

// 7140 slots = ~2 weeks, this is the mainnet configuration
export const LIFECYCLE_PERIOD_DURATION = UInt32.from(7140);
export const MULTISIG_PARTICIPANTS_COUNT = 5;
export const MIN_VALID_MULTISIG_SIGNATURES_COUNT = 3;
export const BOND_AMOUNT_DIVISOR = 10;

export class LifecyclePeriod extends UInt32 {
  // doubles as execution period too
  public static PROPOSAL = new LifecyclePeriod(0);
  public static EXPLORATION = new LifecyclePeriod(1);
  public static VOTING = new LifecyclePeriod(2);
  public static COOLDOWN = new LifecyclePeriod(3);

  public static NUMBER_OF_PERIODS = UInt32.from(4);
}

// Mina Foundation Decentralized Treasury
export const multisigPrefix = "MFDT";
export class MultisigSignature extends Signature {
  public static prefixPauseProposal = `${multisigPrefix}pp`;
  public static prefixUnpauseProposal = `${multisigPrefix}upp`;

  public static prefixPauseTreasury = `${multisigPrefix}pt`;
  public static prefixUnpauseTreasury = `${multisigPrefix}upt`;

  public static prefixRotateMultisigKeys = `${multisigPrefix}rmk`;

  public static dataPauseProposal(proposalPublicKey: PublicKey, validUntilSlot: UInt32) {
    return [
      hashWithPrefix(this.prefixPauseProposal, [
        ...proposalPublicKey.toFields(),
        ...validUntilSlot.toFields(),
      ]),
    ];
  }

  public static dataUnpauseProposal(
    proposalPublicKey: PublicKey,
    validUntilSlot: UInt32
  ) {
    return [
      hashWithPrefix(this.prefixUnpauseProposal, [
        ...proposalPublicKey.toFields(),
        ...validUntilSlot.toFields(),
      ]),
    ];
  }

  public static dataPauseTreasury(validUntilSlot: UInt32) {
    return [hashWithPrefix(this.prefixPauseTreasury, [...validUntilSlot.toFields()])];
  }

  public static dataUnpauseTreasury(validUntilSlot: UInt32) {
    return [hashWithPrefix(this.prefixUnpauseTreasury, [...validUntilSlot.toFields()])];
  }
}
export class MultisigSignatures extends Struct({
  signatures: Provable.Array(MultisigSignature, MULTISIG_PARTICIPANTS_COUNT),
}) { }

// TODO: set correct starting permissions
export class TreasuryOwnerSmartContract extends TokenContract {
  public static proposalContractVerificationKey?: {
    data: string;
    hash: Field;
  };

  public static lifecyclePeriodDuration = LIFECYCLE_PERIOD_DURATION;

  public static multisigParticipants: PublicKey[] = [];

  @state(UInt32) treasuryDeployedAtSlot = State<UInt32>();

  @state(Field) stakingEpochDataLedgerHash = State<Field>();
  @state(UInt64) stakingEpochDataLedgerTotalCurrency = State<UInt64>();

  // hash of multisig addresses
  @state(Field) multisigCommitment = State<Field>();
  @state(Bool) paused = State<Bool>();

  public async snapshotStakingEpochData() {
    const networkStakingEpochDataLedgerHash =
      this.network.stakingEpochData.ledger.hash.getAndRequireEquals();
    const networkStakingEpochDataLedgerTotalCurrency =
      this.network.stakingEpochData.ledger.totalCurrency.getAndRequireEquals();

    this.stakingEpochDataLedgerHash.set(networkStakingEpochDataLedgerHash);
    this.stakingEpochDataLedgerTotalCurrency.set(
      networkStakingEpochDataLedgerTotalCurrency
    );

    return {
      stakingEpochDataLedgerHash: networkStakingEpochDataLedgerHash,
      stakingEpochDataLedgerTotalCurrency:
        networkStakingEpochDataLedgerTotalCurrency,
    };
  }

  @method
  public async initialize(
    treasuryDeployedAtSlot: UInt32,
    multisigCommitment: Field
  ) {
    this.account.provedState.getAndRequireEquals().assertFalse();

    const currentTreasuryDeployedAtSlot =
      this.treasuryDeployedAtSlot.getAndRequireEquals();

    currentTreasuryDeployedAtSlot
      .equals(UInt32.from(0))
      .assertTrue("Contract has already been initialized");

    this.treasuryDeployedAtSlot.set(treasuryDeployedAtSlot);
    this.multisigCommitment.set(multisigCommitment);
  }

  public async requireLifecyclePeriodGreaterThanOrEqual(
    period: LifecyclePeriod,
    lifecycleId: UInt32
  ) {
    await this.requireLifecyclePeriod(period, lifecycleId, Bool(true));
  }

  public async requireLifecyclePeriod(
    period: LifecyclePeriod,
    lifecycleId: UInt32,
    // used if a lifecycle period has no upper bound, e.g. to allow
    // tallying votes / execution anytime after the cooldown period
    noUpperBoundToSlot: Bool = Bool(false)
  ) {
    const treasuryDeployedAtSlot =
      this.treasuryDeployedAtSlot.getAndRequireEquals();

    Provable.log(
      "requireLifecyclePeriod",
      TreasuryOwnerSmartContract.lifecyclePeriodDuration
    );

    const fromSlot = treasuryDeployedAtSlot
      // fast forward to the start of the requested lifecycle
      .add(
        TreasuryOwnerSmartContract.lifecyclePeriodDuration.mul(
          LifecyclePeriod.NUMBER_OF_PERIODS.mul(lifecycleId)
        )
      )
      // fast forward to the start of the requested period
      .add(TreasuryOwnerSmartContract.lifecyclePeriodDuration.mul(period));

    const toSlot = Provable.if(
      noUpperBoundToSlot,
      UInt32.MAXINT(),
      fromSlot.add(TreasuryOwnerSmartContract.lifecyclePeriodDuration)
    );

    Provable.log(
      "requireLifecyclePeriod",
      period,
      lifecycleId,
      fromSlot,
      toSlot
    );

    this.network.globalSlotSinceGenesis.requireBetween(fromSlot, toSlot);
  }

  // TODO: do we really need this method? we could remove it do decrease the number of invariants and increase security
  @method
  public async updateProposal(
    proposalPublicKey: PublicKey,
    proposalUpdate: Proposal
  ) {
    Provable.log("updateProposal", { proposalPublicKey });

    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      this.deriveTokenId()
    );

    const proposalLifecycleId = proposal.lifecycleId.getAndRequireEquals();

    await this.snapshotStakingEpochData();
    await this.requireLifecyclePeriod(
      LifecyclePeriod.PROPOSAL,
      proposalLifecycleId
    );
    await this.requireNotPaused();

    await proposal.update(proposalUpdate);

    this.approve(proposal.self);
  }

  @method
  public async createProposal(
    proposalPublicKey: PublicKey,
    proposal: Proposal,
    lifecycleId: UInt32
  ) {
    Provable.log("createProposal", { lifecycleId });

    const { stakingEpochDataLedgerHash, stakingEpochDataLedgerTotalCurrency } =
      await this.snapshotStakingEpochData();
    await this.requireLifecyclePeriod(LifecyclePeriod.PROPOSAL, lifecycleId);
    await this.requireNotPaused();

    // treasury owner will hold the bond amount
    // AU for deducting the bond amount from the proposal creator account needs to be created
    // when forging the transaction itself
    const bondAmount = proposal.amount.div(BOND_AMOUNT_DIVISOR);
    this.self.balance.addInPlace(bondAmount);

    const proposalUpdate = AccountUpdate.createSigned(
      proposalPublicKey,
      this.deriveTokenId()
    );

    // TODO: find a way to deploy here using "new TreasuryProposalSmartContract" instead
    const recipientFields = proposal.recipient.toFields();
    proposalUpdate.update.appState = [
      // public key should be represented by two fields
      {
        isSome: Bool(true),
        value: recipientFields[0],
      },
      {
        isSome: Bool(true),
        value: recipientFields[1],
      },
      {
        isSome: Bool(true),
        value: proposal.amount.toFields()[0],
      },
      {
        isSome: Bool(true),
        value: lifecycleId.toFields()[0],
      },
      // TODO: this seems to be not working on lightnet proposal create
      {
        isSome: Bool(true),
        value: stakingEpochDataLedgerHash.toFields()[0],
      },
      {
        isSome: Bool(true),
        value: stakingEpochDataLedgerTotalCurrency.toFields()[0],
      },
      {
        isSome: Bool(false),
        value: Field(0),
      },
      {
        isSome: Bool(false),
        value: Field(0),
      },
    ];

    proposalUpdate.account.verificationKey.set(
      TreasuryProposalSmartContract._verificationKey
    );

    // TODO: make sure the permissions are sufficiently restrictive
    if (TreasuryProposalSmartContract.permissionType == "signature") {
      console.log("setting signature permissions during createProposal");
      proposalUpdate.account.permissions.set({
        ...Permissions.default(),
        editState: Permissions.signature(),
        send: Permissions.signature(),
        editActionState: Permissions.signature(),
      });
    } else {
      proposalUpdate.account.permissions.set(Permissions.default());
    }

    proposalUpdate.account.zkappUri.set(proposal.zkAppUri);

    this.approve(proposalUpdate);
  }

  // TODO: implement some form of a spam prevention, e.g.: requiring the voter to:
  // exist in the voting ledger with a delegated balance > 0
  // TODO: move some of this logic to the proposal contract itself?
  @method
  public async vote(
    proposalPublicKey: PublicKey,
    publicKey: PublicKey,
    vote: Vote
  ) {
    this.requireNotPaused();
    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      this.deriveTokenId()
    );

    const proposalLifecycleId = proposal.lifecycleId.getAndRequireEquals();

    Provable.log("vote", { proposalLifecycleId });

    await this.requireLifecyclePeriod(
      LifecyclePeriod.VOTING,
      proposalLifecycleId
    );

    await proposal.vote({
      vote,
      publicKey,
    });

    // TODO: this creates a new account if it doesnt exist, it'll cost 1 MINA
    // it could be free if we just check a hand crafted signature instead
    // this becomes relevant if a delegate public key is used that is not in the current L1 ledger
    AccountUpdate.createSigned(publicKey);

    if (TreasuryProposalSmartContract.permissionType == "signature") {
      proposal.self.requireSignature();
    }

    this.approve(proposal.self);
  }

  @method
  public async tallyVotes(
    proposalPublicKey: PublicKey,
    voteReducerProof: SideLoadedVoteReducerProof,
    stakingLedgerToVotingLedgerProof: SideLoadedStakingLedgerToVotingLedgerProof
  ) {
    this.requireNotPaused();
    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      this.deriveTokenId()
    );

    // proofs need to be verified at the top level here, not only in the nested proposal.tallyVotes method
    voteReducerProof.verify(
      TreasuryProposalSmartContract.voteReducerVerificationKey
    );

    stakingLedgerToVotingLedgerProof.verify(
      TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey
    );

    const proposalLifecycleId = proposal.lifecycleId.getAndRequireEquals();
    Provable.log("tallyVotes", { proposalLifecycleId });

    await this.requireLifecyclePeriodGreaterThanOrEqual(
      LifecyclePeriod.COOLDOWN,
      proposalLifecycleId
    );

    // TODO: add logic to verify chain of AUs proving action state coherence

    await proposal.tallyVotes(
      voteReducerProof,
      stakingLedgerToVotingLedgerProof
    );

    if (TreasuryProposalSmartContract.permissionType == "signature") {
      proposal.self.requireSignature();
    }

    this.approve(proposal.self);
  }

  @method
  public async executeProposal(proposalPublicKey: PublicKey, amountToPayOut: UInt64) {
    this.requireNotPaused();
    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      this.deriveTokenId()
    );

    const proposalLifecycleId = proposal.lifecycleId.getAndRequireEquals();
    Provable.log("executeProposal", { proposalLifecycleId });

    await this.requireLifecyclePeriodGreaterThanOrEqual(
      LifecyclePeriod.PROPOSAL,
      // only allow execution of proposals from the previous lifecycle
      proposalLifecycleId.add(1)
    );

    this.self.balance.subInPlace(amountToPayOut);

    await proposal.execute(amountToPayOut);

    if (TreasuryProposalSmartContract.permissionType == "signature") {
      proposal.self.requireSignature();
    }

    this.approve(proposal.self);
  }

  public async verifyMultisigSignatures(
    data: Field[],
    { signatures }: MultisigSignatures
  ) {
    Provable.log("multisigParticipants", TreasuryOwnerSmartContract.multisigParticipants.length, '/', MULTISIG_PARTICIPANTS_COUNT);

    const multiSigCommitment = this.multisigCommitment.getAndRequireEquals();
    const multisigParticipants = Provable.witness(
      Provable.Array(PublicKey, MULTISIG_PARTICIPANTS_COUNT),
      () => {
        return TreasuryOwnerSmartContract.multisigParticipants;
      }
    );

    // TODO: implement n/m multisig signatures verification
    const signaturesValid = signatures.map((signature, i) => {
      return signature
        .verify(multisigParticipants[i], data)
    });

    Provable.log("signaturesValid", signaturesValid);

    const validSignaturesCount = signaturesValid.reduce((signaturesValid, isValid) =>
      signaturesValid.add(Provable.if(isValid, UInt32.from(1), UInt32.from(0))),
      UInt32.from(0)
    );

    validSignaturesCount.greaterThanOrEqual(UInt32.from(MIN_VALID_MULTISIG_SIGNATURES_COUNT)).assertTrue("Not enough valid signatures");

    const currentMultiSigCommitment = Poseidon.hash([
      ...multisigParticipants.flatMap((participant) => participant.toFields()),
    ]);

    currentMultiSigCommitment
      .equals(multiSigCommitment)
      .assertTrue("Invalid multisig commitment");
  }

  // TODO: implement this, but also merge other breakglass calls to prevent wrap circuit method count limits
  // @method
  // public async rotateMultisigKeys(signatures: MultisigSignatures) {}

  @method
  public async pauseProposal(
    proposalPublicKey: PublicKey,
    signatures: MultisigSignatures,
    validUntilSlot: UInt32,
  ) {
    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      this.deriveTokenId()
    );

    const data = MultisigSignature.dataPauseProposal(proposalPublicKey, validUntilSlot);
    await this.verifyMultisigSignatures(data, signatures);
    this.requireGlobalSlotToBeBefore(validUntilSlot);

    await proposal.pause();

    this.approve(proposal.self);
  }

  @method
  public async unpauseProposal(
    proposalPublicKey: PublicKey,
    signatures: MultisigSignatures,
    validUntilSlot: UInt32,
  ) {
    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      this.deriveTokenId()
    );

    const data = MultisigSignature.dataUnpauseProposal(
      proposalPublicKey,
      validUntilSlot
    );
    await this.verifyMultisigSignatures(data, signatures);
    this.requireGlobalSlotToBeBefore(validUntilSlot);

    await proposal.unpause();

    this.approve(proposal.self);
  }

  public async requireGlobalSlotToBeBefore(to: UInt32) {
    this.network.globalSlotSinceGenesis.requireBetween(UInt32.from(0), to);
  }

  // TODO: these pause methods may cause compilation issues due to the contract size limit
  @method
  public async pauseTreasury(signatures: MultisigSignatures, validUntilSlot: UInt32) {
    const data = MultisigSignature.dataPauseTreasury(validUntilSlot);
    await this.verifyMultisigSignatures(data, signatures);

    this.requireGlobalSlotToBeBefore(validUntilSlot);
    this.paused.set(Bool(true));
  }

  @method
  public async unpauseTreasury(signatures: MultisigSignatures, validUntilSlot: UInt32) {
    const data = MultisigSignature.dataUnpauseTreasury(validUntilSlot);
    await this.verifyMultisigSignatures(data, signatures);

    this.requireGlobalSlotToBeBefore(validUntilSlot);
    this.paused.set(Bool(false));
  }

  public async requireNotPaused() {
    const paused = this.paused.getAndRequireEquals();
    paused.not().assertTrue("Contract is paused");
  }

  public async approveBase(updates: AccountUpdateForest) {
    this.forEachUpdate(updates, (update, usesToken) => {
      usesToken.assertFalse(
        "No external account updates allowed for this token"
      );
    });
  }
}
