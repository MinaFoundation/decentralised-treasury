import {
  Bool,
  Field,
  method,
  Reducer,
  SmartContract,
  State,
  state,
  Struct,
  PublicKey,
  Provable,
  VerificationKey,
  UInt64,
  AccountUpdate,
} from "o1js";
import { SideLoadedVoteReducerProof, VoteAction } from "./vote-reducer.js";
import { SideLoadedStakingLedgerToVotingLedgerProof } from "../../staking-ledger-to-voting-ledger.js";

// TODO: need a better name for this, its a divider not a percentage, 2 = 50%
export const REQUIRED_PARTICIPATION_PERCENTAGE = 2;
// cannot be lower than 51% due to the math implementation in the contract
export const REQUIRED_SUPERMAJORITY_PERCENTAGE = 75;

export class ProposalStatus extends Field {
  public static UNKNOWN = Field(0);
  public static APPROVED = Field(1);
  public static REJECTED = Field(2);
  public static PAUSED = Field(3);
}

// TODO: set correct starting permissions
export class TreasuryProposalSmartContract extends SmartContract {
  public static voteReducerVerificationKey: VerificationKey;
  public static stakingLedgerToVotingLedgerVerificationKey: VerificationKey;

  reducer = Reducer({ actionType: VoteAction });

  @state(PublicKey) recipient = State<PublicKey>();
  @state(UInt64) amount = State<UInt64>();

  @state(UInt64) lifecycleId = State<UInt64>();

  @state(Field) stakingEpochDataLedgerHash = State<Field>();
  @state(UInt64) stakingEpochDataLedgerTotalCurrency = State<UInt64>();

  @state(ProposalStatus) status = State<ProposalStatus>();
  @state(UInt64) paidOutAmount = State<UInt64>();

  public async requireNotPaused() {
    const status = this.status.getAndRequireEquals();
    status.equals(ProposalStatus.PAUSED).not().assertTrue("Proposal is paused");
  }

  @method
  public async vote(voteAction: VoteAction) {
    await this.requireNotPaused();
    this.reducer.dispatch(voteAction);
  }

  @method
  public async tallyVotes(
    voteReducerProof: SideLoadedVoteReducerProof,
    stakingLedgerToVotingLedgerProof: SideLoadedStakingLedgerToVotingLedgerProof
  ) {
    await this.requireNotPaused();
    // TODO: need better naming
    const status = this.status.getAndRequireEquals();

    status.equals(ProposalStatus.UNKNOWN).assertTrue("Vote result already set");

    // proofs need to be verified here, even though they're already verified at the top level in the treasury owner contract
    voteReducerProof.verify(
      TreasuryProposalSmartContract.voteReducerVerificationKey
    );
    stakingLedgerToVotingLedgerProof.verify(
      TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey
    );

    // TODO: add logic such as if the current period allows for vote tallying
    const actionState = this.account.actionState.getAndRequireEquals();

    // TODO: is this already the historical 5 "slot" action hash precondition?
    actionState.assertEquals(
      voteReducerProof.publicOutput.toActionsHash,
      "toActionsHash does not match on chain state"
    );

    const {
      publicInput: voteReducerPublicInput,
      publicOutput: voteReducerPublicOutput,
    } = voteReducerProof;

    const {
      publicInput: stakingLedgerToVotingLedgerPublicInput,
      publicOutput: stakingLedgerToVotingLedgerPublicOutput,
    } = stakingLedgerToVotingLedgerProof;

    voteReducerPublicInput.fromActionsHash
      .equals(Reducer.initialActionState)
      .assertTrue("fromActionsHash should be the initial action state");

    // TODO: check if all required inputs started at zero values

    // TODO: cross check proofs inputs/outputs

    // TODO: calculate quorum
    const { yay, nay, abstain } = voteReducerPublicOutput;
    const stakingEpochDataLedgerTotalCurrency =
      this.stakingEpochDataLedgerTotalCurrency.getAndRequireEquals();
    const totalParticipatingVotes = yay.add(nay).add(abstain);

    // TODO: what about the remainder and precision handling?
    const requiredParticipation = stakingEpochDataLedgerTotalCurrency.div(
      REQUIRED_PARTICIPATION_PERCENTAGE
    );

    totalParticipatingVotes
      .greaterThanOrEqual(requiredParticipation)
      .assertTrue("Participation not met");

    // TODO: make sure there's sufficient precision handling?
    const totalVotes = yay.add(nay);
    const totalVotesDivByYay = totalVotes.mul(100).divMod(yay.mul(100));
    const participationPercentage = UInt64.from(100).sub(
      totalVotesDivByYay.rest.div(totalVotes)
    );

    // participation was already checked above, so we can just check if there's more yay votes
    const approved = participationPercentage.greaterThanOrEqual(
      UInt64.from(REQUIRED_SUPERMAJORITY_PERCENTAGE)
    );

    // TODO: we could issue events here with details of the vote math

    const voteResult = Provable.if(
      approved,
      ProposalStatus.APPROVED,
      ProposalStatus.REJECTED
    );

    this.status.set(voteResult);
  }

  @method
  public async execute(treasuryOwnerAccountUpdate: AccountUpdate) {
    await this.requireNotPaused();
    const status = this.status.getAndRequireEquals();
    const recipient = this.recipient.getAndRequireEquals();
    const amount = this.amount.getAndRequireEquals();
    // we keep track paidOutAmount in preparation for future treasury sharding for the delegation program
    const paidOutAmount = this.paidOutAmount.getAndRequireEquals();

    status.equals(ProposalStatus.APPROVED).assertTrue("Proposal not approved");
    paidOutAmount
      .equals(UInt64.from(0))
      .assertTrue("Proposal already paid out");

    // TODO: find a way to do the balance sub from within the proposal itself to maintain proposal type decoupling from owner execution
    // treasuryOwnerAccountUpdate.balance.subInPlace(amount);

    const recipientAccountUpdate = AccountUpdate.create(recipient);
    recipientAccountUpdate.balance.addInPlace(amount);

    this.paidOutAmount.set(amount);

    this.approve(recipientAccountUpdate);
  }

  @method
  public async pause() {
    this.status.set(ProposalStatus.PAUSED);
  }

  @method
  public async unpause() {
    const status = this.status.getAndRequireEquals();
    status.equals(ProposalStatus.PAUSED).assertTrue("Proposal is not paused");
    this.status.set(ProposalStatus.UNKNOWN);
  }
}
