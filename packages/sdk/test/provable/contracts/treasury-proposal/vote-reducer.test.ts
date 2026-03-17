import test from "node:test";
import assert from "node:assert";
import { Bool, Field, Provable, Reducer, UInt64 } from "o1js";
import {
  VoteAction,
  Vote,
  VoteReducer,
  VOTE_ACTION_BATCH_SIZE,
  VoteReducerPublicInput,
  ActionStateHistory,
  voteReducerErrors,
  voteReducerContext,
} from "../../../../src/provable/contracts/treasury-proposal/vote-reducer.js";
import { VotingAccount } from "../../../../src/provable/voting-account.js";
import { appendActionToHashList } from "../../../../src/provable/hashing-helpers.js";
import { createVoteReducerTestContext } from "../../context/contracts/vote-reducer-context.js";

test("vote reducer", async (t) => {
  let context: Awaited<ReturnType<typeof createVoteReducerTestContext>>;

  t.beforeEach(async () => {
    context = await createVoteReducerTestContext();
  });

  t.afterEach(async () => {
    await context.cleanup();
  });

  await t.test("compile", async () => {
    await context.compile();
  });

  await t.test("batch outputs", async (t) => {
    await t.test("should tally votes actions batch", async () => {
      const actions = [
        new VoteAction({
          vote: Vote.YAY,
          publicKey: context.testAccounts[0].pk,
        }),
        new VoteAction({
          vote: Vote.NAY,
          publicKey: context.testAccounts[1].pk,
        }),
        new VoteAction({
          vote: Vote.ABSTRAIN,
          publicKey: context.testAccounts[2].pk,
        }),
        new VoteAction({
          vote: Vote.YAY,
          publicKey: context.testAccounts[3].pk,
        }),
        new VoteAction({
          vote: Vote.NAY,
          publicKey: context.testAccounts[4].pk,
        }),
        ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
      ].slice(0, VOTE_ACTION_BATCH_SIZE);

      const proof = await VoteReducer.reduceBatch(
        {
          fromActionsHash: Reducer.initialActionState,
          votingLedgerRoot: await context.votingLedger.getRoot(),
          fromNullifierRoot: await context.nullifierLedger.getRoot(),
          actionStateHistoryTarget:
            context.buildActionStateHistoryTarget(actions),
        },
        actions,
      );

      assert.equal(
        proof.proof.publicOutput.yay.toBigInt(),
        context.testAccounts[0].balance.toBigInt() +
          context.testAccounts[3].balance.toBigInt(),
        "expected yay total to equal the sum of accounts 0 and 3",
      );
      assert.equal(
        proof.proof.publicOutput.nay.toBigInt(),
        context.testAccounts[1].balance.toBigInt() +
          context.testAccounts[4].balance.toBigInt(),
        "expected nay total to equal the sum of accounts 1 and 4",
      );
      assert.equal(
        proof.proof.publicOutput.abstain.toBigInt(),
        context.testAccounts[2].balance.toBigInt(),
        "expected abstain total to equal account 2",
      );

      const expectedNullifierLedger =
        await context.createExpectedNullifierLedger(
          actions.map((action) => action.publicKey),
        );

      for (const action of actions) {
        if (!VoteAction.isDummy(action).toBoolean()) {
          await expectedNullifierLedger.setLeaf(
            action.publicKey.toBase58(),
            Bool(true),
          );
        }
      }

      const expectedNullifierRoot = await expectedNullifierLedger.getRoot();

      assert(
        proof.proof.publicOutput.toNullifierRoot
          .equals(expectedNullifierRoot)
          .toBoolean(),
        "expected nullifier root to include batch votes",
      );
      await expectedNullifierLedger.close();

      const foundStates = [
        proof.proof.publicOutput.actionStateHistory.actionStateOne.found,
        proof.proof.publicOutput.actionStateHistory.actionStateTwo.found,
        proof.proof.publicOutput.actionStateHistory.actionStateThree.found,
        proof.proof.publicOutput.actionStateHistory.actionStateFour.found,
        proof.proof.publicOutput.actionStateHistory.actionStateFive.found,
      ];

      foundStates.forEach((found, index) => {
        assert(
          found.toBoolean(),
          `expected action state ${index + 1} to be marked found`,
        );
      });
    });

    await t.test("should output a contiguous action hash chain", async () => {
      const actions = [
        new VoteAction({
          vote: Vote.YAY,
          publicKey: context.testAccounts[0].pk,
        }),
        new VoteAction({
          vote: Vote.NAY,
          publicKey: context.testAccounts[1].pk,
        }),
        new VoteAction({
          vote: Vote.ABSTRAIN,
          publicKey: context.testAccounts[2].pk,
        }),
        ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
      ].slice(0, VOTE_ACTION_BATCH_SIZE);

      const proof = await VoteReducer.reduceBatch(
        {
          fromActionsHash: Reducer.initialActionState,
          votingLedgerRoot: await context.votingLedger.getRoot(),
          fromNullifierRoot: await context.nullifierLedger.getRoot(),
          actionStateHistoryTarget:
            context.buildActionStateHistoryTarget(actions),
        },
        actions,
      );

      let expectedToActionsHash = Reducer.initialActionState;
      for (const action of actions) {
        if (!VoteAction.isDummy(action).toBoolean()) {
          expectedToActionsHash = appendActionToHashList(
            expectedToActionsHash,
            VoteAction.toFields(action),
          );
        }
      }

      assert(
        proof.proof.publicOutput.toActionsHash
          .equals(expectedToActionsHash)
          .toBoolean(),
        "expected action hash chain to be contiguous",
      );
    });

    await t.test(
      "should leave roots unchanged for all dummy actions",
      async () => {
        const actions = context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE);

        const fromNullifierRoot = await context.nullifierLedger.getRoot();
        const proof = await VoteReducer.reduceBatch(
          {
            fromActionsHash: Reducer.initialActionState,
            votingLedgerRoot: await context.votingLedger.getRoot(),
            fromNullifierRoot,
            actionStateHistoryTarget:
              context.buildActionStateHistoryTarget(actions),
          },
          actions,
        );

        assert.equal(
          proof.proof.publicOutput.yay.toBigInt(),
          0n,
          "expected yay total to be zero",
        );
        assert.equal(
          proof.proof.publicOutput.nay.toBigInt(),
          0n,
          "expected nay total to be zero",
        );
        assert.equal(
          proof.proof.publicOutput.abstain.toBigInt(),
          0n,
          "expected abstain total to be zero",
        );

        assert(
          proof.proof.publicOutput.toActionsHash
            .equals(Reducer.initialActionState)
            .toBoolean(),
          "expected actions hash to remain initial",
        );
        assert(
          proof.proof.publicOutput.toNullifierRoot
            .equals(fromNullifierRoot)
            .toBoolean(),
          "expected nullifier root to remain unchanged",
        );

        const outputFoundStates = [
          proof.proof.publicOutput.actionStateHistory.actionStateOne.found,
          proof.proof.publicOutput.actionStateHistory.actionStateTwo.found,
          proof.proof.publicOutput.actionStateHistory.actionStateThree.found,
          proof.proof.publicOutput.actionStateHistory.actionStateFour.found,
          proof.proof.publicOutput.actionStateHistory.actionStateFive.found,
        ];

        outputFoundStates.forEach((found, index) => {
          assert(
            found.toBoolean(),
            `expected action state ${index + 1} to be marked found`,
          );
        });
      },
    );

    await t.test(
      "should not count duplicate votes in the same batch",
      async () => {
        const duplicateAccount = context.testAccounts[0];
        const actions = [
          new VoteAction({
            vote: Vote.YAY,
            publicKey: duplicateAccount.pk,
          }),
          new VoteAction({
            vote: Vote.YAY,
            publicKey: duplicateAccount.pk,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: context.testAccounts[1].pk,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const proof = await VoteReducer.reduceBatch(
          {
            fromActionsHash: Reducer.initialActionState,
            votingLedgerRoot: await context.votingLedger.getRoot(),
            fromNullifierRoot: await context.nullifierLedger.getRoot(),
            actionStateHistoryTarget:
              context.buildActionStateHistoryTarget(actions),
          },
          actions,
        );

        const expectedYay = duplicateAccount.balance.toBigInt();
        const expectedNay = context.testAccounts[1].balance.toBigInt();

        assert.equal(
          proof.proof.publicOutput.yay.toBigInt(),
          expectedYay,
          "expected yay total to count duplicate voter once",
        );
        assert.equal(
          proof.proof.publicOutput.nay.toBigInt(),
          expectedNay,
          "expected nay total to equal account 1",
        );

        const expectedNullifierLedger =
          await context.createExpectedNullifierLedger(
            actions.map((action) => action.publicKey),
          );
        const uniqueVoters = new Set(
          actions
            .filter((action) => !VoteAction.isDummy(action).toBoolean())
            .map((action) => action.publicKey.toBase58()),
        );
        for (const voter of uniqueVoters) {
          await expectedNullifierLedger.setLeaf(voter, Bool(true));
        }

        const expectedNullifierRoot = await expectedNullifierLedger.getRoot();
        assert(
          proof.proof.publicOutput.toNullifierRoot
            .equals(expectedNullifierRoot)
            .toBoolean(),
          "expected nullifier root to reflect unique voters",
        );
        await expectedNullifierLedger.close();
      },
    );

    await t.test("should ignore already nullified voter", async () => {
      const alreadyNullified = context.testAccounts[0];
      await context.nullifierLedger.setNullifier(
        alreadyNullified.pk.toBase58(),
        Bool(true),
      );
      await context.nullifierLedger.setLeaf(
        alreadyNullified.pk.toBase58(),
        Bool(true),
      );

      const actions = [
        new VoteAction({
          vote: Vote.YAY,
          publicKey: alreadyNullified.pk,
        }),
        new VoteAction({
          vote: Vote.NAY,
          publicKey: context.testAccounts[1].pk,
        }),
        ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
      ].slice(0, VOTE_ACTION_BATCH_SIZE);

      const fromNullifierRoot = await context.nullifierLedger.getRoot();

      const proof = await VoteReducer.reduceBatch(
        {
          fromActionsHash: Reducer.initialActionState,
          votingLedgerRoot: await context.votingLedger.getRoot(),
          fromNullifierRoot,
          actionStateHistoryTarget:
            context.buildActionStateHistoryTarget(actions),
        },
        actions,
      );

      assert.equal(
        proof.proof.publicOutput.yay.toBigInt(),
        0n,
        "expected already nullified voter to have zero weight",
      );
      assert.equal(
        proof.proof.publicOutput.nay.toBigInt(),
        context.testAccounts[1].balance.toBigInt(),
        "expected nay total to equal account 1",
      );
      assert.equal(
        proof.proof.publicOutput.abstain.toBigInt(),
        0n,
        "expected abstain total to be zero",
      );
      const expectedNullifierLedger =
        await context.createExpectedNullifierLedger([
          alreadyNullified.pk,
          context.testAccounts[1].pk,
        ]);
      await expectedNullifierLedger.setLeaf(
        alreadyNullified.pk.toBase58(),
        Bool(true),
      );
      await expectedNullifierLedger.setLeaf(
        context.testAccounts[1].pk.toBase58(),
        Bool(true),
      );
      const expectedNullifierRoot = await expectedNullifierLedger.getRoot();
      assert(
        proof.proof.publicOutput.toNullifierRoot
          .equals(expectedNullifierRoot)
          .toBoolean(),
        "expected nullifier root to include the non-nullified vote",
      );
      await expectedNullifierLedger.close();
    });

    await t.test(
      "should treat dummy vote with public key as non-dummy",
      async () => {
        const action = new VoteAction({
          vote: Vote.DUMMY,
          publicKey: context.testAccounts[0].pk,
        });
        const actions = [
          action,
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const actionStateHistory =
          context.buildActionStateHistoryTarget(actions);
        const fromNullifierRoot = await context.nullifierLedger.getRoot();

        const proof = await VoteReducer.reduceBatch(
          {
            fromActionsHash: Reducer.initialActionState,
            votingLedgerRoot: await context.votingLedger.getRoot(),
            fromNullifierRoot,
            actionStateHistoryTarget:
              context.buildActionStateHistoryTarget(actions),
          },
          actions,
        );

        const expectedToActionsHash = appendActionToHashList(
          Reducer.initialActionState,
          VoteAction.toFields(action),
        );

        assert(
          proof.proof.publicOutput.toActionsHash
            .equals(expectedToActionsHash)
            .toBoolean(),
          "expected dummy vote with public key to update actions hash",
        );

        const expectedNullifierLedger =
          await context.createExpectedNullifierLedger([action.publicKey]);
        await expectedNullifierLedger.setLeaf(
          action.publicKey.toBase58(),
          Bool(true),
        );
        const expectedNullifierRoot = await expectedNullifierLedger.getRoot();

        assert(
          proof.proof.publicOutput.toNullifierRoot
            .equals(expectedNullifierRoot)
            .toBoolean(),
          "expected nullifier root to update for dummy vote with public key",
        );

        assert.equal(
          proof.proof.publicOutput.yay.toBigInt(),
          0n,
          "expected yay total to be zero",
        );
        assert.equal(
          proof.proof.publicOutput.nay.toBigInt(),
          0n,
          "expected nay total to be zero",
        );
        assert.equal(
          proof.proof.publicOutput.abstain.toBigInt(),
          0n,
          "expected abstain total to be zero",
        );

        await expectedNullifierLedger.close();
      },
    );

    await t.test(
      "should ignore out-of-range vote values",
      { skip: true },
      async () => {
        const action = new VoteAction({
          vote: Field(99) as Vote,
          publicKey: context.testAccounts[1].pk,
        });
        const actions = [
          action,
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const fromNullifierRoot = await context.nullifierLedger.getRoot();

        const proof = await VoteReducer.reduceBatch(
          {
            fromActionsHash: Reducer.initialActionState,
            votingLedgerRoot: await context.votingLedger.getRoot(),
            fromNullifierRoot,
            actionStateHistoryTarget:
              context.buildActionStateHistoryTarget(actions),
          },
          actions,
        );

        const expectedToActionsHash = appendActionToHashList(
          Reducer.initialActionState,
          VoteAction.toFields(action),
        );

        assert(
          proof.proof.publicOutput.toActionsHash
            .equals(expectedToActionsHash)
            .toBoolean(),
          "expected out-of-range vote to update actions hash",
        );

        const expectedNullifierLedger =
          await context.createExpectedNullifierLedger([action.publicKey]);
        await expectedNullifierLedger.setLeaf(
          action.publicKey.toBase58(),
          Bool(true),
        );
        const expectedNullifierRoot = await expectedNullifierLedger.getRoot();

        assert(
          proof.proof.publicOutput.toNullifierRoot
            .equals(expectedNullifierRoot)
            .toBoolean(),
          "expected nullifier root to update for out-of-range vote",
        );

        assert.equal(
          proof.proof.publicOutput.yay.toBigInt(),
          0n,
          "expected yay total to be zero",
        );
        assert.equal(
          proof.proof.publicOutput.nay.toBigInt(),
          0n,
          "expected nay total to be zero",
        );
        assert.equal(
          proof.proof.publicOutput.abstain.toBigInt(),
          0n,
          "expected abstain total to be zero",
        );

        await expectedNullifierLedger.close();
      },
    );
  });

  await t.test("cross-batch invariants", async (t) => {
    await t.test(
      "should update nullifier root and prevent double count across batches",
      async () => {
        const batch1Actions = [
          new VoteAction({
            vote: Vote.YAY,
            publicKey: context.testAccounts[0].pk,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: context.testAccounts[1].pk,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const batch2Actions = [
          new VoteAction({
            vote: Vote.YAY,
            publicKey: context.testAccounts[0].pk,
          }),
          new VoteAction({
            vote: Vote.ABSTRAIN,
            publicKey: context.testAccounts[2].pk,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const allActions = [...batch1Actions, ...batch2Actions].filter(
          (action) => !VoteAction.isDummy(action).toBoolean(),
        );
        const actionStateHistoryTarget =
          context.buildActionStateHistoryTarget(allActions);

        const publicInput = new VoteReducerPublicInput({
          fromActionsHash: Reducer.initialActionState,
          votingLedgerRoot: await context.votingLedger.getRoot(),
          fromNullifierRoot: await context.nullifierLedger.getRoot(),
          actionStateHistoryTarget,
        });

        const proof1 = await VoteReducer.reduceBatch(
          VoteReducerPublicInput.clone(publicInput),
          batch1Actions,
        );

        const proof2 = await VoteReducer.reduceBatch(
          new VoteReducerPublicInput({
            fromActionsHash: proof1.proof.publicOutput.toActionsHash,
            votingLedgerRoot: publicInput.votingLedgerRoot,
            fromNullifierRoot: proof1.proof.publicOutput.toNullifierRoot,
            actionStateHistoryTarget,
          }),
          batch2Actions,
        );

        assert.equal(
          proof2.proof.publicOutput.yay.toBigInt(),
          0n,
          "expected duplicate yay voter to be ignored in batch 2",
        );
        assert.equal(
          proof2.proof.publicOutput.nay.toBigInt(),
          0n,
          "expected batch 2 to have no nay votes",
        );
        assert.equal(
          proof2.proof.publicOutput.abstain.toBigInt(),
          context.testAccounts[2].balance.toBigInt(),
          "expected batch 2 abstain to equal account 2",
        );

        const expectedNullifierLedger =
          await context.createExpectedNullifierLedger(
            allActions.map((action) => action.publicKey),
          );
        const uniqueVoters = new Set(
          allActions.map((action) => action.publicKey.toBase58()),
        );
        for (const voter of uniqueVoters) {
          await expectedNullifierLedger.setLeaf(voter, Bool(true));
        }

        const expectedNullifierRoot = await expectedNullifierLedger.getRoot();
        assert(
          proof2.proof.publicOutput.toNullifierRoot
            .equals(expectedNullifierRoot)
            .toBoolean(),
          "expected nullifier root to include voters from both batches",
        );
        await expectedNullifierLedger.close();
      },
    );

    await t.test("should progress action hash across batches", async () => {
      const batch1Actions = [
        new VoteAction({
          vote: Vote.YAY,
          publicKey: context.testAccounts[0].pk,
        }),
        new VoteAction({
          vote: Vote.NAY,
          publicKey: context.testAccounts[1].pk,
        }),
        ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
      ].slice(0, VOTE_ACTION_BATCH_SIZE);

      const batch2Actions = [
        new VoteAction({
          vote: Vote.ABSTRAIN,
          publicKey: context.testAccounts[2].pk,
        }),
        ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
      ].slice(0, VOTE_ACTION_BATCH_SIZE);

      const allActions = [...batch1Actions, ...batch2Actions];
      const actionStateHistoryTarget = context.buildActionStateHistoryTarget(
        allActions.filter((action) => !VoteAction.isDummy(action).toBoolean()),
      );

      const publicInput = new VoteReducerPublicInput({
        fromActionsHash: Reducer.initialActionState,
        votingLedgerRoot: await context.votingLedger.getRoot(),
        fromNullifierRoot: await context.nullifierLedger.getRoot(),
        actionStateHistoryTarget,
      });

      const proof1 = await VoteReducer.reduceBatch(
        VoteReducerPublicInput.clone(publicInput),
        batch1Actions,
      );

      const proof2 = await VoteReducer.reduceBatch(
        new VoteReducerPublicInput({
          fromActionsHash: proof1.proof.publicOutput.toActionsHash,
          votingLedgerRoot: publicInput.votingLedgerRoot,
          fromNullifierRoot: proof1.proof.publicOutput.toNullifierRoot,
          actionStateHistoryTarget,
        }),
        batch2Actions,
      );

      let expectedToActionsHash = Reducer.initialActionState;
      for (const action of allActions) {
        if (!VoteAction.isDummy(action).toBoolean()) {
          expectedToActionsHash = appendActionToHashList(
            expectedToActionsHash,
            VoteAction.toFields(action),
          );
        }
      }

      assert(
        proof2.proof.publicOutput.toActionsHash
          .equals(expectedToActionsHash)
          .toBoolean(),
        "expected action hash to reflect both batches",
      );
    });

    await t.test("input validation", async (t) => {
      await t.test("should reject batch with too few actions", async () => {
        const actions = [
          new VoteAction({
            vote: Vote.YAY,
            publicKey: context.testAccounts[0].pk,
          }),
        ];
        const actionStateHistoryTarget =
          context.buildActionStateHistoryTarget(actions);

        await assert.rejects(async () =>
          VoteReducer.reduceBatch(
            {
              fromActionsHash: Reducer.initialActionState,
              votingLedgerRoot: await context.votingLedger.getRoot(),
              fromNullifierRoot: await context.nullifierLedger.getRoot(),
              actionStateHistoryTarget,
            },
            actions,
          ),
        );
      });

      await t.test("should ignore actions beyond batch size", async () => {
        const actions = [
          new VoteAction({
            vote: Vote.YAY,
            publicKey: context.testAccounts[0].pk,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: context.testAccounts[1].pk,
          }),
          new VoteAction({
            vote: Vote.ABSTRAIN,
            publicKey: context.testAccounts[2].pk,
          }),
          new VoteAction({
            vote: Vote.YAY,
            publicKey: context.testAccounts[3].pk,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: context.testAccounts[4].pk,
          }),
          new VoteAction({
            vote: Vote.YAY,
            publicKey: context.testAccounts[5].pk,
          }),
        ];

        const actionStateHistoryTarget = context.buildActionStateHistoryTarget(
          actions.slice(0, VOTE_ACTION_BATCH_SIZE),
        );

        const proof = await VoteReducer.reduceBatch(
          {
            fromActionsHash: Reducer.initialActionState,
            votingLedgerRoot: await context.votingLedger.getRoot(),
            fromNullifierRoot: await context.nullifierLedger.getRoot(),
            actionStateHistoryTarget,
          },
          actions,
        );

        let expectedToActionsHash = Reducer.initialActionState;
        for (const action of actions.slice(0, VOTE_ACTION_BATCH_SIZE)) {
          expectedToActionsHash = appendActionToHashList(
            expectedToActionsHash,
            VoteAction.toFields(action),
          );
        }

        assert(
          proof.proof.publicOutput.toActionsHash
            .equals(expectedToActionsHash)
            .toBoolean(),
          "expected extra actions beyond the batch size to be ignored",
        );
      });

      await t.test(
        "should reject batch with mismatched voting account witness index",
        async () => {
          const action = new VoteAction({
            vote: Vote.YAY,
            publicKey: context.testAccounts[0].pk,
          });
          const actions = [
            action,
            ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
          ].slice(0, VOTE_ACTION_BATCH_SIZE);

          const actionStateHistoryTarget =
            context.buildActionStateHistoryTarget(actions);
          const otherPublicKey = context.testAccounts[1].pk.toBase58();
          const votingLedger = context.votingLedger;
          const nullifierLedger = context.nullifierLedger;
          const mismatchedVotingLedger = {
            getVotingAccount: votingLedger.getVotingAccount.bind(votingLedger),
            setVotingAccount: votingLedger.setVotingAccount.bind(votingLedger),
            getWitness: async (_publicKey: string) =>
              await votingLedger.getWitness(otherPublicKey),
            setLeaf: votingLedger.setLeaf.bind(votingLedger),
            getRoot: votingLedger.getRoot.bind(votingLedger),
            close: votingLedger.close.bind(votingLedger),
          };

          voteReducerContext.set({
            votingLedger: mismatchedVotingLedger,
            nullifierLedger,
          });

          try {
            await assert.rejects(
              async () =>
                VoteReducer.reduceBatch(
                  {
                    fromActionsHash: Reducer.initialActionState,
                    votingLedgerRoot: await context.votingLedger.getRoot(),
                    fromNullifierRoot: await context.nullifierLedger.getRoot(),
                    actionStateHistoryTarget,
                  },
                  actions,
                ),
              new RegExp(voteReducerErrors.VOTING_ACCOUNT_INDEX_DOES_NOT_MATCH),
            );
          } finally {
            voteReducerContext.set({
              votingLedger: context.votingLedger,
              nullifierLedger: context.nullifierLedger,
            });
          }
        },
      );

      await t.test(
        "should reject batch with mismatched nullifier witness index",
        async () => {
          const action = new VoteAction({
            vote: Vote.YAY,
            publicKey: context.testAccounts[0].pk,
          });
          const actions = [
            action,
            ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
          ].slice(0, VOTE_ACTION_BATCH_SIZE);

          const actionStateHistoryTarget =
            context.buildActionStateHistoryTarget(actions);
          const otherPublicKey = context.testAccounts[1].pk.toBase58();
          const votingLedger = context.votingLedger;
          const nullifierLedger = context.nullifierLedger;
          const mismatchedNullifierLedger = {
            getNullifier: nullifierLedger.getNullifier.bind(nullifierLedger),
            setNullifier: nullifierLedger.setNullifier.bind(nullifierLedger),
            getWitness: async (_publicKey: string) =>
              await nullifierLedger.getWitness(otherPublicKey),
            setLeaf: nullifierLedger.setLeaf.bind(nullifierLedger),
            getRoot: nullifierLedger.getRoot.bind(nullifierLedger),
            close: nullifierLedger.close.bind(nullifierLedger),
          };

          voteReducerContext.set({
            votingLedger,
            nullifierLedger: mismatchedNullifierLedger,
          });

          try {
            await assert.rejects(
              async () =>
                VoteReducer.reduceBatch(
                  {
                    fromActionsHash: Reducer.initialActionState,
                    votingLedgerRoot: await context.votingLedger.getRoot(),
                    fromNullifierRoot: await context.nullifierLedger.getRoot(),
                    actionStateHistoryTarget,
                  },
                  actions,
                ),
              new RegExp(
                voteReducerErrors.INVALID_WITNESS_FOR_THE_VOTE_NULLIFIER,
              ),
            );
          } finally {
            voteReducerContext.set({
              votingLedger: context.votingLedger,
              nullifierLedger: context.nullifierLedger,
            });
          }
        },
      );

      await t.test(
        "should reject batch with wrong voting ledger root",
        async () => {
          const actions = [
            new VoteAction({
              vote: Vote.YAY,
              publicKey: context.testAccounts[0].pk,
            }),
            new VoteAction({
              vote: Vote.NAY,
              publicKey: context.testAccounts[1].pk,
            }),
            ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
          ].slice(0, VOTE_ACTION_BATCH_SIZE);

          const actionStateHistoryTarget =
            context.buildActionStateHistoryTarget(actions);

          await assert.rejects(
            async () =>
              VoteReducer.reduceBatch(
                {
                  fromActionsHash: Reducer.initialActionState,
                  votingLedgerRoot: Field(0),
                  fromNullifierRoot: await context.nullifierLedger.getRoot(),
                  actionStateHistoryTarget,
                },
                actions,
              ),
            new RegExp(voteReducerErrors.VOTING_LEDGER_ROOT_DOES_NOT_MATCH),
          );
        },
      );

      await t.test(
        "should reject batch with wrong nullifier root",
        async () => {
          const actions = [
            new VoteAction({
              vote: Vote.YAY,
              publicKey: context.testAccounts[0].pk,
            }),
            new VoteAction({
              vote: Vote.NAY,
              publicKey: context.testAccounts[1].pk,
            }),
            ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
          ].slice(0, VOTE_ACTION_BATCH_SIZE);

          const actionStateHistoryTarget =
            context.buildActionStateHistoryTarget(actions);

          await assert.rejects(
            async () =>
              VoteReducer.reduceBatch(
                {
                  fromActionsHash: Reducer.initialActionState,
                  votingLedgerRoot: await context.votingLedger.getRoot(),
                  fromNullifierRoot: Field(0),
                  actionStateHistoryTarget,
                },
                actions,
              ),
            new RegExp(
              voteReducerErrors.CALCULATED_NULLIFIER_ROOT_DOES_NOT_MATCH_TO_NULLIFIER_ROOT,
            ),
          );
        },
      );
    });

    await t.test("proof merging", async (t) => {
      await t.test("should merge vote reducer proofs", async () => {
        const actionStateHistoryTarget = context.buildActionStateHistoryTarget([
          new VoteAction({
            vote: Vote.YAY,
            publicKey: context.testAccounts[0].pk,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: context.testAccounts[1].pk,
          }),
          new VoteAction({
            vote: Vote.ABSTRAIN,
            publicKey: context.testAccounts[2].pk,
          }),
          new VoteAction({
            vote: Vote.YAY,
            publicKey: context.testAccounts[3].pk,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: context.testAccounts[4].pk,
          }),
        ]);

        const publicInput = new VoteReducerPublicInput({
          fromActionsHash: Reducer.initialActionState,
          votingLedgerRoot: await context.votingLedger.getRoot(),
          fromNullifierRoot: await context.nullifierLedger.getRoot(),
          actionStateHistoryTarget,
        });

        const batch1Actions = [
          new VoteAction({
            vote: Vote.YAY,
            publicKey: context.testAccounts[0].pk,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: context.testAccounts[1].pk,
          }),
          new VoteAction({
            vote: Vote.ABSTRAIN,
            publicKey: context.testAccounts[2].pk,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const proof1 = await VoteReducer.reduceBatch(
          VoteReducerPublicInput.clone(publicInput),
          batch1Actions,
        );

        const batch2Actions = [
          new VoteAction({
            vote: Vote.YAY,
            publicKey: context.testAccounts[3].pk,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: context.testAccounts[4].pk,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const proof2 = await VoteReducer.reduceBatch(
          new VoteReducerPublicInput({
            fromActionsHash: proof1.proof.publicOutput.toActionsHash,
            votingLedgerRoot: publicInput.votingLedgerRoot,
            fromNullifierRoot: proof1.proof.publicOutput.toNullifierRoot,
            actionStateHistoryTarget,
          }),
          batch2Actions,
        );

        const proof3 = await VoteReducer.merge(
          publicInput,
          proof1.proof,
          proof2.proof,
        );

        assert(
          proof3.proof.publicOutput.yay.toBigInt() ===
            context.testAccounts[0].balance.toBigInt() +
              context.testAccounts[3].balance.toBigInt(),
        );
        assert(
          proof3.proof.publicOutput.nay.toBigInt() ===
            context.testAccounts[1].balance.toBigInt() +
              context.testAccounts[4].balance.toBigInt(),
        );
        assert(
          proof3.proof.publicOutput.abstain.toBigInt() ===
            context.testAccounts[2].balance.toBigInt(),
        );
        assert(
          proof3.proof.publicOutput.toActionsHash.toString() ===
            proof2.proof.publicOutput.toActionsHash.toString(),
        );
        assert(
          proof3.proof.publicOutput.toNullifierRoot.toString() ===
            proof2.proof.publicOutput.toNullifierRoot.toString(),
        );

        const allActions = [...batch1Actions, ...batch2Actions].filter(
          (action) => !VoteAction.isDummy(action).toBoolean(),
        );
        const expectedNullifierLedger =
          await context.createExpectedNullifierLedger(
            allActions.map((action) => action.publicKey),
          );
        for (const action of allActions) {
          await expectedNullifierLedger.setLeaf(
            action.publicKey.toBase58(),
            Bool(true),
          );
        }
        // Check that all actionStateHistory 'found' flags are true in the merged proof and in the original target
        const mergedActionStateHistory =
          proof3.proof.publicOutput.actionStateHistory;
        const originalTarget = publicInput.actionStateHistoryTarget;
        for (const [key, history] of Object.entries(mergedActionStateHistory)) {
          // Check both merged and target
          const targetHash = originalTarget[key as keyof typeof originalTarget];
          assert(
            history.found.toBoolean(),
            `actionStateHistory "${key}" was not found in the merged proof`,
          );

          assert(
            history.hash.equals(
              actionStateHistoryTarget[
                key as keyof typeof actionStateHistoryTarget
              ],
            ),
            `actionStateHistory "${key}" hash does not match actionStateHistoryTarget`,
          );
        }

        // Additional check: ensure that the final action hash equals the original target
        assert(
          proof3.proof.publicOutput.toActionsHash
            .equals(actionStateHistoryTarget.actionStateOne)
            .toBoolean(),
          `Final toActionsHash does not match actionStateHistoryTarget actionStateOne`,
        );

        const expectedNullifierRoot = await expectedNullifierLedger.getRoot();
        assert(
          proof3.proof.publicOutput.toNullifierRoot
            .equals(expectedNullifierRoot)
            .toBoolean(),
          "expected merged nullifier root to include all votes",
        );
        await expectedNullifierLedger.close();
      });

      await t.test(
        "should reject merge when nullifier roots do not match",
        async () => {
          const actionStateHistoryTarget =
            context.buildActionStateHistoryTarget([
              new VoteAction({
                vote: Vote.YAY,
                publicKey: context.testAccounts[0].pk,
              }),
              new VoteAction({
                vote: Vote.NAY,
                publicKey: context.testAccounts[1].pk,
              }),
            ]);

          const publicInput = new VoteReducerPublicInput({
            fromActionsHash: Reducer.initialActionState,
            votingLedgerRoot: await context.votingLedger.getRoot(),
            fromNullifierRoot: await context.nullifierLedger.getRoot(),
            actionStateHistoryTarget,
          });

          const batch1Actions = [
            new VoteAction({
              vote: Vote.YAY,
              publicKey: context.testAccounts[0].pk,
            }),
            ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
          ].slice(0, VOTE_ACTION_BATCH_SIZE);

          const batch2Actions = [
            new VoteAction({
              vote: Vote.NAY,
              publicKey: context.testAccounts[1].pk,
            }),
            ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
          ].slice(0, VOTE_ACTION_BATCH_SIZE);

          const proof1 = await VoteReducer.reduceBatch(
            VoteReducerPublicInput.clone(publicInput),
            batch1Actions,
          );

          await context.nullifierLedger.setLeaf(
            context.testAccounts[2].pk.toBase58(),
            Bool(true),
          );

          const proof2 = await VoteReducer.reduceBatch(
            new VoteReducerPublicInput({
              fromActionsHash: proof1.proof.publicOutput.toActionsHash,
              votingLedgerRoot: publicInput.votingLedgerRoot,
              fromNullifierRoot: await context.nullifierLedger.getRoot(),
              actionStateHistoryTarget,
            }),
            batch2Actions,
          );

          await assert.rejects(
            async () =>
              VoteReducer.merge(publicInput, proof1.proof, proof2.proof),
            /Nullifier root does not match between merged proofs/,
          );
        },
      );

      await t.test(
        "should reject merge when voting ledger roots do not match",
        async () => {
          const actionStateHistoryTarget =
            context.buildActionStateHistoryTarget([
              new VoteAction({
                vote: Vote.YAY,
                publicKey: context.testAccounts[0].pk,
              }),
              new VoteAction({
                vote: Vote.NAY,
                publicKey: context.testAccounts[1].pk,
              }),
            ]);

          const publicInput = new VoteReducerPublicInput({
            fromActionsHash: Reducer.initialActionState,
            votingLedgerRoot: await context.votingLedger.getRoot(),
            fromNullifierRoot: await context.nullifierLedger.getRoot(),
            actionStateHistoryTarget,
          });

          const batch1Actions = [
            new VoteAction({
              vote: Vote.YAY,
              publicKey: context.testAccounts[0].pk,
            }),
            ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
          ].slice(0, VOTE_ACTION_BATCH_SIZE);

          const batch2Actions = [
            new VoteAction({
              vote: Vote.NAY,
              publicKey: context.testAccounts[1].pk,
            }),
            ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
          ].slice(0, VOTE_ACTION_BATCH_SIZE);

          const proof1 = await VoteReducer.reduceBatch(
            VoteReducerPublicInput.clone(publicInput),
            batch1Actions,
          );

          const updatedVotingAccount = new VotingAccount({
            balance: context.testAccounts[2].balance.add(UInt64.from(1)),
          });

          await context.votingLedger.setVotingAccount(
            context.testAccounts[2].pk.toBase58(),
            updatedVotingAccount,
          );
          await context.votingLedger.setLeaf(
            context.testAccounts[2].pk.toBase58(),
            updatedVotingAccount,
          );

          const proof2 = await VoteReducer.reduceBatch(
            new VoteReducerPublicInput({
              fromActionsHash: proof1.proof.publicOutput.toActionsHash,
              votingLedgerRoot: await context.votingLedger.getRoot(),
              fromNullifierRoot: proof1.proof.publicOutput.toNullifierRoot,
              actionStateHistoryTarget,
            }),
            batch2Actions,
          );

          await assert.rejects(
            async () =>
              VoteReducer.merge(publicInput, proof1.proof, proof2.proof),
            /Voting ledger root does not match between merged proofs/,
          );
        },
      );

      await t.test(
        "should merge action history found across both proofs",
        async () => {
          const action1 = new VoteAction({
            vote: Vote.YAY,
            publicKey: context.testAccounts[0].pk,
          });
          const action2 = new VoteAction({
            vote: Vote.NAY,
            publicKey: context.testAccounts[1].pk,
          });

          const actionStateHistoryTarget =
            context.buildActionStateHistoryTarget([action1, action2]);

          const publicInput = new VoteReducerPublicInput({
            fromActionsHash: Reducer.initialActionState,
            votingLedgerRoot: await context.votingLedger.getRoot(),
            fromNullifierRoot: await context.nullifierLedger.getRoot(),
            actionStateHistoryTarget,
          });

          const batch1Actions = [
            action1,
            ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
          ].slice(0, VOTE_ACTION_BATCH_SIZE);

          const batch2Actions = [
            action2,
            ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
          ].slice(0, VOTE_ACTION_BATCH_SIZE);

          const proof1 = await VoteReducer.reduceBatch(
            VoteReducerPublicInput.clone(publicInput),
            batch1Actions,
          );

          const proof2 = await VoteReducer.reduceBatch(
            new VoteReducerPublicInput({
              fromActionsHash: proof1.proof.publicOutput.toActionsHash,
              votingLedgerRoot: publicInput.votingLedgerRoot,
              fromNullifierRoot: proof1.proof.publicOutput.toNullifierRoot,
              actionStateHistoryTarget,
            }),
            batch2Actions,
          );

          const merged = await VoteReducer.merge(
            publicInput,
            proof1.proof,
            proof2.proof,
          );

          assert(
            merged.proof.publicOutput.actionStateHistory.actionStateFour.found.toBoolean(),
            "expected later action state hash to be found in merged proof",
          );
          assert(
            merged.proof.publicOutput.actionStateHistory.actionStateFive.found.toBoolean(),
            "expected earlier action state hash to remain found in merged proof",
          );
        },
      );
      await t.test(
        "should reject merge with mismatched public input",
        async () => {
          const actionStateHistoryTarget =
            context.buildActionStateHistoryTarget([
              new VoteAction({
                vote: Vote.YAY,
                publicKey: context.testAccounts[0].pk,
              }),
              new VoteAction({
                vote: Vote.NAY,
                publicKey: context.testAccounts[1].pk,
              }),
            ]);

          const publicInput = new VoteReducerPublicInput({
            fromActionsHash: Reducer.initialActionState,
            votingLedgerRoot: await context.votingLedger.getRoot(),
            fromNullifierRoot: await context.nullifierLedger.getRoot(),
            actionStateHistoryTarget,
          });

          const batch1Actions = [
            new VoteAction({
              vote: Vote.YAY,
              publicKey: context.testAccounts[0].pk,
            }),
            ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
          ].slice(0, VOTE_ACTION_BATCH_SIZE);

          const batch2Actions = [
            new VoteAction({
              vote: Vote.NAY,
              publicKey: context.testAccounts[1].pk,
            }),
            ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
          ].slice(0, VOTE_ACTION_BATCH_SIZE);

          const proof1 = await VoteReducer.reduceBatch(
            VoteReducerPublicInput.clone(publicInput),
            batch1Actions,
          );

          const proof2 = await VoteReducer.reduceBatch(
            new VoteReducerPublicInput({
              fromActionsHash: proof1.proof.publicOutput.toActionsHash,
              votingLedgerRoot: publicInput.votingLedgerRoot,
              fromNullifierRoot: proof1.proof.publicOutput.toNullifierRoot,
              actionStateHistoryTarget,
            }),
            batch2Actions,
          );

          const wrongInput = new VoteReducerPublicInput({
            fromActionsHash: Field(123),
            votingLedgerRoot: publicInput.votingLedgerRoot,
            fromNullifierRoot: publicInput.fromNullifierRoot,
            actionStateHistoryTarget,
          });

          await assert.rejects(
            async () =>
              VoteReducer.merge(wrongInput, proof1.proof, proof2.proof),
            /Vote reducer merge public input does not match first proof input/,
          );
        },
      );

      await t.test(
        "should reject merge when action hash chain is not contiguous",
        async () => {
          const actionStateHistoryTarget =
            context.buildActionStateHistoryTarget([
              new VoteAction({
                vote: Vote.YAY,
                publicKey: context.testAccounts[0].pk,
              }),
              new VoteAction({
                vote: Vote.NAY,
                publicKey: context.testAccounts[1].pk,
              }),
            ]);

          const publicInput = new VoteReducerPublicInput({
            fromActionsHash: Reducer.initialActionState,
            votingLedgerRoot: await context.votingLedger.getRoot(),
            fromNullifierRoot: await context.nullifierLedger.getRoot(),
            actionStateHistoryTarget,
          });

          const batch1Actions = [
            new VoteAction({
              vote: Vote.YAY,
              publicKey: context.testAccounts[0].pk,
            }),
            ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
          ].slice(0, VOTE_ACTION_BATCH_SIZE);

          const batch2Actions = [
            new VoteAction({
              vote: Vote.NAY,
              publicKey: context.testAccounts[1].pk,
            }),
            ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
          ].slice(0, VOTE_ACTION_BATCH_SIZE);

          const proof1 = await VoteReducer.reduceBatch(
            VoteReducerPublicInput.clone(publicInput),
            batch1Actions,
          );

          const proof2 = await VoteReducer.reduceBatch(
            new VoteReducerPublicInput({
              fromActionsHash: Reducer.initialActionState,
              votingLedgerRoot: publicInput.votingLedgerRoot,
              fromNullifierRoot: proof1.proof.publicOutput.toNullifierRoot,
              actionStateHistoryTarget,
            }),
            batch2Actions,
          );

          await assert.rejects(
            async () =>
              VoteReducer.merge(publicInput, proof1.proof, proof2.proof),
            /Action hash chain is not contiguous between merged proofs/,
          );
        },
      );

      await t.test(
        "should preserve action history found in earlier batches",
        async () => {
          const actionStateHistoryTarget =
            context.buildActionStateHistoryTarget([
              new VoteAction({
                vote: Vote.YAY,
                publicKey: context.testAccounts[0].pk,
              }),
              new VoteAction({
                vote: Vote.NAY,
                publicKey: context.testAccounts[1].pk,
              }),
            ]);

          const publicInput = new VoteReducerPublicInput({
            fromActionsHash: Reducer.initialActionState,
            votingLedgerRoot: await context.votingLedger.getRoot(),
            fromNullifierRoot: await context.nullifierLedger.getRoot(),
            actionStateHistoryTarget,
          });

          const batch1Actions = [
            new VoteAction({
              vote: Vote.YAY,
              publicKey: context.testAccounts[0].pk,
            }),
            new VoteAction({
              vote: Vote.NAY,
              publicKey: context.testAccounts[1].pk,
            }),
            ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
          ].slice(0, VOTE_ACTION_BATCH_SIZE);

          const batch2Actions = [
            new VoteAction({
              vote: Vote.ABSTRAIN,
              publicKey: context.testAccounts[2].pk,
            }),
            ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
          ].slice(0, VOTE_ACTION_BATCH_SIZE);

          const proof1 = await VoteReducer.reduceBatch(
            VoteReducerPublicInput.clone(publicInput),
            batch1Actions,
          );

          const proof2 = await VoteReducer.reduceBatch(
            new VoteReducerPublicInput({
              fromActionsHash: proof1.proof.publicOutput.toActionsHash,
              votingLedgerRoot: publicInput.votingLedgerRoot,
              fromNullifierRoot: proof1.proof.publicOutput.toNullifierRoot,
              actionStateHistoryTarget,
            }),
            batch2Actions,
          );

          const merged = await VoteReducer.merge(
            publicInput,
            proof1.proof,
            proof2.proof,
          );

          assert(
            merged.proof.publicOutput.actionStateHistory.actionStateFour.found.toBoolean(),
            "expected earlier action state hash to remain found after merge",
          );
          assert(
            merged.proof.publicOutput.actionStateHistory.actionStateFive.found.toBoolean(),
            "expected earlier action state hash to remain found after merge",
          );
        },
      );
    });
  });
});
