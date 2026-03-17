import {
  AccountUpdate,
  AccountUpdateForest,
  Bool,
  Field,
  Permissions,
  Poseidon,
  Provable,
  PublicKey,
  State,
  TokenContract,
  UInt32,
  UInt64,
  method,
  state,
} from "o1js";
import { Account } from "../account.js";
import { PrefixedMerkleWitness36 } from "../merkle-tree/prefixed-merkle-tree.js";
import {
  ActionStateHistory,
  SideLoadedVoteReducerProof,
  Vote,
} from "./treasury-proposal/vote-reducer.js";
import { TreasuryProposalSmartContract } from "./treasury-proposal/treasury-proposal.js";
import { SideLoadedStakingLedgerToVotingLedgerProof } from "../staking-ledger-to-voting-ledger.js";
import { Proposal } from "./treasury-proposal/treasury-proposal.js";
import { BOND_AMOUNT_DIVISOR } from "./treasury-constants.js";
import { TreasuryPauseControllerSmartContract } from "./treasury-pause-controller/treasury-pause-controller.js";
import {
  MultisigSignature,
  MultisigSignatures,
} from "./treasury-pause-controller/multisig-signatures.js";

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

  public static permissions = {
    ...Permissions.allImpossible(),
    editState: Permissions.proof(),
    access: Permissions.proof(),
    incrementNonce: Permissions.proof(),
    setVerificationKey:
      Permissions.VerificationKey.impossibleDuringCurrentVersion(),
  };

  @state(UInt32) treasuryDeployedAtSlot = State<UInt32>();
  @state(PublicKey) pauseControllerPublicKey = State<PublicKey>();

  // TODO: we dont need these state variables anymore
  @state(Field) stakingEpochDataLedgerHash = State<Field>();
  @state(UInt64) stakingEpochDataLedgerTotalCurrency = State<UInt64>();

  public async snapshotStakingEpochData() {
    const networkStakingEpochDataLedgerHash =
      this.network.stakingEpochData.ledger.hash.getAndRequireEquals();
    const networkStakingEpochDataLedgerTotalCurrency =
      this.network.stakingEpochData.ledger.totalCurrency.getAndRequireEquals();

    this.stakingEpochDataLedgerHash.set(networkStakingEpochDataLedgerHash);
    this.stakingEpochDataLedgerTotalCurrency.set(
      networkStakingEpochDataLedgerTotalCurrency,
    );

    return {
      stakingEpochDataLedgerHash: networkStakingEpochDataLedgerHash,
      stakingEpochDataLedgerTotalCurrency:
        networkStakingEpochDataLedgerTotalCurrency,
    };
  }

  public init() {
    super.init();
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

  public async requireLifecyclePeriod(
    period: LifecyclePeriod,
    lifecycleId: UInt32,
    // used if a lifecycle period has no upper bound, e.g. to allow
    // tallying votes / execution anytime after the cooldown period
    noUpperBoundToSlot: Bool = Bool(false),
  ) {
    const treasuryDeployedAtSlot =
      this.treasuryDeployedAtSlot.getAndRequireEquals();

    Provable.log(
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

    Provable.log(
      "requireLifecyclePeriod",
      period,
      lifecycleId,
      fromSlot,
      toSlot,
    );

    this.network.globalSlotSinceGenesis.requireBetween(fromSlot, toSlot);
  }

  @method
  public async createProposal(
    proposalPublicKey: PublicKey,
    proposal: Proposal,
    lifecycleId: UInt32,
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
      TreasuryProposalSmartContract._verificationKey,
    );

    proposalUpdate.account.permissions.set(Permissions.default());
    // }

    // proposalUpdate.update.zkappUri.isSome = Bool(true);
    // proposalUpdate.update.zkappUri.value = ZkappUri.from(proposal.zkAppUri);

    this.approve(proposalUpdate);
  }

  // TODO: implement some form of a spam prevention, e.g.: requiring the voter to:
  // exist in the voting ledger with a delegated balance > 0
  @method
  public async vote(
    proposalPublicKey: PublicKey,
    publicKey: PublicKey,
    vote: Vote,
  ) {
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
    Provable.log("tallyVotes", { proposalLifecycleId });

    await this.requireLifecyclePeriodGreaterThanOrEqual(
      LifecyclePeriod.COOLDOWN,
      proposalLifecycleId,
    );

    // TODO: is this safe and correct?
    const treasuryOwnerPublicKey = this.self.publicKey;

    voteReducerProof.publicOutput.toActionsHash
      .equals(
        voteReducerProof.publicOutput.actionStateHistory.actionStateOne.hash,
      )
      .assertTrue("toActionsHash does not match action state one hash");

    await proposal.tallyVotes(
      voteReducerProof,
      stakingLedgerToVotingLedgerProof,
      treasuryOwnerPublicKey,
      treasuryOwnerAccount,
      treasuryOwnerAccountWitness,
    );

    this.approve(proposal.self);
  }

  @method
  public async commitActionState(
    voteReducerProof: SideLoadedVoteReducerProof,
    proposalPublicKey: PublicKey,
  ) {
    voteReducerProof.verify(
      TreasuryProposalSmartContract.voteReducerVerificationKey,
    );

    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      this.deriveTokenId(),
    );
    const proposalLifecycleId = await proposal.getLifecycleId();
    Provable.log("tallyVotes", { proposalLifecycleId });

    await this.requireLifecyclePeriodGreaterThanOrEqual(
      LifecyclePeriod.COOLDOWN,
      proposalLifecycleId,
    );

    // must be done here in order to approve the "child" account updates directly
    for (const actionStateKey of Object.keys(
      voteReducerProof.publicOutput.actionStateHistory,
    )) {
      const actionStateUpdate = AccountUpdate.create(
        proposalPublicKey,
        this.deriveTokenId(),
      );
      const actionState: ActionStateHistory["actionStateOne"] =
        voteReducerProof.publicOutput.actionStateHistory[actionStateKey];

      actionStateUpdate.account.actionState.requireEquals(actionState.hash);
      actionState.found.assertTrue("Action state not found in the merkle list");

      this.approve(actionStateUpdate);
    }

    await proposal.commitActionState(
      voteReducerProof.publicOutput.toActionsHash,
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
    Provable.log("executeProposal", { proposalLifecycleId });

    await this.requireLifecyclePeriodGreaterThanOrEqual(
      LifecyclePeriod.PROPOSAL,
      // only allow execution of proposals from the previous lifecycle
      proposalLifecycleId.add(1),
    );

    this.self.balance.subInPlace(amountToPayOut);

    await proposal.execute(amountToPayOut, recipient);

    if (TreasuryProposalSmartContract.permissionType == "signature") {
      proposal.self.requireSignature();
    }

    this.approve(proposal.self);
  }

  @method
  public async togglePauseProposal(
    proposalPublicKey: PublicKey,
    signatures: MultisigSignatures,
    nonce: UInt32,
  ) {
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
