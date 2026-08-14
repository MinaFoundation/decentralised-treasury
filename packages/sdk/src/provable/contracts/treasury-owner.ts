import {
  AccountUpdate,
  AccountUpdateForest,
  Bool,
  Field,
  Permissions,
  Poseidon,
  Provable,
  PublicKey,
  Reducer,
  State,
  TokenContract,
  UInt32,
  UInt64,
  method,
  state,
} from "o1js";
import { provableLog } from "../../logging/logger.js";
import { Account } from "../account.js";
import { PrefixedMerkleWitness36 } from "../merkle-tree/prefixed-merkle-tree.js";
import {
  ActionStateHistory,
  SideLoadedVoteReducerProof,
  Vote,
} from "./treasury-proposal/vote-reducer.js";
import {
  ProposalStatus,
  TreasuryProposalSmartContract,
} from "./treasury-proposal/treasury-proposal.js";
import { SideLoadedStakingLedgerToVotingLedgerProof } from "../staking-ledger-to-voting-ledger.js";
import { Proposal } from "./treasury-proposal/treasury-proposal.js";
import { BOND_AMOUNT_DIVISOR } from "./treasury-constants.js";
import { TreasuryPauseControllerSmartContract } from "./treasury-pause-controller/treasury-pause-controller.js";
import {
  MultisigSignature,
  MultisigSignatures,
} from "./treasury-pause-controller/multisig-signatures.js";
import {
  ProposalCreatedEvent,
  PROPOSAL_CREATED_EVENT_NAME,
  ProposalExecutedEvent,
  PROPOSAL_EXECUTED_EVENT_NAME,
  ProposalPauseToggledEvent,
  PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
  ProposalVoteDispatchedEvent,
  PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
  ProposalVotesTalliedEvent,
  PROPOSAL_VOTES_TALLIED_EVENT_NAME,
} from "../events/treasury-proposal-events.js";

// 7140 slots = ~2 weeks, this is the mainnet configuration
export const LIFECYCLE_PERIOD_DURATION = UInt32.from(7140);

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

  public static lifecyclePeriodDuration = LIFECYCLE_PERIOD_DURATION;
  public static treasuryDeployedAtSlot: UInt32;
  public static pauseControllerPublicKey: PublicKey;

  public static permissions: Permissions = {
    ...Permissions.allImpossible(),
    editState: Permissions.proof(),
    access: Permissions.proof(),
    incrementNonce: Permissions.proofOrSignature(),
    setVerificationKey:
      Permissions.VerificationKey.impossibleDuringCurrentVersion(),
    send: Permissions.proof(),
    receive: Permissions.proof(),
  };

  @state(UInt32) treasuryDeployedAtSlot = State<UInt32>();
  @state(PublicKey) pauseControllerPublicKey = State<PublicKey>();

  events = {
    [PROPOSAL_CREATED_EVENT_NAME]: ProposalCreatedEvent,
    [PROPOSAL_VOTE_DISPATCHED_EVENT_NAME]: ProposalVoteDispatchedEvent,
    [PROPOSAL_VOTES_TALLIED_EVENT_NAME]: ProposalVotesTalliedEvent,
    [PROPOSAL_EXECUTED_EVENT_NAME]: ProposalExecutedEvent,
    [PROPOSAL_PAUSE_TOGGLED_EVENT_NAME]: ProposalPauseToggledEvent,
  };

  public async snapshotStakingEpochData() {
    const networkStakingEpochDataLedgerHash =
      this.network.stakingEpochData.ledger.hash.getAndRequireEquals();
    const networkStakingEpochDataLedgerTotalCurrency =
      this.network.stakingEpochData.ledger.totalCurrency.getAndRequireEquals();

    return {
      stakingEpochDataLedgerHash: networkStakingEpochDataLedgerHash,
      stakingEpochDataLedgerTotalCurrency:
        networkStakingEpochDataLedgerTotalCurrency,
    };
  }

  public async deploy() {
    await super.deploy();
    this.account.permissions.set(TreasuryOwnerSmartContract.permissions);
    this.treasuryDeployedAtSlot.set(
      TreasuryOwnerSmartContract.treasuryDeployedAtSlot,
    );
    this.pauseControllerPublicKey.set(
      TreasuryOwnerSmartContract.pauseControllerPublicKey,
    );
  }

  public async requireLifecyclePeriodGreaterThanOrEqual(
    period: LifecyclePeriod,
    lifecycleId: UInt32,
  ) {
    await this.requireLifecyclePeriod(period, lifecycleId, Bool(true));
  }

  public async getLifecyclePeriodSlotRange(
    period: LifecyclePeriod,
    lifecycleId: UInt32,
    // used if a lifecycle period has no upper bound, e.g. to allow
    // tallying votes / execution anytime after the cooldown period
    noUpperBoundToSlot: Bool = Bool(false),
  ) {
    const treasuryDeployedAtSlot =
      this.treasuryDeployedAtSlot.getAndRequireEquals();

    provableLog(
      "requireLifecyclePeriod",
      TreasuryOwnerSmartContract.lifecyclePeriodDuration,
    );

    const fromSlot = treasuryDeployedAtSlot
      // fast forward to the start of the requested lifecycle
      .add(
        TreasuryOwnerSmartContract.lifecyclePeriodDuration.mul(
          LifecyclePeriod.NUMBER_OF_PERIODS.mul(lifecycleId),
        ),
      )
      // fast forward to the start of the requested period
      .add(TreasuryOwnerSmartContract.lifecyclePeriodDuration.mul(period));

    const toSlot = Provable.if(
      noUpperBoundToSlot,
      UInt32.MAXINT(),
      fromSlot.add(TreasuryOwnerSmartContract.lifecyclePeriodDuration),
    );

    return { fromSlot, toSlot };
  }

  public async requireLifecyclePeriod(
    period: LifecyclePeriod,
    lifecycleId: UInt32,
    // used if a lifecycle period has no upper bound, e.g. to allow
    // tallying votes / execution anytime after the cooldown period
    noUpperBoundToSlot: Bool = Bool(false),
  ) {
    const { fromSlot, toSlot } = await this.getLifecyclePeriodSlotRange(
      period,
      lifecycleId,
      noUpperBoundToSlot,
    );

    provableLog(
      "requireLifecyclePeriod",
      period,
      lifecycleId,
      fromSlot,
      toSlot,
    );

    this.network.globalSlotSinceGenesis.requireBetween(fromSlot, toSlot);
  }

  @method
  public async receive(amount: UInt64) {
    this.self.balance.addInPlace(amount);
  }

  @method
  public async createProposal(
    proposalPublicKey: PublicKey,
    proposal: Proposal,
    lifecycleId: UInt32,
  ) {
    provableLog("createProposal", { lifecycleId });

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
      this.deriveTokenId(),
    );

    // TODO: find a way to deploy here using "new TreasuryProposalSmartContract" instead
    const recipientHash = Poseidon.hash(proposal.recipient.toFields());
    proposalUpdate.update.appState = [
      {
        isSome: Bool(true),
        value: recipientHash,
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
        isSome: Bool(true),
        value: Field(0),
      },
      // remainder of the 32 app state fields
      ...Array(26).fill({ isSome: Bool(false), value: Field(0) }),
    ];

    proposalUpdate.account.verificationKey.set(
      // non-null: TreasuryProposalSmartContract.compile() runs before any
      // account update that references it, populating this cache.
      TreasuryProposalSmartContract._verificationKey!,
    );

    proposalUpdate.account.permissions.set(Permissions.default());

    proposalUpdate.update.zkappUri.isSome = Bool(true);
    proposalUpdate.update.zkappUri.value = proposal.zkAppUri;

    const senderPublicKey = this.sender.getAndRequireSignature();
    this.approve(proposalUpdate);
    this.emitEvent(
      PROPOSAL_CREATED_EVENT_NAME,
      new ProposalCreatedEvent({
        proposalPublicKey,
        lifecycleId,
        amount: proposal.amount,
        recipient: proposal.recipient,
        proposerPublicKey: senderPublicKey,
        senderPublicKey,
        zkAppUriHash: proposal.zkAppUri.hash,
        stakingEpochDataLedgerHash,
        stakingEpochDataLedgerTotalCurrency,
      }),
    );
  }

  // TODO: implement some form of a spam prevention, e.g.: requiring the voter to:
  // exist in the voting ledger with a delegated balance > 0
  @method
  public async vote(
    proposalPublicKey: PublicKey,
    publicKey: PublicKey,
    vote: Vote,
  ) {
    const senderPublicKey = this.sender.getAndRequireSignature();
    await this.requireNotPaused();
    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      this.deriveTokenId(),
    );

    const proposalLifecycleId = await proposal.getLifecycleId();
    await this.requireLifecyclePeriod(
      LifecyclePeriod.VOTING,
      proposalLifecycleId,
    );

    Vote.assertValid(vote);

    await proposal.vote({
      vote,
      publicKey,
    });

    this.emitEvent(
      PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
      new ProposalVoteDispatchedEvent({
        proposalPublicKey,
        voterPublicKey: publicKey,
        vote,
        senderPublicKey,
      }),
    );

    // this creates a new account if it doesnt exist, it'll cost 1 MINA
    // it could be free if we just check a hand crafted signature instead
    // this becomes relevant if a delegate public key is used that is not in the current L1 ledger
    AccountUpdate.createSigned(publicKey);

    this.approve(proposal.self);
  }

  @method
  public async tallyVotes(
    proposalPublicKey: PublicKey,
    voteReducerProof: SideLoadedVoteReducerProof,
    stakingLedgerToVotingLedgerProof: SideLoadedStakingLedgerToVotingLedgerProof,
    treasuryOwnerAccount: Account,
    treasuryOwnerAccountWitness: PrefixedMerkleWitness36,
  ) {
    const senderPublicKey = this.sender.getAndRequireSignature();
    await this.requireNotPaused();
    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      this.deriveTokenId(),
    );

    // proofs need to be verified at the top level here, not only in the nested proposal.tallyVotes method
    voteReducerProof.verify(
      TreasuryProposalSmartContract.voteReducerVerificationKey,
    );

    stakingLedgerToVotingLedgerProof.verify(
      TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey,
    );

    const proposalLifecycleId = await proposal.getLifecycleId();

    await this.requireLifecyclePeriodGreaterThanOrEqual(
      LifecyclePeriod.COOLDOWN,
      proposalLifecycleId,
    );

    // TODO: is this safe and correct?
    const treasuryOwnerPublicKey = this.self.publicKey;

    const actionStateHistory = voteReducerProof.publicOutput.actionStateHistory;
    const actionStates: ActionStateHistory["actionStateOne"][] = [
      actionStateHistory.actionStateOne,
      actionStateHistory.actionStateTwo,
      actionStateHistory.actionStateThree,
      actionStateHistory.actionStateFour,
      actionStateHistory.actionStateFive,
    ];

    for (let actionStateIndex = 0; actionStateIndex < actionStates.length; actionStateIndex++) {
      const actionStateUpdate = AccountUpdate.create(
        proposalPublicKey,
        this.deriveTokenId(),
      );
      const actionState = actionStates[actionStateIndex]!;

      actionStateUpdate.account.actionState.requireEquals(actionState.hash);
      actionState.found.assertTrue("Action state not found in the merkle list");

      actionState.hash
        .equals(Reducer.initialActionState)
        .not()
        .assertTrue(
          "Action state hash must not be the initial action state",
        );

      for (
        let compareIndex = actionStateIndex + 1;
        compareIndex < actionStates.length;
        compareIndex++
      ) {
        actionState.hash
          .equals(actionStates[compareIndex]!.hash)
          .not()
          .assertTrue("Action state hashes must be unique");
      }

      this.approve(actionStateUpdate);
    }

    const voteResult = await proposal.tallyVotes(
      voteReducerProof,
      stakingLedgerToVotingLedgerProof,
      treasuryOwnerPublicKey,
      treasuryOwnerAccount,
      treasuryOwnerAccountWitness,
    );

    const yayWeight = voteReducerProof.publicOutput.yay;
    const nayWeight = voteReducerProof.publicOutput.nay;
    const abstainWeight = voteReducerProof.publicOutput.abstain;
    this.emitEvent(
      PROPOSAL_VOTES_TALLIED_EVENT_NAME,
      new ProposalVotesTalliedEvent({
        proposalPublicKey,
        lifecycleId: proposalLifecycleId,
        yayWeight,
        nayWeight,
        abstainWeight,
        voteResult,
        senderPublicKey,
      }),
    );

    this.approve(proposal.self);
  }

  @method
  public async executeProposal(
    proposalPublicKey: PublicKey,
    recipient: PublicKey,
    amountToPayOut: UInt64,
  ) {
    await this.requireNotPaused();
    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      this.deriveTokenId(),
    );

    const proposalLifecycleId = await proposal.getLifecycleId();
    provableLog("executeProposal", { proposalLifecycleId });

    await this.requireLifecyclePeriodGreaterThanOrEqual(
      LifecyclePeriod.PROPOSAL,
      // only allow execution of proposals from the previous lifecycle
      proposalLifecycleId.add(1),
    );

    const senderPublicKey = this.sender.getAndRequireSignature();

    this.self.balance.subInPlace(amountToPayOut);

    await proposal.execute(amountToPayOut, recipient);

    if (TreasuryProposalSmartContract.permissionType == "signature") {
      proposal.self.requireSignature();
    }

    this.emitEvent(
      PROPOSAL_EXECUTED_EVENT_NAME,
      new ProposalExecutedEvent({
        proposalPublicKey,
        amountToPayOut,
        senderPublicKey,
      }),
    );

    this.approve(proposal.self);
  }

  @method
  public async togglePauseProposal(
    proposalPublicKey: PublicKey,
    signatures: MultisigSignatures,
    nonce: UInt32,
    paused: Bool,
  ) {
    const senderPublicKey = this.sender.getAndRequireSignature();
    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      this.deriveTokenId(),
    );
    const pauseController = new TreasuryPauseControllerSmartContract(
      this.pauseControllerPublicKey.getAndRequireEquals(),
    );

    await pauseController.togglePauseProposal(
      proposalPublicKey,
      signatures,
      nonce,
    );

    await proposal.togglePause();
    this.emitEvent(
      PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
      new ProposalPauseToggledEvent({
        proposalPublicKey,
        paused,
        senderPublicKey,
      }),
    );
    this.approve(proposal.self);
  }

  public async requireNotPaused() {
    const pauseController = new TreasuryPauseControllerSmartContract(
      this.pauseControllerPublicKey.getAndRequireEquals(),
    );
    await pauseController.requireNotPaused();
  }

  public async approveBase(updates: AccountUpdateForest) {
    this.forEachUpdate(updates, (update, usesToken) => {
      usesToken.assertFalse(
        "No external account updates allowed for this token",
      );
    });
  }
}
