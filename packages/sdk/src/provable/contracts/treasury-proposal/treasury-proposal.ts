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
  UInt128,
} from "o1js";
import { provableLog } from "../../../logging/logger.js";
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

  public static minUInt128(a: UInt128, b: UInt128): UInt128 {
    return Provable.if<UInt128>(a.lessThan(b), a, b);
  }

  public static calculateAcceptanceCriteria(
    proposalAmount: UInt128,
    treasuryBalance: UInt128,
    stakingEpochDataLedgerTotalCurrency: UInt64,
  ): {
    requiredParticipationBp: UInt128;
    requiredApprovalBp: UInt128;
    requiredParticipation: UInt128;
  } {
    // ratio in basis points, capped at 100%
    const ratioBp = TreasuryProposalSmartContract.minUInt128(
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

    const requiredParticipation = UInt128.from(
      stakingEpochDataLedgerTotalCurrency,
    )
      .mul(requiredParticipationBp)
      .div(BASIS_POINTS);

    return {
      requiredParticipationBp,
      requiredApprovalBp,
      requiredParticipation,
    };
  }

  public static calculateApprovalStatus(input: {
    yay: UInt128;
    nay: UInt128;
    abstain: UInt128;
    requiredParticipation: UInt128;
    requiredApprovalBp: UInt128;
  }): {
    totalParticipatingVotes: UInt128;
    requiredParticipation: UInt128;
    participationMet: Bool;
    totalVotes: UInt128;
    hasApprovalVotes: Bool;
    approvalBp: UInt128;
    approved: Bool;
    voteResult: ProposalStatus;
  } {
    const totalParticipatingVotes = input.yay.add(input.nay).add(input.abstain);
    const participationMet =
      totalParticipatingVotes.greaterThanOrEqual(input.requiredParticipation);

    const totalVotes = input.yay.add(input.nay);
    const hasApprovalVotes = totalVotes.greaterThan(UInt128.from(0));
    const safeTotalVotes = Provable.if(
      hasApprovalVotes,
      totalVotes,
      UInt128.from(1),
    );
    const approvalBp = input.yay.mul(BASIS_POINTS).div(safeTotalVotes);
    const approved = participationMet
      .and(hasApprovalVotes)
      .and(approvalBp.greaterThanOrEqual(input.requiredApprovalBp));
    const voteResult = Provable.if(
      approved,
      ProposalStatus.APPROVED,
      ProposalStatus.REJECTED,
    );

    return {
      totalParticipatingVotes,
      requiredParticipation: input.requiredParticipation,
      participationMet,
      totalVotes,
      hasApprovalVotes,
      approvalBp,
      approved,
      voteResult,
    };
  }

  @method.returns(Field)
  public async tallyVotes(
    // TODO: why do sideloaded proofs appear to have different wrap domain size limits than regular proofs?
    voteReducerProof: SideLoadedVoteReducerProof,
    stakingLedgerToVotingLedgerProof: SideLoadedStakingLedgerToVotingLedgerProof,
    treasuryOwnerPublicKey: PublicKey,
    treasuryOwnerAccount: Account,
    treasuryOwnerAccountWitness: PrefixedMerkleWitness36,
  ): Promise<Field> {
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

    Provable.log("stakingEpochDataLedgerHash", stakingEpochDataLedgerHash);

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

    const {
      yay: yayUInt64,
      nay: nayUInt64,
      abstain: abstainUInt64,
    } = voteReducerPublicOutput;
    const yay = UInt128.from(yayUInt64);
    const nay = UInt128.from(nayUInt64);
    const abstain = UInt128.from(abstainUInt64);
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

    const treasuryOwnerBalance = treasuryOwnerAccount.balance;
    const { requiredApprovalBp, requiredParticipation } =
      TreasuryProposalSmartContract.calculateAcceptanceCriteria(
        UInt128.from(proposalAmount),
        UInt128.from(treasuryOwnerBalance),
        stakingEpochDataLedgerTotalCurrency,
      );
    const approvalStatus = TreasuryProposalSmartContract.calculateApprovalStatus({
      yay,
      nay,
      abstain,
      requiredParticipation,
      requiredApprovalBp,
    });

    provableLog("totalParticipatingVotes", {
      totalParticipatingVotes: approvalStatus.totalParticipatingVotes,
      requiredParticipation: approvalStatus.requiredParticipation,
      totalCurrency: stakingEpochDataLedgerTotalCurrency,
    });

    approvalStatus.participationMet.assertTrue("Participation not met");
    approvalStatus.hasApprovalVotes.assertTrue("No approval votes cast");

    // TODO: we could issue events here with details of the vote math
    this.status.set(approvalStatus.voteResult);
    return approvalStatus.voteResult;
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
