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

export class Proposal extends Struct({
  amount: UInt64,
  recipient: PublicKey,
  zkAppUri: String,
}) {}

// TODO: doublecheck constant values
// 3360 slots = 1 week @ 480 slots per day
export const LIFECYCLE_PERIOD_DURATION = UInt32.from(3360);
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

export class MultisigSignature extends Signature {
  public static prefixPauseProposal = "decentralized-treasury-pause-proposal";
  public static prefixUnpauseProposal =
    "decentralized-treasury-unpause-proposal";

  public static prefixPause = "decentralized-treasury-pause";
  public static prefixUnpause = "decentralized-treasury-unpause";

  public static prefixRotateMultisigKeys =
    "decentralized-treasury-rotate-multisig-keys";

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
    return [hashWithPrefix(this.prefixPause, [...nonce.toFields()])];
  }

  public static dataUnpauseTreasury(nonce: UInt32) {
    return [hashWithPrefix(this.prefixUnpause, [...nonce.toFields()])];
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

  public static multisigParticipants: PublicKey[] = [];

  @state(UInt32) lifecycleStartedAt = State<UInt32>();

  // these two are tracked on-chain in order to enable execution of "old" proposals from previous lifecycles
  @state(UInt64) lifecycleId = State<UInt64>();
  @state(LifecyclePeriod) currentPeriod = State<LifecyclePeriod>();

  @state(Field) stakingEpochDataLedgerHash = State<Field>();
  @state(UInt64) stakingEpochDataLedgerTotalCurrency = State<UInt64>();

  // hash of multisig addresses
  @state(Field) multisigCommitment = State<Field>();
  @state(Bool) paused = State<Bool>();

  public async updateLifecycleState(globalSlotSinceGenesisUpper?: UInt32) {
    let lifecycleStartedAt = this.lifecycleStartedAt.getAndRequireEquals();
    const globalSlotSinceGenesis = this.network.globalSlotSinceGenesis.get();

    // transaction should be valid if it's within the current lifecycle
    let lifecycleId = this.lifecycleId.getAndRequireEquals();

    let currentPeriod = new LifecyclePeriod(
      globalSlotSinceGenesis
        // fast forward the current slot by SLOT_PRECONDITION_PADDING
        // to offset the precondition upper bound
        .add(SLOT_PRECONDITION_PADDING) // +5
        .sub(lifecycleStartedAt) // 10000
        .div(LIFECYCLE_PERIOD_DURATION) // 3360
    );

    // we need to keep track of currentPeriod on chain too,
    // otherwise when someone updates the lifecycle state during the next lifecycle's PROPOSAL period
    // we will not correctly detect if a new lifecycle is starting
    const isLifecycleResetting = currentPeriod.greaterThanOrEqual(
      LifecyclePeriod.NUMBER_OF_PERIODS
    );

    // return either the current period, or cycle back to the first period
    currentPeriod = Provable.if(
      isLifecycleResetting,
      LifecyclePeriod.PROPOSAL,
      currentPeriod
    );

    // advance lifecycle ID if we're starting a new lifecycle
    lifecycleId = Provable.if(
      isLifecycleResetting,
      lifecycleId.add(UInt64.from(1)),
      lifecycleId
    );

    lifecycleStartedAt = Provable.if(
      isLifecycleResetting,
      globalSlotSinceGenesis,
      lifecycleStartedAt
    );

    this.lifecycleId.set(lifecycleId);
    this.lifecycleStartedAt.set(lifecycleStartedAt);
    // this.currentPeriod.set(currentPeriod);

    /**
     * This precondition ensures that any transaction that updates the lifecycle state
     * is valid for at least SLOT_PRECONDITION_PADDING slots. This also creates a situation
     * where the `lifecycleStartedAt` can change between transactions, as they each use
     * different `globalSlotSinceGenesis` values.
     *
     * Therefore the `lifecycleStartedAt` has a precision of SLOT_PRECONDITION_PADDING slots.
     *
     * It's not feasible to have a strict equals precondition on `globalSlotsSinceGenesis`, since this
     * would make the transactions valid for only a single slot.
     */
    this.network.globalSlotSinceGenesis.requireBetween(
      globalSlotSinceGenesis,
      globalSlotSinceGenesisUpper ??
        globalSlotSinceGenesis.add(SLOT_PRECONDITION_PADDING)
    );

    let stakingEpochDataLedgerHash =
      this.stakingEpochDataLedgerHash.getAndRequireEquals();
    let stakingEpochDataLedgerTotalCurrency =
      this.stakingEpochDataLedgerTotalCurrency.getAndRequireEquals();

    const networkStakingEpochDataLedgerHash =
      this.network.stakingEpochData.ledger.hash.getAndRequireEquals();
    const networkStakingEpochDataLedgerTotalCurrency =
      this.network.stakingEpochData.ledger.totalCurrency.getAndRequireEquals();

    // update the staking epoch data snapshots only if a new lifecycle is starting
    // there might be cases where the staking epoch data may change during the proposal period
    // effectively this means the staking epoch data is only "fixed" after the proposal period ends
    stakingEpochDataLedgerHash = Provable.if(
      isLifecycleResetting,
      networkStakingEpochDataLedgerHash,
      stakingEpochDataLedgerHash
    );
    stakingEpochDataLedgerTotalCurrency = Provable.if(
      isLifecycleResetting,
      networkStakingEpochDataLedgerTotalCurrency,
      stakingEpochDataLedgerTotalCurrency
    );

    this.stakingEpochDataLedgerHash.set(networkStakingEpochDataLedgerHash);
    this.stakingEpochDataLedgerTotalCurrency.set(
      networkStakingEpochDataLedgerTotalCurrency
    );

    return currentPeriod;
  }

  // we need to delay vote tallying, since the action state precondition allows for 5 historical slots
  // to be used for the action state hash, since we delay the tallying, no vote actions can be left out
  public async ensureHistoricalPreconditionDelay() {
    const lifecycleStartedAt = this.lifecycleStartedAt.getAndRequireEquals();
    const globalSlotSinceGenesis = this.network.globalSlotSinceGenesis.get();

    const globalSlotsSinceCooldownPeriodStart = lifecycleStartedAt.add(
      LIFECYCLE_PERIOD_DURATION.mul(LifecyclePeriod.COOLDOWN)
    );

    globalSlotSinceGenesis
      .sub(globalSlotsSinceCooldownPeriodStart)
      .greaterThanOrEqual(VOTE_TALLY_HISTORICAL_PRECONDITION_DELAY)
      .assertTrue(
        "Insufficient slots passed since start of the cooldown period, please wait a few slots"
      );
  }

  @method
  public async initialize(multiSigCommitment: Field) {
    // TODO: do we need more preconditions here?
    const lifecycleStartedAt = this.lifecycleStartedAt.getAndRequireEquals();

    lifecycleStartedAt
      .equals(UInt32.from(0))
      .assertTrue("Contract has already been initialized");

    // TODO: make this requireBetween
    const globalSlotSinceGenesis =
      this.network.globalSlotSinceGenesis.getAndRequireEquals();
    this.lifecycleStartedAt.set(globalSlotSinceGenesis);
    this.lifecycleId.set(UInt64.from(0));
    this.multisigCommitment.set(multiSigCommitment);
  }

  @method
  public async createProposal(
    proposalPublicKey: PublicKey,
    proposal: Proposal
  ) {
    this.requireNotPaused();

    const currentPeriod = await this.updateLifecycleState();
    currentPeriod
      .equals(LifecyclePeriod.PROPOSAL)
      .assertTrue("Not in proposal period");

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
        value: this.lifecycleId.getAndRequireEquals().toFields()[0],
      },
      {
        isSome: Bool(true),
        value: this.stakingEpochDataLedgerHash
          .getAndRequireEquals()
          .toFields()[0],
      },
      {
        isSome: Bool(true),
        value: this.stakingEpochDataLedgerTotalCurrency
          .getAndRequireEquals()
          .toFields()[0],
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
    proposalUpdate.account.permissions.set(Permissions.default());
    proposalUpdate.account.zkappUri.set(proposal.zkAppUri);
  }

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

    const lifecycleId = this.lifecycleId.getAndRequireEquals();
    const proposalLifecycleId = proposal.lifecycleId.getAndRequireEquals();
    const currentPeriod = await this.updateLifecycleState();

    proposalLifecycleId
      .equals(lifecycleId)
      .assertTrue("Proposal must be from the current lifecycle");

    currentPeriod
      .equals(LifecyclePeriod.VOTING)
      .assertTrue("Not in voting period");

    await proposal.vote({
      vote,
      publicKey,
    });

    // TODO: this creates a new account if it doesnt exist, it'll cost 1 MINA
    // it could be free if we just check a hand crafted signature instead
    // this becomes relevant if a delegate publcyic key is used that is not in the current L1 ledger
    AccountUpdate.createSigned(publicKey);

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

    const globalSlotSinceGenesis = this.network.globalSlotSinceGenesis.get();
    const currentPeriod = await this.updateLifecycleState(
      globalSlotSinceGenesis.add(VOTE_TALLY_HISTORICAL_PRECONDITION_DELAY)
    );
    const lifecycleId = this.lifecycleId.getAndRequireEquals();
    const proposalLifecycleId = proposal.lifecycleId.getAndRequireEquals();

    // allow vote tallying
    currentPeriod
      .equals(LifecyclePeriod.COOLDOWN)
      .or(proposalLifecycleId.lessThan(lifecycleId))
      .assertTrue(
        "In order to tally votes, you must be in the cooldown period or the proposal must be from the previous lifecycle"
      );

    await this.ensureHistoricalPreconditionDelay();

    await proposal.tallyVotes(
      voteReducerProof,
      stakingLedgerToVotingLedgerProof
    );

    this.approve(proposal.self);
  }

  @method
  public async executeProposal(proposalPublicKey: PublicKey) {
    this.requireNotPaused();
    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      this.deriveTokenId()
    );

    await this.updateLifecycleState();

    // TODO: why cannot i get the latest set lifecycleId using .get()?
    const lifecycleId = UInt64.fromFields([this.self.update.appState[1].value]);
    // const lifecycleId = this.lifecycleId.getAndRequireEquals();
    const proposalLifecycleId = proposal.lifecycleId.getAndRequireEquals();

    proposalLifecycleId
      .lessThan(lifecycleId)
      .assertTrue("Only proposals from the previous lifecycle can be executed");

    // TODO: figure out how to do this from the proposal itself to maintain
    // proposal type decoupling from owner execution
    this.self.balance.subInPlace(proposal.amount.getAndRequireEquals());

    // TODO: is this.self.publicKey safe?
    await proposal.execute(this.self);

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

  // TODO: implement this
  @method
  public async rotateMultisigKeys(signatures: MultisigSignatures) {}

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

  @method
  public async pauseTreasury(signatures: MultisigSignatures) {
    const nonce = this.account.nonce.getAndRequireEquals();
    this.self.body.incrementNonce = Bool(true);
    const data = MultisigSignature.dataPauseTreasury(nonce);

    this.verifyMultisigSignatures(data, signatures);
    this.paused.set(Bool(true));
  }

  @method
  public async unpauseTreasury(signatures: MultisigSignatures) {
    const nonce = this.account.nonce.getAndRequireEquals();
    this.self.body.incrementNonce = Bool(true);
    const data = MultisigSignature.dataUnpauseTreasury(nonce);

    this.verifyMultisigSignatures(data, signatures);
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
