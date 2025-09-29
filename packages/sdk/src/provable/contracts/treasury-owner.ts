import {
  AccountUpdate,
  AccountUpdateForest,
  Bool,
  Field,
  Permissions,
  Provable,
  PublicKey,
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

export class Proposal extends Struct({
  amount: UInt64,
  recipient: PublicKey,
  zkAppUri: String,
}) {}

// TODO: doublecheck constant values
// 3360 slots = 1 week @ 480 slots per day
export const LIFECYCLE_PERIOD_DURATION = UInt32.from(3360);
export const SLOT_PRECONDITION_PADDING = UInt32.from(5);
// TODO: these two have to be the same, otherwise there'll be two separate preconditions for the same network state
export const VOTE_TALLY_HISTORICAL_PRECONDITION_DELAY =
  SLOT_PRECONDITION_PADDING;

export class LifecyclePeriod extends UInt32 {
  // doubles as execution period too
  public static PROPOSAL = new LifecyclePeriod(0);
  public static EXPLORATION = new LifecyclePeriod(1);
  public static VOTING = new LifecyclePeriod(2);
  public static COOLDOWN = new LifecyclePeriod(3);

  public static NUMBER_OF_PERIODS = UInt32.from(4);
}

// TODO: set correct starting permissions
export class TreasuryOwnerSmartContract extends TokenContract {
  public static proposalContractVerificationKey?: {
    data: string;
    hash: Field;
  };

  @state(UInt32) lifecycleStartedAt = State<UInt32>();

  // these two are tracked on-chain in order to enable execution of "old" proposals from previous lifecycles
  @state(UInt64) lifecycleId = State<UInt64>();

  @state(Field) stakingEpochDataLedgerHash = State<Field>();
  @state(UInt64) stakingEpochDataLedgerTotalCurrency = State<UInt64>();

  public async updateLifecycleState(globalSlotSinceGenesisUpper?: UInt32) {
    let lifecycleStartedAt = this.lifecycleStartedAt.getAndRequireEquals();
    const globalSlotSinceGenesis = this.network.globalSlotSinceGenesis.get();

    Provable.log("updateLifecycleState", {
      lifecycleStartedAt,
      globalSlotSinceGenesis,
    });

    // transaction should be valid if it's within the current lifecycle
    let lifecycleId = this.lifecycleId.getAndRequireEquals();

    let currentPeriod = new LifecyclePeriod(
      globalSlotSinceGenesis
        .sub(lifecycleStartedAt)
        .div(LIFECYCLE_PERIOD_DURATION)
    );

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
  public async initialize() {
    const lifecycleStartedAt = this.lifecycleStartedAt.getAndRequireEquals();
    lifecycleStartedAt
      .equals(UInt32.from(0))
      .assertTrue("Contract has already been initialized");

    // TODO: make this requireBetween
    const globalSlotSinceGenesis =
      this.network.globalSlotSinceGenesis.getAndRequireEquals();
    this.lifecycleStartedAt.set(globalSlotSinceGenesis);
    this.lifecycleId.set(UInt64.from(0));
  }

  @method
  public async createProposal(
    proposalPublicKey: PublicKey,
    proposal: Proposal
  ) {
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
    voteTallyProof: SideLoadedVoteReducerProof
  ) {
    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      this.deriveTokenId()
    );

    voteTallyProof.verify(
      TreasuryProposalSmartContract.voteReducerVerificationKey
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

    await proposal.tallyVotes(voteTallyProof);

    this.approve(proposal.self);
  }

  @method
  public async executeProposal(proposalPublicKey: PublicKey) {
    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      this.deriveTokenId()
    );

    const lifecycleId = this.lifecycleId.getAndRequireEquals();
    const proposalLifecycleId = proposal.lifecycleId.getAndRequireEquals();

    proposalLifecycleId
      .lessThan(lifecycleId)
      .assertTrue("Only proposals from the previous lifecycle can be executed");

    await proposal.execute();

    this.approve(proposal.self);
  }

  public async approveBase(updates: AccountUpdateForest) {
    this.forEachUpdate(updates, (update, usesToken) => {
      usesToken.assertFalse(
        "No external account updates allowed for this token"
      );
    });
  }
}
