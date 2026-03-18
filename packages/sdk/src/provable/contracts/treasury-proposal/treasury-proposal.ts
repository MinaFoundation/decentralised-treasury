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
  Poseidon,
  TokenId,
  Types,
} from "o1js";
import {
  ActionStateHistory,
  SideLoadedVoteReducerProof,
  VoteAction,
} from "./vote-reducer.js";
import { SideLoadedStakingLedgerToVotingLedgerProof } from "../../staking-ledger-to-voting-ledger.js";
import {
  BASIS_POINTS,
  BOND_AMOUNT_DIVISOR,
  CURVE_CONSTANT_APPROVAL_BP,
  CURVE_CONSTANT_PARTICIPATION_BP,
  MAX_APPROVAL_BP,
  MAX_PARTICIPATION_BP,
  MIN_APPROVAL_BP,
  MIN_PARTICIPATION_BP,
} from "../treasury-constants.js";
import { Account, packToFields } from "../../account.js";
import { hashWithPrefix } from "../../hashing-helpers.js";
import {
  accountHashPrefix,
  accountLedgerHashPrefixes,
} from "../../../ledgers/staking-ledger/staking-ledger.js";
import { PrefixedMerkleWitness36 } from "../../merkle-tree/prefixed-merkle-tree.js";

export class Proposal extends Struct({
  amount: UInt64,
  recipient: PublicKey,
  zkAppUri: Types.ZkappUri,
}) {}

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
  public static emptyNullifierRoot: Field;
  public static emptyVotingLedgerRoot: Field;

  reducer = Reducer({ actionType: VoteAction });

  @state(Field) recipientHash = State<Field>();
  @state(UInt64) amount = State<UInt64>();

  @state(UInt32) lifecycleId = State<UInt32>();

  @state(Field) stakingEpochDataLedgerHash = State<Field>();
  @state(UInt64) stakingEpochDataLedgerTotalCurrency = State<UInt64>();

  @state(ProposalStatus) status = State<ProposalStatus>();
  @state(UInt64) paidOutAmount = State<UInt64>();

  public async requireNotPaused() {
    const status = this.status.getAndRequireEquals();
    status.equals(ProposalStatus.PAUSED).assertFalse("Proposal is paused");
  }

  // workaround since reading state from another contract resulted in proving errors
  @method.returns(UInt32)
  public async getLifecycleId() {
    return this.lifecycleId.getAndRequireEquals();
  }

  @method
  public async vote(voteAction: VoteAction) {
    await this.requireNotPaused();
    this.reducer.dispatch(voteAction);
  }

  minUInt64(a: UInt64, b: UInt64) {
    return Provable.if(a.lessThan(b), a, b);
  }

  // TODO: implement UInt128 to handle overflows of UInt64 multiplication
  calculateAcceptanceCriteria(proposalAmount: UInt64, treasuryBalance: UInt64) {
    // ratio in basis points, capped at 100%
    const ratioBp = this.minUInt64(
      proposalAmount.mul(BASIS_POINTS).div(treasuryBalance),
      BASIS_POINTS,
    );

    // curve output in basis points:
    // ratio / (ratio + c * (1 - ratio)), with c in basis points (e.g. 5000 = 0.5)
    const participationCurveDenominator = ratioBp.add(
      CURVE_CONSTANT_PARTICIPATION_BP.mul(BASIS_POINTS.sub(ratioBp)).div(
        BASIS_POINTS,
      ),
    );
    const participationCurveBp = ratioBp
      .mul(BASIS_POINTS)
      .div(participationCurveDenominator);

    const approvalCurveDenominator = ratioBp.add(
      CURVE_CONSTANT_APPROVAL_BP.mul(BASIS_POINTS.sub(ratioBp)).div(
        BASIS_POINTS,
      ),
    );
    const approvalCurveBp = ratioBp
      .mul(BASIS_POINTS)
      .div(approvalCurveDenominator);

    // participation threshold
    const requiredParticipationBp = MIN_PARTICIPATION_BP.add(
      MAX_PARTICIPATION_BP.sub(MIN_PARTICIPATION_BP)
        .mul(participationCurveBp)
        .div(BASIS_POINTS),
    );

    // approval threshold
    const requiredApprovalBp = MIN_APPROVAL_BP.add(
      MAX_APPROVAL_BP.sub(MIN_APPROVAL_BP)
        .mul(approvalCurveBp)
        .div(BASIS_POINTS),
    );

    return {
      requiredParticipationBp,
      requiredApprovalBp,
    };
  }

  @method
  public async tallyVotes(
    // TODO: why do sideloaded proofs appear to have different wrap domain size limits than regular proofs?
    voteReducerProof: SideLoadedVoteReducerProof,
    stakingLedgerToVotingLedgerProof: SideLoadedStakingLedgerToVotingLedgerProof,
    treasuryOwnerPublicKey: PublicKey,
    treasuryOwnerAccount: Account,
    treasuryOwnerAccountWitness: PrefixedMerkleWitness36,
  ) {
    await this.requireNotPaused();
    const status = this.status.getAndRequireEquals();

    status.equals(ProposalStatus.UNKNOWN).assertTrue("Vote result already set");

    // proofs need to be verified here, even though they're already verified at the top level in the treasury owner contract
    voteReducerProof.verify(
      TreasuryProposalSmartContract.voteReducerVerificationKey,
    );
    stakingLedgerToVotingLedgerProof.verify(
      TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey,
    );

    const stakingEpochDataLedgerHash =
      this.stakingEpochDataLedgerHash.getAndRequireEquals();

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

    voteReducerPublicInput.fromNullifierRoot
      .equals(TreasuryProposalSmartContract.emptyNullifierRoot)
      .assertTrue("fromNullifierRoot does not match");

    // check that vote reducer proof started tallying actions from the initial action state
    voteReducerPublicInput.fromActionsHash
      .equals(Reducer.initialActionState)
      .assertTrue("fromActionsHash should be the initial action state");

    // check that vote reducer proof used the right voting ledger
    voteReducerPublicInput.votingLedgerRoot
      .equals(stakingLedgerToVotingLedgerPublicOutput.votingLedgerRoot)
      .assertTrue("voting ledger root does not match");

    stakingLedgerToVotingLedgerProof.publicInput.index
      .equals(UInt64.from(0))
      .assertTrue("staking ledger transformation must start at index 0");

    stakingLedgerToVotingLedgerPublicInput.votingLedgerRoot
      .equals(TreasuryProposalSmartContract.emptyVotingLedgerRoot)
      .assertTrue("initial voting ledger root must be empty");

    stakingLedgerToVotingLedgerPublicInput.stakingLedgerRoot
      .equals(stakingEpochDataLedgerHash)
      .assertTrue("staking ledger root does not match");

    stakingLedgerToVotingLedgerPublicOutput.exhausted.assertTrue(
      "staking ledger to voting ledger proof did not exhaust",
    );

    voteReducerProof.publicOutput.toActionsHash
      .equals(
        voteReducerProof.publicOutput.actionStateHistory.actionStateOne.hash,
      )
      .assertTrue("toActionsHash does not match action state one hash");

    const { yay, nay, abstain } = voteReducerPublicOutput;
    const proposalAmount = this.amount.getAndRequireEquals();

    treasuryOwnerAccount.pk
      .equals(treasuryOwnerPublicKey)
      .assertTrue("Treasury owner account public key does not match");

    treasuryOwnerAccount.tokenId
      .equals(TokenId.default)
      .assertTrue("Treasury owner account token id does not match");

    const treasuryOwnerAccountLeaf = hashWithPrefix(
      accountHashPrefix,
      packToFields(Account.toHashInput(treasuryOwnerAccount)),
    );
    const calculatedStakingLedgerRoot =
      treasuryOwnerAccountWitness.calculateRoot(
        treasuryOwnerAccountLeaf,
        accountLedgerHashPrefixes,
      );
    calculatedStakingLedgerRoot.assertEquals(
      stakingEpochDataLedgerHash,
      "Treasury owner account witness does not match staking ledger hash",
    );
    const stakingEpochDataLedgerTotalCurrency =
      this.stakingEpochDataLedgerTotalCurrency.getAndRequireEquals();
    const totalParticipatingVotes = yay.add(nay).add(abstain);

    const treasuryOwnerBalance = treasuryOwnerAccount.balance;
    const { requiredParticipationBp, requiredApprovalBp } =
      this.calculateAcceptanceCriteria(proposalAmount, treasuryOwnerBalance);

    // TODO: what about the remainder and precision handling?
    const requiredParticipation = stakingEpochDataLedgerTotalCurrency
      .mul(requiredParticipationBp)
      .div(BASIS_POINTS);

    Provable.log("totalParticipatingVotes", {
      totalParticipatingVotes,
      requiredParticipation,
      totalCurrency: stakingEpochDataLedgerTotalCurrency,
    });

    totalParticipatingVotes
      .greaterThanOrEqual(requiredParticipation)
      .assertTrue("Participation not met");

    // TODO: make sure there's sufficient precision handling?, since we're adding so many UInt64s this will likely overflow?
    const totalVotes = yay.add(nay);
    totalVotes.greaterThan(UInt64.from(0)).assertTrue("No approval votes cast");
    const approvalBp = yay.mul(BASIS_POINTS).div(totalVotes);

    // // participation was already checked above, so we can just check approval threshold
    const approved = approvalBp.greaterThanOrEqual(requiredApprovalBp);

    // // TODO: we could issue events here with details of the vote math

    const voteResult = Provable.if(
      approved,
      ProposalStatus.APPROVED,
      ProposalStatus.REJECTED,
    );

    this.status.set(voteResult);
  }

  @method
  public async execute(amountToPayOut: UInt64, recipient: PublicKey) {
    await this.requireNotPaused();
    const status = this.status.getAndRequireEquals();
    const recipientHash = this.recipientHash.getAndRequireEquals();
    const amount = this.amount.getAndRequireEquals();
    // we keep track of paidOutAmount to ensure partial payouts are possible if the treasury has insufficient funds
    const paidOutAmount = this.paidOutAmount.getAndRequireEquals();

    const amountWithBond = amount.add(amount.div(BOND_AMOUNT_DIVISOR));
    const remainingAmount = amountWithBond.sub(paidOutAmount);

    status.equals(ProposalStatus.APPROVED).assertTrue("Proposal not approved");

    remainingAmount
      .greaterThanOrEqual(amountToPayOut)
      .assertTrue(
        "Amount to pay out is greater than the remaining amount to pay out",
      );

    recipientHash
      .equals(Poseidon.hash(recipient.toFields()))
      .assertTrue("Recipient hash does not match on chain state");

    // we create the recipient AU here to ensure only the intended recipient can receive the funds
    const recipientAccountUpdate = AccountUpdate.create(recipient);
    recipientAccountUpdate.balance.addInPlace(amountToPayOut);

    this.paidOutAmount.set(paidOutAmount.add(amountToPayOut));

    this.approve(recipientAccountUpdate);
  }

  @method
  public async togglePause() {
    const status = this.status.getAndRequireEquals();
    // if paused, unpause it, if not paused, pause it
    const newStatus = Provable.if(
      status.equals(ProposalStatus.PAUSED),
      ProposalStatus.UNKNOWN,
      ProposalStatus.PAUSED,
    );

    this.status.set(newStatus);
  }
}
