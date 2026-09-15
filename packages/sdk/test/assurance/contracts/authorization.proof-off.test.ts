import assert from "node:assert/strict";
import test from "node:test";
import { Bool, Field, Mina, Reducer, TokenId, UInt32, UInt64 } from "o1js";
import { PrefixedMerkleWitness36 } from "../../../src/provable/merkle-tree/prefixed-merkle-tree.js";
import {
  SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
} from "../../../src/provable/staking-ledger-to-voting-ledger.js";
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
import {
  compileAuthorizationContracts,
  createOwnerProposalFixture,
  createStandaloneProposalFixture,
  currentActionState,
  sendTransaction,
} from "./helpers.js";

test(
  "proof-off contract authorization assurance",
  { concurrency: 1 },
  async (t) => {
    assert.equal(
      process.env.PROOFS_ENABLED,
      "false",
      "this lane must run with PROOFS_ENABLED=false",
    );
    const proofsEnabled = String(process.env.PROOFS_ENABLED) === "true";
    await compileAuthorizationContracts(proofsEnabled);

    await t.test(
      "SC-OWNER-011/012/013 records sender-to-voter signature behavior",
      async () => {
        const cases = [
          { name: "sender is voter", senderIndex: 1, voterIndex: 1 },
          { name: "sender differs", senderIndex: 1, voterIndex: 2 },
        ] as const;

        for (const testCase of cases) {
          const fixture = await createOwnerProposalFixture();
          const sender = fixture.blockchain.testAccounts[testCase.senderIndex]!;
          const voter = fixture.blockchain.testAccounts[testCase.voterIndex]!;
          const additionalKeys =
            testCase.senderIndex === testCase.voterIndex ? [] : [voter.key];

          await sendTransaction(
            sender,
            async () => {
              await fixture.owner.vote(
                fixture.proposal.address,
                voter.key.toPublicKey(),
                Vote.YAY,
              );
            },
            additionalKeys,
          );

          const actions = await Mina.getActions(
            fixture.proposal.address,
            {},
            fixture.proposalTokenId,
          );
          assert.equal(actions.length, 1, testCase.name);
          const voteAction = VoteAction.fromFields(
            actions[0]!.actions[0]!.map((value) => Field(value)),
          );
          assert.equal(voteAction.vote.toBigInt(), Vote.YAY.toBigInt());
          assert.equal(
            voteAction.publicKey.toBase58(),
            voter.key.toPublicKey().toBase58(),
          );
        }
      },
    );

    await t.test(
      "SC-OWNER-014 rejects a separate voter without the voter signature and keeps actions unchanged",
      async () => {
        const fixture = await createOwnerProposalFixture();
        const sender = fixture.blockchain.testAccounts[1]!;
        const voter = fixture.blockchain.testAccounts[2]!;
        const before = currentActionState(fixture.blockchain, fixture.proposal);

        await assert.rejects(() =>
          sendTransaction(sender, async () => {
            await fixture.owner.vote(
              fixture.proposal.address,
              voter.key.toPublicKey(),
              Vote.YAY,
            );
          }),
        );

        assert.equal(
          currentActionState(fixture.blockchain, fixture.proposal),
          before,
        );
        assert.equal(
          (
            await Mina.getActions(
              fixture.proposal.address,
              {},
              fixture.proposalTokenId,
            )
          ).length,
          0,
        );
      },
    );

    await t.test(
      "SC-OWNER-015 lets two senders dispatch one voter identity twice",
      async () => {
        const fixture = await createOwnerProposalFixture();
        const voter = fixture.blockchain.testAccounts[3]!;
        const senders = [
          fixture.blockchain.testAccounts[1]!,
          fixture.blockchain.testAccounts[2]!,
        ];

        for (const [index, vote] of [Vote.YAY, Vote.NAY].entries()) {
          await sendTransaction(
            senders[index]!,
            async () => {
              await fixture.owner.vote(
                fixture.proposal.address,
                voter.key.toPublicKey(),
                vote,
              );
            },
            [voter.key],
          );
        }

        const actions = await Mina.getActions(
          fixture.proposal.address,
          {},
          fixture.proposalTokenId,
        );
        assert.equal(actions.length, 2);
        assert.deepEqual(
          actions.map((entry) =>
            VoteAction.fromFields(
              entry.actions[0]!.map((value) => Field(value)),
            ).vote.toBigInt(),
          ),
          [Vote.YAY.toBigInt(), Vote.NAY.toBigInt()],
        );
      },
    );

    await t.test(
      "SC-OWNER-012 characterizes DUMMY with a real voter key",
      async () => {
        const fixture = await createOwnerProposalFixture();
        const voter = fixture.blockchain.testAccounts[1]!;

        await sendTransaction(voter, async () => {
          await fixture.owner.vote(
            fixture.proposal.address,
            voter.key.toPublicKey(),
            Vote.DUMMY,
          );
        });

        const actions = await Mina.getActions(
          fixture.proposal.address,
          {},
          fixture.proposalTokenId,
        );
        const dispatched = VoteAction.fromFields(
          actions[0]!.actions[0]!.map((value) => Field(value)),
        );
        assert.equal(dispatched.vote.toBigInt(), Vote.DUMMY.toBigInt());
        assert.equal(
          dispatched.publicKey.toBase58(),
          voter.key.toPublicKey().toBase58(),
        );
        assert.equal(VoteAction.isDummy(dispatched).toBoolean(), false);
      },
    );

    await t.test(
      "SC-PROPOSAL-007 accepts an exact DUMMY action at the public entry point",
      async () => {
        const fixture = await createStandaloneProposalFixture();

        await sendTransaction(fixture.feePayer, async () => {
          await fixture.proposal.vote(VoteAction.dummy());
        });

        const actions = await Mina.getActions(
          fixture.proposal.address,
          {},
          TokenId.default,
        );
        assert.equal(actions.length, 1);
        assert.equal(
          VoteAction.isDummy(
            VoteAction.fromFields(
              actions[0]!.actions[0]!.map((value) => Field(value)),
            ),
          ).toBoolean(),
          true,
        );
      },
    );

    await t.test(
      "SC-PROPOSAL-001/004 reject direct custom-token mutation through Owner approval and preserve state",
      async () => {
        const fixture = await createOwnerProposalFixture();
        const sender = fixture.blockchain.testAccounts[1]!;
        const voter = fixture.blockchain.testAccounts[2]!;
        const initialStatus = await fixture.proposal.status.fetch();
        const initialActionState = currentActionState(
          fixture.blockchain,
          fixture.proposal,
        );
        const directCases = [
          {
            name: "vote",
            call: async () => {
              await fixture.proposal.vote(
                new VoteAction({
                  vote: Vote.YAY,
                  publicKey: voter.key.toPublicKey(),
                }),
              );
            },
          },
          {
            name: "togglePause",
            call: async () => fixture.proposal.togglePause(),
          },
        ];

        for (const directCase of directCases) {
          await assert.rejects(
            () =>
              sendTransaction(sender, async () => {
                await directCase.call();
                await fixture.owner.approveAccountUpdate(fixture.proposal.self);
              }),
            /No external account updates allowed for this token/,
            directCase.name,
          );
          assert.equal(
            currentActionState(fixture.blockchain, fixture.proposal),
            initialActionState,
            directCase.name,
          );
          assert.equal(
            (await fixture.proposal.status.fetch())!.toString(),
            initialStatus!.toString(),
            directCase.name,
          );
        }
      },
    );

    await t.test(
      "SC-PROPOSAL-003 rejects direct execution before approval and preserves paidOutAmount",
      async () => {
        const fixture = await createOwnerProposalFixture();
        const sender = fixture.blockchain.testAccounts[1]!;
        const recipient = fixture.blockchain.testAccounts[3]!.key.toPublicKey();
        const before = await fixture.proposal.paidOutAmount.fetch();

        await assert.rejects(
          () =>
            sendTransaction(sender, async () => {
              await fixture.proposal.execute(UInt64.from(1), recipient);
              await fixture.owner.approveAccountUpdate(fixture.proposal.self);
            }),
          /Proposal not approved/,
        );

        assert.equal(
          (await fixture.proposal.paidOutAmount.fetch())!.toBigInt(),
          before!.toBigInt(),
        );
        assert.equal(
          (await fixture.proposal.status.fetch())!.toString(),
          ProposalStatus.UNKNOWN.toString(),
        );
      },
    );

    await t.test(
      "SC-PROPOSAL-006 rejects the wrong-token Proposal path and preserves the custom-token state",
      async () => {
        const fixture = await createOwnerProposalFixture();
        const sender = fixture.blockchain.testAccounts[1]!;
        const wrongTokenProposal = new TreasuryProposalSmartContract(
          fixture.proposal.address,
          TokenId.default,
        );
        const before = await fixture.proposal.status.fetch();

        await assert.rejects(() =>
          sendTransaction(sender, async () => {
            await wrongTokenProposal.togglePause();
          }),
        );

        assert.equal(
          (await fixture.proposal.status.fetch())!.toString(),
          before!.toString(),
        );
      },
    );

    await t.test(
      "ZK-VOTE-HISTORY-002 rejects a tally with a target marked not found and preserves status",
      async () => {
        const fixture = await createOwnerProposalFixture({
          stakingSnapshot: true,
        });
        fixture.blockchain.incrementGlobalSlot(UInt32.from(7_140));
        const target = new ActionStateHistoryTarget({
          actionStateOne: Field(91),
          actionStateTwo: Field(92),
          actionStateThree: Field(93),
          actionStateFour: Field(94),
          actionStateFive: Field(95),
        });
        const voteInput = new VoteReducerPublicInput({
          fromActionsHash: Reducer.initialActionState,
          votingLedgerRoot: Field(0),
          fromNullifierRoot: Field(0),
          actionStateHistoryTarget: target,
        });
        const voteOutput = new VoteReducerPublicOutput({
          toActionsHash: target.actionStateOne,
          toNullifierRoot: Field(0),
          yay: UInt64.from(5_000_000_000),
          nay: UInt64.from(0),
          abstain: UInt64.from(0),
          actionStateHistory: ActionStateHistory.fromTarget(target),
        });
        const voteProof = (await SideLoadedVoteReducerProof.dummy(
          voteInput,
          voteOutput,
          2,
        )) as SideLoadedVoteReducerProof;
        const stakingInput = new StakingLedgerToVotingLedgerProgramInput({
          index: UInt64.from(0),
          stakingLedgerRoot: fixture.stakingLedgerRoot!,
          votingLedgerRoot: Field(0),
        });
        const stakingOutput = new StakingLedgerToVotingLedgerProgramOutput({
          index: UInt64.from(0),
          votingLedgerRoot: Field(0),
          exhausted: Bool(true),
        });
        const stakingProof =
          (await SideLoadedStakingLedgerToVotingLedgerProof.dummy(
            stakingInput,
            stakingOutput,
            2,
          )) as SideLoadedStakingLedgerToVotingLedgerProof;
        const treasuryWitness = new PrefixedMerkleWitness36(
          fixture.treasurySnapshotWitness!,
        );
        const before = await fixture.proposal.status.fetch();

        await assert.rejects(
          () =>
            sendTransaction(fixture.feePayer, async () => {
              await fixture.owner.tallyVotes(
                fixture.proposal.address,
                voteProof,
                stakingProof,
                fixture.treasurySnapshotAccount!,
                treasuryWitness,
              );
            }),
          /Action state not found in the merkle list/,
        );

        assert.equal(
          (await fixture.proposal.status.fetch())!.toString(),
          before!.toString(),
        );
      },
    );
  },
);
