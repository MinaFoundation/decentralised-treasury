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
export const SLOT_PRECONDITION_PADDING = UInt32.from(5);
// historical preconditions can go 5 slots in the past, while we also
// allow SLOT_PRECONDITION_PADDING slots in the future for globalSlotSinceGenesis
export const VOTE_TALLY_HISTORICAL_PRECONDITION_DELAY =
  SLOT_PRECONDITION_PADDING.add(5);
export const MULTISIG_SIGNATURES_COUNT = 3;

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

  public static dataPauseProposal(proposalPublicKey: PublicKey, nonce: UInt32) {
    return [
      hashWithPrefix(this.prefixPauseProposal, [
        ...proposalPublicKey.toFields(),
        ...nonce.toFields(),
      ]),
    ];
  }

  public static dataUnpauseProposal(
    proposalPublicKey: PublicKey,
    nonce: UInt32
  ) {
    return [
      hashWithPrefix(this.prefixUnpauseProposal, [
        ...proposalPublicKey.toFields(),
        ...nonce.toFields(),
      ]),
    ];
  }

  public static dataPauseTreasury(nonce: UInt32) {
    return [hashWithPrefix(this.prefixPauseTreasury, [...nonce.toFields()])];
  }

  public static dataUnpauseTreasury(nonce: UInt32) {
    return [hashWithPrefix(this.prefixUnpauseTreasury, [...nonce.toFields()])];
  }
}
export class MultisigSignatures extends Struct({
  signatures: Provable.Array(MultisigSignature, MULTISIG_SIGNATURES_COUNT),
}) {}

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

    // TODO: replace with chain of AUs proving action state coherence
    // await this.ensureHistoricalPreconditionDelay();

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
  public async executeProposal(proposalPublicKey: PublicKey) {
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

    // TODO: figure out how to do this from the proposal itself to maintain
    // proposal type decoupling from owner execution
    this.self.balance.subInPlace(proposal.amount.getAndRequireEquals());

    // TODO: is this.self.publicKey safe?
    await proposal.execute(this.self);

    if (TreasuryProposalSmartContract.permissionType == "signature") {
      proposal.self.requireSignature();
    }

    this.approve(proposal.self);
  }

  public async verifyMultisigSignatures(
    data: Field[],
    { signatures }: MultisigSignatures
  ) {
    const multiSigCommitment = this.multisigCommitment.getAndRequireEquals();
    const multisigParticipants = Provable.witness(
      Provable.Array(PublicKey, MULTISIG_SIGNATURES_COUNT),
      () => {
        return TreasuryOwnerSmartContract.multisigParticipants;
      }
    );

    // TODO: implement n/m multisig signatures verification
    signatures.forEach((signature, i) => {
      signature
        .verify(multisigParticipants[i], data)
        .assertTrue("Invalid multisig signature");
    });

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
    signatures: MultisigSignatures
  ) {
    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      this.deriveTokenId()
    );

    const nonce = proposal.account.nonce.getAndRequireEquals();
    proposal.self.body.incrementNonce = Bool(true);

    const data = MultisigSignature.dataPauseProposal(proposalPublicKey, nonce);
    this.verifyMultisigSignatures(data, signatures);

    await proposal.pause();

    this.approve(proposal.self);
  }

  @method
  public async unpauseProposal(
    proposalPublicKey: PublicKey,
    signatures: MultisigSignatures
  ) {
    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      this.deriveTokenId()
    );

    const proposalNonce = proposal.account.nonce.getAndRequireEquals();
    proposal.self.body.incrementNonce = Bool(true);

    const data = MultisigSignature.dataUnpauseProposal(
      proposalPublicKey,
      proposalNonce
    );
    this.verifyMultisigSignatures(data, signatures);

    await proposal.unpause();

    this.approve(proposal.self);
  }

  // @method
  // public async pauseTreasury(signatures: MultisigSignatures) {
  //   const nonce = this.account.nonce.getAndRequireEquals();
  //   this.self.body.incrementNonce = Bool(true);
  //   const data = MultisigSignature.dataPauseTreasury(nonce);

  //   this.verifyMultisigSignatures(data, signatures);
  //   this.paused.set(Bool(true));
  // }

  // @method
  // public async unpauseTreasury(signatures: MultisigSignatures) {
  //   const nonce = this.account.nonce.getAndRequireEquals();
  //   this.self.body.incrementNonce = Bool(true);
  //   const data = MultisigSignature.dataUnpauseTreasury(nonce);

  //   this.verifyMultisigSignatures(data, signatures);
  //   this.paused.set(Bool(false));
  // }

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
