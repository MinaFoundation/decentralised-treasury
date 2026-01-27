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
  UInt32,
} from "o1js";
import { SideLoadedVoteReducerProof, VoteAction } from "./vote-reducer.js";
import { SideLoadedStakingLedgerToVotingLedgerProof } from "../../staking-ledger-to-voting-ledger.js";
import { BOND_AMOUNT_DIVISOR } from "../treasury-owner.js";

export class Proposal extends Struct({
  amount: UInt64,
  recipient: PublicKey,
  zkAppUri: String,
}) {}

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

// TODO: add a method to update zkAppUri within the same the PROPOSAL period
// TODO: set correct starting permissions
export class TreasuryProposalSmartContract extends SmartContract {
  public static voteReducerVerificationKey: VerificationKey;
  public static stakingLedgerToVotingLedgerVerificationKey: VerificationKey;
  public static permissionType: "proof" | "signature" = "proof";

  reducer = Reducer({ actionType: VoteAction });

  @state(PublicKey) recipient = State<PublicKey>();
  @state(UInt64) amount = State<UInt64>();

  @state(UInt32) lifecycleId = State<UInt32>();

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
    // const actionState = this.account.actionState.getAndRequireEquals();
    // TODO: add logic to check for all 5 existing possible action states
    this.account.actionState.requireEquals(
      voteReducerProof.publicOutput.toActionsHash
    );

    // TODO: is this already the historical 5 "slot" action hash precondition?
    // actionState.assertEquals(
    //   voteReducerProof.publicOutput.toActionsHash,
    //   "toActionsHash does not match on chain state"
    // );

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

    Provable.log("totalParticipatingVotes", {
      totalParticipatingVotes,
      requiredParticipation,
      totalCurrency: stakingEpochDataLedgerTotalCurrency,
    });

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
  public async update(proposal: Proposal) {
    this.recipient.set(proposal.recipient);
    this.amount.set(proposal.amount);
    this.account.zkappUri.set(proposal.zkAppUri);
  }

  @method
  public async execute(amountToPayOut: UInt64) {
    await this.requireNotPaused();
    const status = this.status.getAndRequireEquals();
    const recipient = this.recipient.getAndRequireEquals();
    const amount = this.amount.getAndRequireEquals();
    // we keep track of paidOutAmount to ensure partial payouts are possible if the treasury has insufficient funds
    const paidOutAmount = this.paidOutAmount.getAndRequireEquals();

    const amountWithBond = amount.add(amount.div(BOND_AMOUNT_DIVISOR));
    const remainingAmount = amountWithBond.sub(paidOutAmount);

    status
      .equals(ProposalStatus.APPROVED)
      .assertTrue("Proposal not approved");
    
    remainingAmount
      .greaterThanOrEqual(amountToPayOut)
      .assertTrue("Amount to pay out is greater than the remaining amount to pay out");

    // we create the recipient AU here to ensure only the intended recipient can receive the funds
    const recipientAccountUpdate = AccountUpdate.create(recipient);
    recipientAccountUpdate.balance.addInPlace(amountToPayOut);

    this.paidOutAmount.set(paidOutAmount.add(amountToPayOut));

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
    // TODO: make sure setting the status back to unknown makes sense
    this.status.set(ProposalStatus.UNKNOWN);
  }
}
