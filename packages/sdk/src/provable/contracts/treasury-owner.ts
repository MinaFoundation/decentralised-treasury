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
import { SideLoadedStakingLedgerToVotingLedgerProof } from "../staking-ledger-to-voting-ledger.js";

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

  @state(UInt32) treasuryDeployedAtSlot = State<UInt32>();

  @state(Field) stakingEpochDataLedgerHash = State<Field>();
  @state(UInt64) stakingEpochDataLedgerTotalCurrency = State<UInt64>();

  public async snapshotStakingEpochData() {
    const networkStakingEpochDataLedgerHash =
      this.network.stakingEpochData.ledger.hash.getAndRequireEquals();
    const networkStakingEpochDataLedgerTotalCurrency =
      this.network.stakingEpochData.ledger.totalCurrency.getAndRequireEquals();

    this.stakingEpochDataLedgerHash.set(networkStakingEpochDataLedgerHash);
    this.stakingEpochDataLedgerTotalCurrency.set(
      networkStakingEpochDataLedgerTotalCurrency
    );
  }

  @method
  public async initialize(treasuryDeployedAtSlot: UInt32) {
    const currentTreasuryDeployedAtSlot =
      this.treasuryDeployedAtSlot.getAndRequireEquals();

    currentTreasuryDeployedAtSlot
      .equals(UInt32.from(0))
      .assertTrue("Contract has already been initialized");

    this.treasuryDeployedAtSlot.set(treasuryDeployedAtSlot);
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

    const fromSlot = treasuryDeployedAtSlot
      // fast forward to the start of the requested lifecycle
      .add(
        LIFECYCLE_PERIOD_DURATION.mul(
          LifecyclePeriod.NUMBER_OF_PERIODS.mul(lifecycleId)
        )
      )
      // fast forward to the start of the requested period
      .add(LIFECYCLE_PERIOD_DURATION.mul(period));

    const toSlot = Provable.if(
      noUpperBoundToSlot,
      UInt32.MAXINT(),
      fromSlot.add(LIFECYCLE_PERIOD_DURATION)
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
  public async createProposal(
    proposalPublicKey: PublicKey,
    proposal: Proposal,
    lifecycleId: UInt32
  ) {
    Provable.log("createProposal", { lifecycleId });

    await this.snapshotStakingEpochData();
    await this.requireLifecyclePeriod(LifecyclePeriod.PROPOSAL, lifecycleId);

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

    this.approve(proposal.self);
  }

  @method
  public async tallyVotes(
    proposalPublicKey: PublicKey,
    voteReducerProof: SideLoadedVoteReducerProof,
    stakingLedgerToVotingLedgerProof: SideLoadedStakingLedgerToVotingLedgerProof
  ) {
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

    this.approve(proposal.self);
  }

  @method
  public async executeProposal(proposalPublicKey: PublicKey) {
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
