import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountUpdate,
  Bool,
  Field,
  Mina,
  PrivateKey,
  Reducer,
  UInt32,
  UInt64,
} from "o1js";
import {
  compileAuthorizationContracts,
  createOwnerProposalFixture,
  currentActionState,
  sendTransaction,
} from "../contracts/helpers.js";
import { Account } from "../../../src/provable/account.js";
import {
  LIFECYCLE_PERIOD_DURATION,
  TreasuryOwnerSmartContract,
} from "../../../src/provable/contracts/treasury-owner.js";
import {
  MultisigSignature,
  MultisigSignatures,
} from "../../../src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import {
  TreasuryPauseControllerErrors,
  TreasuryPauseControllerSmartContract,
} from "../../../src/provable/contracts/treasury-pause-controller/treasury-pause-controller.js";
import {
  ProposalStatus,
  TreasuryProposalSmartContract,
} from "../../../src/provable/contracts/treasury-proposal/treasury-proposal.js";
import {
  ActionStateHistory,
  ActionStateHistoryTarget,
  SideLoadedVoteReducerProof,
  Vote,
  VoteAction,
  VoteReducerPublicInput,
  VoteReducerPublicOutput,
} from "../../../src/provable/contracts/treasury-proposal/vote-reducer.js";
import { BOND_AMOUNT_DIVISOR } from "../../../src/provable/contracts/treasury-constants.js";
import { PrefixedMerkleWitness36 } from "../../../src/provable/merkle-tree/prefixed-merkle-tree.js";
import {
  SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
} from "../../../src/provable/staking-ledger-to-voting-ledger.js";

const pauseControllerKey = PrivateKey.fromBigInt(40_001n);
const multisigKeys = Array.from({ length: 5 }, (_, index) =>
  PrivateKey.fromBigInt(BigInt(40_100 + index)),
);

function multisigAuthorization(data: Field): MultisigSignatures {
  return new MultisigSignatures({
    signatures: multisigKeys.map((key, index) =>
      index < 3
        ? MultisigSignature.create(key, [data])
        : MultisigSignature.empty(),
    ),
  });
}

function actionHistory(hashes: readonly Field[]): {
  history: ActionStateHistory;
  target: ActionStateHistoryTarget;
} {
  assert.equal(hashes.length, 5, "the Proposal must have five action states");
  const target = new ActionStateHistoryTarget({
    actionStateOne: hashes[0]!,
    actionStateTwo: hashes[1]!,
    actionStateThree: hashes[2]!,
    actionStateFour: hashes[3]!,
    actionStateFive: hashes[4]!,
  });
  const history = new ActionStateHistory({
    actionStateOne: { hash: hashes[0]!, found: Bool(true) },
    actionStateTwo: { hash: hashes[1]!, found: Bool(true) },
    actionStateThree: { hash: hashes[2]!, found: Bool(true) },
    actionStateFour: { hash: hashes[3]!, found: Bool(true) },
    actionStateFive: { hash: hashes[4]!, found: Bool(true) },
  });
  return { history, target };
}

test(
  "E2E-LOCAL-001/002/003 completes one proof-off treasury lifecycle",
  { concurrency: 1 },
  async (t) => {
    assert.equal(
      process.env.PROOFS_ENABLED,
      "false",
      "this lane must run with PROOFS_ENABLED=false",
    );
    const proofsEnabled = String(process.env.PROOFS_ENABLED) === "true";
    await compileAuthorizationContracts(proofsEnabled);
    t.after(() => {
      TreasuryPauseControllerSmartContract.multisigParticipants = [];
    });

    const fixture = await createOwnerProposalFixture({ stakingSnapshot: true });
    const pauseController = new TreasuryPauseControllerSmartContract(
      pauseControllerKey.toPublicKey(),
    );
    const recipient = fixture.blockchain.testAccounts[3]!.key.toPublicKey();

    assert.equal(
      (await fixture.owner.pauseControllerPublicKey.fetch())?.toBase58(),
      pauseController.address.toBase58(),
    );
    assert.equal(
      (await fixture.proposal.status.fetch())?.toBigInt(),
      ProposalStatus.UNKNOWN.toBigInt(),
    );
    assert.equal(
      (await fixture.proposal.amount.fetch())?.toBigInt(),
      fixture.proposalAmount.toBigInt(),
    );
    assert.equal((await fixture.owner.fetchEvents()).length, 1);

    const voterCases = [
      { balance: 4_000_000_000n, key: 50_001n, vote: Vote.YAY },
      { balance: 2_000_000_000n, key: 50_002n, vote: Vote.YAY },
      { balance: 1_000_000_000n, key: 50_003n, vote: Vote.NAY },
      { balance: 500_000_000n, key: 50_004n, vote: Vote.ABSTRAIN },
      { balance: 250_000_000n, key: 50_005n, vote: Vote.ABSTRAIN },
    ].map((entry) => {
      const privateKey = PrivateKey.fromBigInt(entry.key);
      fixture.blockchain.addAccount(
        privateKey.toPublicKey(),
        entry.balance.toString(),
      );
      return { ...entry, privateKey };
    });

    const pauseNonce = UInt32.from(
      fixture.blockchain.getAccount(pauseController.address).nonce.toBigint(),
    );
    await sendTransaction(fixture.feePayer, async () => {
      await pauseController.pauseTreasury(
        multisigAuthorization(MultisigSignature.dataPauseTreasury(pauseNonce)),
        pauseNonce,
      );
    });
    assert.equal((await pauseController.paused.fetch())?.toBoolean(), true);

    const rejectedVoter = voterCases[0]!;
    const rejectedBefore = {
      actionState: currentActionState(fixture.blockchain, fixture.proposal),
      eventCount: (await fixture.owner.fetchEvents()).length,
      status: (await fixture.proposal.status.fetch())?.toBigInt(),
    };
    await assert.rejects(
      () =>
        sendTransaction(
          fixture.feePayer,
          async () => {
            await fixture.owner.vote(
              fixture.proposal.address,
              rejectedVoter.privateKey.toPublicKey(),
              rejectedVoter.vote,
            );
          },
          [rejectedVoter.privateKey],
        ),
      new RegExp(TreasuryPauseControllerErrors.TREASURY_PAUSED),
    );
    assert.deepEqual(
      {
        actionState: currentActionState(fixture.blockchain, fixture.proposal),
        eventCount: (await fixture.owner.fetchEvents()).length,
        status: (await fixture.proposal.status.fetch())?.toBigInt(),
      },
      rejectedBefore,
    );

    const unpauseNonce = UInt32.from(
      fixture.blockchain.getAccount(pauseController.address).nonce.toBigint(),
    );
    await sendTransaction(fixture.feePayer, async () => {
      await pauseController.unpauseTreasury(
        multisigAuthorization(
          MultisigSignature.dataUnpauseTreasury(unpauseNonce),
        ),
        unpauseNonce,
      );
    });
    assert.equal((await pauseController.paused.fetch())?.toBoolean(), false);

    for (const voter of voterCases) {
      fixture.blockchain.incrementGlobalSlot(1);
      await sendTransaction(
        fixture.feePayer,
        async () => {
          await fixture.owner.vote(
            fixture.proposal.address,
            voter.privateKey.toPublicKey(),
            voter.vote,
          );
        },
        [voter.privateKey],
      );
    }

    const actions = await Mina.getActions(
      fixture.proposal.address,
      {},
      fixture.proposalTokenId,
    );
    assert.equal(actions.length, voterCases.length);
    const decodedActions = actions.map((entry) =>
      VoteAction.fromFields(entry.actions[0]!.map((value) => Field(value))),
    );
    assert.deepEqual(
      decodedActions.map((action) => action.vote.toBigInt()).sort(),
      voterCases.map(({ vote }) => vote.toBigInt()).sort(),
    );
    assert.deepEqual(
      decodedActions.map((action) => action.publicKey.toBase58()).sort(),
      voterCases
        .map(({ privateKey }) => privateKey.toPublicKey().toBase58())
        .sort(),
    );

    const zkapp = fixture.blockchain.getAccount(
      fixture.proposal.address,
      fixture.proposalTokenId,
    ).zkapp;
    assert.ok(zkapp, "Proposal zkApp state is missing");
    const { history, target } = actionHistory(zkapp.actionState);
    for (const state of zkapp.actionState) {
      assert.notEqual(state.toBigInt(), Reducer.initialActionState.toBigInt());
    }

    const yay = voterCases
      .filter(({ vote }) => vote.equals(Vote.YAY).toBoolean())
      .reduce((sum, { balance }) => sum + balance, 0n);
    const nay = voterCases
      .filter(({ vote }) => vote.equals(Vote.NAY).toBoolean())
      .reduce((sum, { balance }) => sum + balance, 0n);
    const abstain = voterCases
      .filter(({ vote }) => vote.equals(Vote.ABSTRAIN).toBoolean())
      .reduce((sum, { balance }) => sum + balance, 0n);
    const votingLedgerRoot = Field(50_200);
    const voteInput = new VoteReducerPublicInput({
      actionStateHistoryTarget: target,
      fromActionsHash: Reducer.initialActionState,
      fromNullifierRoot: TreasuryProposalSmartContract.emptyNullifierRoot,
      votingLedgerRoot,
    });
    const voteOutput = new VoteReducerPublicOutput({
      abstain: UInt64.from(abstain),
      actionStateHistory: history,
      nay: UInt64.from(nay),
      toActionsHash: history.actionStateOne.hash,
      toNullifierRoot: Field(50_201),
      yay: UInt64.from(yay),
    });
    const voteProof = (await SideLoadedVoteReducerProof.dummy(
      voteInput,
      voteOutput,
      2,
    )) as SideLoadedVoteReducerProof;

    const stakingInput = new StakingLedgerToVotingLedgerProgramInput({
      index: UInt64.from(0),
      stakingLedgerRoot: fixture.stakingLedgerRoot!,
      votingLedgerRoot: TreasuryProposalSmartContract.emptyVotingLedgerRoot,
    });
    const stakingOutput = new StakingLedgerToVotingLedgerProgramOutput({
      exhausted: Bool(true),
      index: UInt64.from(voterCases.length),
      votingLedgerRoot,
    });
    const stakingProof =
      (await SideLoadedStakingLedgerToVotingLedgerProof.dummy(
        stakingInput,
        stakingOutput,
        2,
      )) as SideLoadedStakingLedgerToVotingLedgerProof;

    fixture.blockchain.incrementGlobalSlot(LIFECYCLE_PERIOD_DURATION);
    await sendTransaction(fixture.feePayer, async () => {
      await fixture.owner.tallyVotes(
        fixture.proposal.address,
        voteProof,
        stakingProof,
        fixture.treasurySnapshotAccount as Account,
        new PrefixedMerkleWitness36(fixture.treasurySnapshotWitness!),
      );
    });
    assert.equal(
      (await fixture.proposal.status.fetch())?.toBigInt(),
      ProposalStatus.APPROVED.toBigInt(),
    );

    fixture.blockchain.incrementGlobalSlot(LIFECYCLE_PERIOD_DURATION);
    const amountWithBond = fixture.proposalAmount.add(
      fixture.proposalAmount.div(BOND_AMOUNT_DIVISOR),
    );
    const beforeExecution = {
      owner: fixture.blockchain.getAccount(fixture.owner.address).balance,
      paidOut: (await fixture.proposal.paidOutAmount.fetch())!,
      recipient: fixture.blockchain.getAccount(recipient).balance,
    };
    await sendTransaction(fixture.feePayer, async () => {
      await fixture.owner.executeProposal(
        fixture.proposal.address,
        recipient,
        amountWithBond,
      );
    });
    assert.equal(
      fixture.blockchain.getAccount(fixture.owner.address).balance.toBigInt(),
      beforeExecution.owner.sub(amountWithBond).toBigInt(),
    );
    assert.equal(
      fixture.blockchain.getAccount(recipient).balance.toBigInt(),
      beforeExecution.recipient.add(amountWithBond).toBigInt(),
    );
    assert.equal(
      (await fixture.proposal.paidOutAmount.fetch())?.toBigInt(),
      beforeExecution.paidOut.add(amountWithBond).toBigInt(),
    );

    const events = await fixture.owner.fetchEvents();
    const eventTypes = events.map(({ type }) => type);
    assert.equal(
      eventTypes.filter((type) => type === "proposalCreated").length,
      1,
    );
    assert.equal(
      eventTypes.filter((type) => type === "proposalVoteDispatched").length,
      voterCases.length,
    );
    assert.equal(
      eventTypes.filter((type) => type === "proposalVotesTallied").length,
      1,
    );
    assert.equal(
      eventTypes.filter((type) => type === "proposalExecuted").length,
      1,
    );
    assert.equal(events.length, voterCases.length + 3);
    assert.equal(
      (await fixture.proposal.status.fetch())?.toBigInt(),
      ProposalStatus.APPROVED.toBigInt(),
    );
    assert.equal(
      (await fixture.owner.treasuryDeployedAtSlot.fetch())?.toBigint(),
      TreasuryOwnerSmartContract.treasuryDeployedAtSlot.toBigint(),
    );
  },
);
