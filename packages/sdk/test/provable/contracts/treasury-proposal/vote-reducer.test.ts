import test from "node:test";
import assert from "node:assert";
import { Bool, Field, Reducer, UInt64 } from "o1js";
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

const context = createVoteReducerTestContext();

test("vote reducer", async (t) => {
  let testContext: Awaited<ReturnType<typeof context.createContext>>;

  t.beforeEach(async () => {
    testContext = await context.createContext();
  });

  t.afterEach(async () => {
    await testContext.cleanup();
  });

  await t.test("compile", async () => {
    await context.compile();
  });

  await t.test("action history", async (t) => {
    // TODO: this tests the test utility, we'll move it elsewhere eventually
    await t.test(
      "should build action history with dummies padding",
      async () => {
        const action1 = new VoteAction({
          vote: Vote.YAY,
          publicKey: testContext.testAccounts[0].publicKey,
        });
        const action2 = new VoteAction({
          vote: Vote.NAY,
          publicKey: testContext.testAccounts[1].publicKey,
        });

        const paddedActions = [
          ...context.createDummyVoteActions(3),
          action1,
          action2,
        ];

        const actionStateHistory =
          context.buildActionStateHistory(paddedActions);

        const expectedHash1 = appendActionToHashList(
          Reducer.initialActionState,
          VoteAction.toFields(action1),
        );
        const expectedHash2 = appendActionToHashList(
          expectedHash1,
          VoteAction.toFields(action2),
        );

        const expectedSnapshots = [
          expectedHash2,
          expectedHash1,
          Reducer.initialActionState,
          Reducer.initialActionState,
          Reducer.initialActionState,
        ];

        const actualSnapshots = [
          actionStateHistory.actionStateOne.hash,
          actionStateHistory.actionStateTwo.hash,
          actionStateHistory.actionStateThree.hash,
          actionStateHistory.actionStateFour.hash,
          actionStateHistory.actionStateFive.hash,
        ];

        expectedSnapshots.forEach((expected, index) => {
          assert(
            actualSnapshots[index].equals(expected).toBoolean(),
            `action state snapshot ${index + 1} should match expected action list hash`,
          );
        });
      },
    );

    await t.test(
      "should build full action history for five actions",
      async () => {
        const actions = [
          new VoteAction({
            vote: Vote.YAY,
            publicKey: testContext.testAccounts[0].publicKey,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: testContext.testAccounts[1].publicKey,
          }),
          new VoteAction({
            vote: Vote.ABSTRAIN,
            publicKey: testContext.testAccounts[2].publicKey,
          }),
          new VoteAction({
            vote: Vote.YAY,
            publicKey: testContext.testAccounts[3].publicKey,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: testContext.testAccounts[4].publicKey,
          }),
        ];

        const actionStateHistory = context.buildActionStateHistory(actions);

        let currentHash = Reducer.initialActionState;
        const expectedHashes: Field[] = [];
        for (const action of actions) {
          currentHash = appendActionToHashList(
            currentHash,
            VoteAction.toFields(action),
          );
          expectedHashes.push(currentHash);
        }

        const expectedSnapshots = expectedHashes.slice().reverse();
        const actualSnapshots = [
          actionStateHistory.actionStateOne.hash,
          actionStateHistory.actionStateTwo.hash,
          actionStateHistory.actionStateThree.hash,
          actionStateHistory.actionStateFour.hash,
          actionStateHistory.actionStateFive.hash,
        ];

        expectedSnapshots.forEach((expected, index) => {
          assert(
            actualSnapshots[index].equals(expected).toBoolean(),
            `action state snapshot ${index + 1} should match expected action list hash`,
          );
        });
      },
    );

    await t.test(
      "should mark only history hashes that appear in the batch",
      async () => {
        const actions = [
          new VoteAction({
            vote: Vote.YAY,
            publicKey: testContext.testAccounts[0].publicKey,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: testContext.testAccounts[1].publicKey,
          }),
          new VoteAction({
            vote: Vote.ABSTRAIN,
            publicKey: testContext.testAccounts[2].publicKey,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const baseHistory = context.buildActionStateHistory(actions);
        const actionStateHistory = new ActionStateHistory({
          actionStateOne: { hash: Field(123), found: Bool(false) },
          actionStateTwo: baseHistory.actionStateTwo,
          actionStateThree: baseHistory.actionStateThree,
          actionStateFour: baseHistory.actionStateFour,
          actionStateFive: baseHistory.actionStateFive,
        });

        const proof = await VoteReducer.reduceBatch(
          {
            fromActionsHash: Reducer.initialActionState,
            votingLedgerRoot: await testContext.votingLedger.getRoot(),
            fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
            actionStateHistory,
          },
          actions,
        );

        let currentHash = Reducer.initialActionState;
        const hashSnapshots: Field[] = [];
        for (const action of actions) {
          if (!VoteAction.isDummy(action).toBoolean()) {
            currentHash = appendActionToHashList(
              currentHash,
              VoteAction.toFields(action),
            );
            hashSnapshots.push(currentHash);
          }
        }

        const outputStates = [
          proof.proof.publicOutput.actionStateHistory.actionStateOne,
          proof.proof.publicOutput.actionStateHistory.actionStateTwo,
          proof.proof.publicOutput.actionStateHistory.actionStateThree,
          proof.proof.publicOutput.actionStateHistory.actionStateFour,
          proof.proof.publicOutput.actionStateHistory.actionStateFive,
        ];
        outputStates.forEach((state, index) => {
          const expectedFound = hashSnapshots.some((hash) =>
            hash.equals(state.hash).toBoolean(),
          );
          assert(
            state.found.toBoolean() === expectedFound,
            `expected action state ${index + 1} found to be ${expectedFound}`,
          );
        });
      },
    );

    await t.test(
      "should not find action state history not included in the batch",
      async () => {
        const actions = [
          new VoteAction({
            vote: Vote.YAY,
            publicKey: testContext.testAccounts[0].publicKey,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: testContext.testAccounts[1].publicKey,
          }),
          new VoteAction({
            vote: Vote.ABSTRAIN,
            publicKey: testContext.testAccounts[2].publicKey,
          }),
          new VoteAction({
            vote: Vote.YAY,
            publicKey: testContext.testAccounts[3].publicKey,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: testContext.testAccounts[4].publicKey,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const emptyHistory = ActionStateHistory.empty();

        const proof = await VoteReducer.reduceBatch(
          {
            fromActionsHash: Reducer.initialActionState,
            votingLedgerRoot: await testContext.votingLedger.getRoot(),
            fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
            actionStateHistory: emptyHistory,
          },
          actions,
        );

        const foundStates = [
          proof.proof.publicOutput.actionStateHistory.actionStateOne.found,
          proof.proof.publicOutput.actionStateHistory.actionStateTwo.found,
          proof.proof.publicOutput.actionStateHistory.actionStateThree.found,
          proof.proof.publicOutput.actionStateHistory.actionStateFour.found,
          proof.proof.publicOutput.actionStateHistory.actionStateFive.found,
        ];

        foundStates.forEach((found, index) => {
          assert(
            found.toBoolean() === false,
            `expected action state ${index + 1} to remain unfound`,
          );
        });
      },
    );
  });

  await t.test("batch outputs", async (t) => {
    await t.test("should tally votes actions batch", async () => {
      const actions = [
        new VoteAction({
          vote: Vote.YAY,
          publicKey: testContext.testAccounts[0].publicKey,
        }),
        new VoteAction({
          vote: Vote.NAY,
          publicKey: testContext.testAccounts[1].publicKey,
        }),
        new VoteAction({
          vote: Vote.ABSTRAIN,
          publicKey: testContext.testAccounts[2].publicKey,
        }),
        new VoteAction({
          vote: Vote.YAY,
          publicKey: testContext.testAccounts[3].publicKey,
        }),
        new VoteAction({
          vote: Vote.NAY,
          publicKey: testContext.testAccounts[4].publicKey,
        }),
        ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
      ].slice(0, VOTE_ACTION_BATCH_SIZE);

      const actionStateHistory = context.buildActionStateHistory(actions);

      const proof = await VoteReducer.reduceBatch(
        {
          fromActionsHash: Reducer.initialActionState,
          votingLedgerRoot: await testContext.votingLedger.getRoot(),
          fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
          actionStateHistory,
        },
        actions,
      );

      assert.equal(
        proof.proof.publicOutput.yay.toBigInt(),
        testContext.testAccounts[0].balance.toBigInt() +
          testContext.testAccounts[3].balance.toBigInt(),
        "expected yay total to equal the sum of accounts 0 and 3",
      );
      assert.equal(
        proof.proof.publicOutput.nay.toBigInt(),
        testContext.testAccounts[1].balance.toBigInt() +
          testContext.testAccounts[4].balance.toBigInt(),
        "expected nay total to equal the sum of accounts 1 and 4",
      );
      assert.equal(
        proof.proof.publicOutput.abstain.toBigInt(),
        testContext.testAccounts[2].balance.toBigInt(),
        "expected abstain total to equal account 2",
      );

      const expectedNullifierLedger =
        await testContext.createExpectedNullifierLedger("batch");
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
          publicKey: testContext.testAccounts[0].publicKey,
        }),
        new VoteAction({
          vote: Vote.NAY,
          publicKey: testContext.testAccounts[1].publicKey,
        }),
        new VoteAction({
          vote: Vote.ABSTRAIN,
          publicKey: testContext.testAccounts[2].publicKey,
        }),
        ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
      ].slice(0, VOTE_ACTION_BATCH_SIZE);

      const actionStateHistory = context.buildActionStateHistory(actions);

      const proof = await VoteReducer.reduceBatch(
        {
          fromActionsHash: Reducer.initialActionState,
          votingLedgerRoot: await testContext.votingLedger.getRoot(),
          fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
          actionStateHistory,
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
        const actionStateHistory = context.buildActionStateHistory(actions);

        const fromNullifierRoot = await testContext.nullifierLedger.getRoot();
        const proof = await VoteReducer.reduceBatch(
          {
            fromActionsHash: Reducer.initialActionState,
            votingLedgerRoot: await testContext.votingLedger.getRoot(),
            fromNullifierRoot,
            actionStateHistory,
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

        const outputStates = [
          proof.proof.publicOutput.actionStateHistory.actionStateOne,
          proof.proof.publicOutput.actionStateHistory.actionStateTwo,
          proof.proof.publicOutput.actionStateHistory.actionStateThree,
          proof.proof.publicOutput.actionStateHistory.actionStateFour,
          proof.proof.publicOutput.actionStateHistory.actionStateFive,
        ];
        outputStates.forEach((state, index) => {
          const expectedFound = state.hash
            .equals(Reducer.initialActionState)
            .toBoolean();
          assert(
            state.found.toBoolean() === expectedFound,
            `expected action state ${index + 1} found to be ${expectedFound}`,
          );
        });
      },
    );

    await t.test(
      "should not count duplicate votes in the same batch",
      async () => {
        const duplicateAccount = testContext.testAccounts[0];
        const actions = [
          new VoteAction({
            vote: Vote.YAY,
            publicKey: duplicateAccount.publicKey,
          }),
          new VoteAction({
            vote: Vote.YAY,
            publicKey: duplicateAccount.publicKey,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: testContext.testAccounts[1].publicKey,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const actionStateHistory = context.buildActionStateHistory(actions);

        const proof = await VoteReducer.reduceBatch(
          {
            fromActionsHash: Reducer.initialActionState,
            votingLedgerRoot: await testContext.votingLedger.getRoot(),
            fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
            actionStateHistory,
          },
          actions,
        );

        const expectedYay = duplicateAccount.balance.toBigInt();
        const expectedNay = testContext.testAccounts[1].balance.toBigInt();

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
          await testContext.createExpectedNullifierLedger("duplicate");
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
      const alreadyNullified = testContext.testAccounts[0];
      await testContext.nullifierLedger.setNullifier(
        alreadyNullified.publicKey.toBase58(),
        Bool(true),
      );
      await testContext.nullifierLedger.setLeaf(
        alreadyNullified.publicKey.toBase58(),
        Bool(true),
      );

      const actions = [
        new VoteAction({
          vote: Vote.YAY,
          publicKey: alreadyNullified.publicKey,
        }),
        new VoteAction({
          vote: Vote.NAY,
          publicKey: testContext.testAccounts[1].publicKey,
        }),
        ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
      ].slice(0, VOTE_ACTION_BATCH_SIZE);

      const actionStateHistory = context.buildActionStateHistory(actions);
      const fromNullifierRoot = await testContext.nullifierLedger.getRoot();

      const proof = await VoteReducer.reduceBatch(
        {
          fromActionsHash: Reducer.initialActionState,
          votingLedgerRoot: await testContext.votingLedger.getRoot(),
          fromNullifierRoot,
          actionStateHistory,
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
        testContext.testAccounts[1].balance.toBigInt(),
        "expected nay total to equal account 1",
      );
      assert.equal(
        proof.proof.publicOutput.abstain.toBigInt(),
        0n,
        "expected abstain total to be zero",
      );
      const expectedNullifierLedger =
        await testContext.createExpectedNullifierLedger("already-nullified");
      await expectedNullifierLedger.setLeaf(
        alreadyNullified.publicKey.toBase58(),
        Bool(true),
      );
      await expectedNullifierLedger.setLeaf(
        testContext.testAccounts[1].publicKey.toBase58(),
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
          publicKey: testContext.testAccounts[0].publicKey,
        });
        const actions = [
          action,
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const actionStateHistory = context.buildActionStateHistory(actions);
        const fromNullifierRoot = await testContext.nullifierLedger.getRoot();

        const proof = await VoteReducer.reduceBatch(
          {
            fromActionsHash: Reducer.initialActionState,
            votingLedgerRoot: await testContext.votingLedger.getRoot(),
            fromNullifierRoot,
            actionStateHistory,
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
          await testContext.createExpectedNullifierLedger("dummy-vote");
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
          publicKey: testContext.testAccounts[1].publicKey,
        });
        const actions = [
          action,
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const actionStateHistory = context.buildActionStateHistory(actions);
        const fromNullifierRoot = await testContext.nullifierLedger.getRoot();

        const proof = await VoteReducer.reduceBatch(
          {
            fromActionsHash: Reducer.initialActionState,
            votingLedgerRoot: await testContext.votingLedger.getRoot(),
            fromNullifierRoot,
            actionStateHistory,
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
          await testContext.createExpectedNullifierLedger("out-of-range");
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
            publicKey: testContext.testAccounts[0].publicKey,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: testContext.testAccounts[1].publicKey,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const batch2Actions = [
          new VoteAction({
            vote: Vote.YAY,
            publicKey: testContext.testAccounts[0].publicKey,
          }),
          new VoteAction({
            vote: Vote.ABSTRAIN,
            publicKey: testContext.testAccounts[2].publicKey,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const allActions = [...batch1Actions, ...batch2Actions].filter(
          (action) => !VoteAction.isDummy(action).toBoolean(),
        );
        const actionStateHistory = context.buildActionStateHistory(allActions);

        const publicInput = new VoteReducerPublicInput({
          fromActionsHash: Reducer.initialActionState,
          votingLedgerRoot: await testContext.votingLedger.getRoot(),
          fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
          actionStateHistory,
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
            actionStateHistory,
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
          testContext.testAccounts[2].balance.toBigInt(),
          "expected batch 2 abstain to equal account 2",
        );

        const expectedNullifierLedger =
          await testContext.createExpectedNullifierLedger("cross-batch");
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
          publicKey: testContext.testAccounts[0].publicKey,
        }),
        new VoteAction({
          vote: Vote.NAY,
          publicKey: testContext.testAccounts[1].publicKey,
        }),
        ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
      ].slice(0, VOTE_ACTION_BATCH_SIZE);

      const batch2Actions = [
        new VoteAction({
          vote: Vote.ABSTRAIN,
          publicKey: testContext.testAccounts[2].publicKey,
        }),
        ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
      ].slice(0, VOTE_ACTION_BATCH_SIZE);

      const allActions = [...batch1Actions, ...batch2Actions];
      const actionStateHistory = context.buildActionStateHistory(
        allActions.filter((action) => !VoteAction.isDummy(action).toBoolean()),
      );

      const publicInput = new VoteReducerPublicInput({
        fromActionsHash: Reducer.initialActionState,
        votingLedgerRoot: await testContext.votingLedger.getRoot(),
        fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
        actionStateHistory,
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
          actionStateHistory,
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

    await t.test(
      "should carry action history found across sequential batches",
      async () => {
        const batch1Actions = [
          new VoteAction({
            vote: Vote.YAY,
            publicKey: testContext.testAccounts[0].publicKey,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: testContext.testAccounts[1].publicKey,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const batch2Actions = [
          new VoteAction({
            vote: Vote.ABSTRAIN,
            publicKey: testContext.testAccounts[2].publicKey,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const allActions = [...batch1Actions, ...batch2Actions].filter(
          (action) => !VoteAction.isDummy(action).toBoolean(),
        );
        const actionStateHistory = context.buildActionStateHistory(allActions);

        const publicInput = new VoteReducerPublicInput({
          fromActionsHash: Reducer.initialActionState,
          votingLedgerRoot: await testContext.votingLedger.getRoot(),
          fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
          actionStateHistory,
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
            actionStateHistory: proof1.proof.publicOutput.actionStateHistory,
          }),
          batch2Actions,
        );

        assert(
          proof2.proof.publicOutput.actionStateHistory.actionStateThree.found.toBoolean(),
          "expected latest action state hash to be found in batch 2",
        );
        assert(
          proof2.proof.publicOutput.actionStateHistory.actionStateFour.found.toBoolean(),
          "expected batch 1 action state hash to remain found",
        );
        assert(
          proof2.proof.publicOutput.actionStateHistory.actionStateFive.found.toBoolean(),
          "expected batch 1 action state hash to remain found",
        );
      },
    );
  });

  await t.test("input validation", async (t) => {
    await t.test("should reject batch with too few actions", async () => {
      const actions = [
        new VoteAction({
          vote: Vote.YAY,
          publicKey: testContext.testAccounts[0].publicKey,
        }),
      ];
      const actionStateHistory = context.buildActionStateHistory(actions);

      await assert.rejects(async () =>
        VoteReducer.reduceBatch(
          {
            fromActionsHash: Reducer.initialActionState,
            votingLedgerRoot: await testContext.votingLedger.getRoot(),
            fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
            actionStateHistory,
          },
          actions,
        ),
      );
    });

    await t.test("should ignore actions beyond batch size", async () => {
      const actions = [
        new VoteAction({
          vote: Vote.YAY,
          publicKey: testContext.testAccounts[0].publicKey,
        }),
        new VoteAction({
          vote: Vote.NAY,
          publicKey: testContext.testAccounts[1].publicKey,
        }),
        new VoteAction({
          vote: Vote.ABSTRAIN,
          publicKey: testContext.testAccounts[2].publicKey,
        }),
        new VoteAction({
          vote: Vote.YAY,
          publicKey: testContext.testAccounts[3].publicKey,
        }),
        new VoteAction({
          vote: Vote.NAY,
          publicKey: testContext.testAccounts[4].publicKey,
        }),
        new VoteAction({
          vote: Vote.YAY,
          publicKey: testContext.testAccounts[5].publicKey,
        }),
      ];

      const actionStateHistory = context.buildActionStateHistory(
        actions.slice(0, VOTE_ACTION_BATCH_SIZE),
      );

      const proof = await VoteReducer.reduceBatch(
        {
          fromActionsHash: Reducer.initialActionState,
          votingLedgerRoot: await testContext.votingLedger.getRoot(),
          fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
          actionStateHistory,
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
      "should reject batch with already found action state hash",
      async () => {
        const actions = [
          new VoteAction({
            vote: Vote.YAY,
            publicKey: testContext.testAccounts[0].publicKey,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const baseHistory = context.buildActionStateHistory(actions);
        const actionStateHistory = new ActionStateHistory({
          actionStateOne: baseHistory.actionStateOne,
          actionStateTwo: baseHistory.actionStateTwo,
          actionStateThree: baseHistory.actionStateThree,
          actionStateFour: baseHistory.actionStateFour,
          actionStateFive: {
            hash: baseHistory.actionStateFive.hash,
            found: Bool(true),
          },
        });

        await assert.rejects(
          async () =>
            VoteReducer.reduceBatch(
              {
                fromActionsHash: Reducer.initialActionState,
                votingLedgerRoot: await testContext.votingLedger.getRoot(),
                fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
                actionStateHistory,
              },
              actions,
            ),
          /action state hash has been previously found/,
        );
      },
    );

    await t.test(
      "should reject batch with mismatched voting account witness index",
      async () => {
        const action = new VoteAction({
          vote: Vote.YAY,
          publicKey: testContext.testAccounts[0].publicKey,
        });
        const actions = [
          action,
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const actionStateHistory = context.buildActionStateHistory(actions);
        const otherPublicKey = testContext.testAccounts[1].publicKey.toBase58();
        const votingLedger = testContext.votingLedger;
        const nullifierLedger = testContext.nullifierLedger;
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
                  votingLedgerRoot: await testContext.votingLedger.getRoot(),
                  fromNullifierRoot:
                    await testContext.nullifierLedger.getRoot(),
                  actionStateHistory,
                },
                actions,
              ),
            new RegExp(voteReducerErrors.VOTING_ACCOUNT_INDEX_DOES_NOT_MATCH),
          );
        } finally {
          voteReducerContext.set({
            votingLedger: testContext.votingLedger,
            nullifierLedger: testContext.nullifierLedger,
          });
        }
      },
    );

    await t.test(
      "should reject batch with mismatched nullifier witness index",
      async () => {
        const action = new VoteAction({
          vote: Vote.YAY,
          publicKey: testContext.testAccounts[0].publicKey,
        });
        const actions = [
          action,
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const actionStateHistory = context.buildActionStateHistory(actions);
        const otherPublicKey = testContext.testAccounts[1].publicKey.toBase58();
        const votingLedger = testContext.votingLedger;
        const nullifierLedger = testContext.nullifierLedger;
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
                  votingLedgerRoot: await testContext.votingLedger.getRoot(),
                  fromNullifierRoot:
                    await testContext.nullifierLedger.getRoot(),
                  actionStateHistory,
                },
                actions,
              ),
            new RegExp(
              voteReducerErrors.INVALID_WITNESS_FOR_THE_VOTE_NULLIFIER,
            ),
          );
        } finally {
          voteReducerContext.set({
            votingLedger: testContext.votingLedger,
            nullifierLedger: testContext.nullifierLedger,
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
            publicKey: testContext.testAccounts[0].publicKey,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: testContext.testAccounts[1].publicKey,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const actionStateHistory = context.buildActionStateHistory(actions);

        await assert.rejects(
          async () =>
            VoteReducer.reduceBatch(
              {
                fromActionsHash: Reducer.initialActionState,
                votingLedgerRoot: Field(0),
                fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
                actionStateHistory,
              },
              actions,
            ),
          new RegExp(voteReducerErrors.VOTING_LEDGER_ROOT_DOES_NOT_MATCH),
        );
      },
    );

    await t.test("should reject batch with wrong nullifier root", async () => {
      const actions = [
        new VoteAction({
          vote: Vote.YAY,
          publicKey: testContext.testAccounts[0].publicKey,
        }),
        new VoteAction({
          vote: Vote.NAY,
          publicKey: testContext.testAccounts[1].publicKey,
        }),
        ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
      ].slice(0, VOTE_ACTION_BATCH_SIZE);

      const actionStateHistory = context.buildActionStateHistory(actions);

      await assert.rejects(
        async () =>
          VoteReducer.reduceBatch(
            {
              fromActionsHash: Reducer.initialActionState,
              votingLedgerRoot: await testContext.votingLedger.getRoot(),
              fromNullifierRoot: Field(0),
              actionStateHistory,
            },
            actions,
          ),
        new RegExp(
          voteReducerErrors.CALCULATED_NULLIFIER_ROOT_DOES_NOT_MATCH_TO_NULLIFIER_ROOT,
        ),
      );
    });
  });

  await t.test("determinism", async (t) => {
    await t.test(
      "should produce identical output with fresh ledgers",
      async () => {
        const actions = [
          new VoteAction({
            vote: Vote.YAY,
            publicKey: testContext.testAccounts[0].publicKey,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: testContext.testAccounts[1].publicKey,
          }),
          new VoteAction({
            vote: Vote.ABSTRAIN,
            publicKey: testContext.testAccounts[2].publicKey,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const actionStateHistory = context.buildActionStateHistory(actions);
        voteReducerContext.set({
          votingLedger: testContext.votingLedger,
          nullifierLedger: testContext.nullifierLedger,
        });

        const proofA = await VoteReducer.reduceBatch(
          new VoteReducerPublicInput({
            fromActionsHash: Reducer.initialActionState,
            votingLedgerRoot: await testContext.votingLedger.getRoot(),
            fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
            actionStateHistory,
          }),
          actions,
        );

        const secondContext = await context.createContext({
          lifecycleId: "vote-reducer-determinism",
          accountCount: 0,
        });

        try {
          for (const account of testContext.testAccounts) {
            const votingAccount = new VotingAccount({
              balance: account.balance,
            });
            const publicKey = account.publicKey.toBase58();
            await secondContext.votingLedger.setVotingAccount(
              publicKey,
              votingAccount,
            );
            await secondContext.votingLedger.setLeaf(publicKey, votingAccount);
            await secondContext.nullifierLedger.setLeaf(publicKey, Bool(false));
          }

          voteReducerContext.set({
            votingLedger: secondContext.votingLedger,
            nullifierLedger: secondContext.nullifierLedger,
          });

          const proofB = await VoteReducer.reduceBatch(
            new VoteReducerPublicInput({
              fromActionsHash: Reducer.initialActionState,
              votingLedgerRoot: await secondContext.votingLedger.getRoot(),
              fromNullifierRoot: await secondContext.nullifierLedger.getRoot(),
              actionStateHistory,
            }),
            actions,
          );

          assert(
            proofA.proof.publicOutput.toActionsHash
              .equals(proofB.proof.publicOutput.toActionsHash)
              .toBoolean(),
            "expected actions hash to be deterministic",
          );
          assert(
            proofA.proof.publicOutput.toNullifierRoot
              .equals(proofB.proof.publicOutput.toNullifierRoot)
              .toBoolean(),
            "expected nullifier root to be deterministic",
          );
          assert.equal(
            proofA.proof.publicOutput.yay.toBigInt(),
            proofB.proof.publicOutput.yay.toBigInt(),
            "expected yay total to be deterministic",
          );
          assert.equal(
            proofA.proof.publicOutput.nay.toBigInt(),
            proofB.proof.publicOutput.nay.toBigInt(),
            "expected nay total to be deterministic",
          );
          assert.equal(
            proofA.proof.publicOutput.abstain.toBigInt(),
            proofB.proof.publicOutput.abstain.toBigInt(),
            "expected abstain total to be deterministic",
          );
        } finally {
          voteReducerContext.set({
            votingLedger: testContext.votingLedger,
            nullifierLedger: testContext.nullifierLedger,
          });
          await secondContext.cleanup();
        }
      },
    );
  });

  await t.test("proof merging", async (t) => {
    await t.test("should merge vote reducer proofs", async () => {
      const actionStateHistory = context.buildActionStateHistory([
        new VoteAction({
          vote: Vote.YAY,
          publicKey: testContext.testAccounts[0].publicKey,
        }),
        new VoteAction({
          vote: Vote.NAY,
          publicKey: testContext.testAccounts[1].publicKey,
        }),
        new VoteAction({
          vote: Vote.ABSTRAIN,
          publicKey: testContext.testAccounts[2].publicKey,
        }),
        new VoteAction({
          vote: Vote.YAY,
          publicKey: testContext.testAccounts[3].publicKey,
        }),
        new VoteAction({
          vote: Vote.NAY,
          publicKey: testContext.testAccounts[4].publicKey,
        }),
      ]);

      const publicInput = new VoteReducerPublicInput({
        fromActionsHash: Reducer.initialActionState,
        votingLedgerRoot: await testContext.votingLedger.getRoot(),
        fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
        actionStateHistory,
      });

      const batch1Actions = [
        new VoteAction({
          vote: Vote.YAY,
          publicKey: testContext.testAccounts[0].publicKey,
        }),
        new VoteAction({
          vote: Vote.NAY,
          publicKey: testContext.testAccounts[1].publicKey,
        }),
        new VoteAction({
          vote: Vote.ABSTRAIN,
          publicKey: testContext.testAccounts[2].publicKey,
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
          publicKey: testContext.testAccounts[3].publicKey,
        }),
        new VoteAction({
          vote: Vote.NAY,
          publicKey: testContext.testAccounts[4].publicKey,
        }),
        ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
      ].slice(0, VOTE_ACTION_BATCH_SIZE);

      const proof2 = await VoteReducer.reduceBatch(
        new VoteReducerPublicInput({
          fromActionsHash: proof1.proof.publicOutput.toActionsHash,
          votingLedgerRoot: publicInput.votingLedgerRoot,
          fromNullifierRoot: proof1.proof.publicOutput.toNullifierRoot,
          actionStateHistory,
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
          testContext.testAccounts[0].balance.toBigInt() +
            testContext.testAccounts[3].balance.toBigInt(),
      );
      assert(
        proof3.proof.publicOutput.nay.toBigInt() ===
          testContext.testAccounts[1].balance.toBigInt() +
            testContext.testAccounts[4].balance.toBigInt(),
      );
      assert(
        proof3.proof.publicOutput.abstain.toBigInt() ===
          testContext.testAccounts[2].balance.toBigInt(),
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
        await testContext.createExpectedNullifierLedger("merge");
      for (const action of allActions) {
        await expectedNullifierLedger.setLeaf(
          action.publicKey.toBase58(),
          Bool(true),
        );
      }

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
        const actionStateHistory = context.buildActionStateHistory([
          new VoteAction({
            vote: Vote.YAY,
            publicKey: testContext.testAccounts[0].publicKey,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: testContext.testAccounts[1].publicKey,
          }),
        ]);

        const publicInput = new VoteReducerPublicInput({
          fromActionsHash: Reducer.initialActionState,
          votingLedgerRoot: await testContext.votingLedger.getRoot(),
          fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
          actionStateHistory,
        });

        const batch1Actions = [
          new VoteAction({
            vote: Vote.YAY,
            publicKey: testContext.testAccounts[0].publicKey,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const batch2Actions = [
          new VoteAction({
            vote: Vote.NAY,
            publicKey: testContext.testAccounts[1].publicKey,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const proof1 = await VoteReducer.reduceBatch(
          VoteReducerPublicInput.clone(publicInput),
          batch1Actions,
        );

        await testContext.nullifierLedger.setLeaf(
          testContext.testAccounts[2].publicKey.toBase58(),
          Bool(true),
        );

        const proof2 = await VoteReducer.reduceBatch(
          new VoteReducerPublicInput({
            fromActionsHash: proof1.proof.publicOutput.toActionsHash,
            votingLedgerRoot: publicInput.votingLedgerRoot,
            fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
            actionStateHistory,
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
        const actionStateHistory = context.buildActionStateHistory([
          new VoteAction({
            vote: Vote.YAY,
            publicKey: testContext.testAccounts[0].publicKey,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: testContext.testAccounts[1].publicKey,
          }),
        ]);

        const publicInput = new VoteReducerPublicInput({
          fromActionsHash: Reducer.initialActionState,
          votingLedgerRoot: await testContext.votingLedger.getRoot(),
          fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
          actionStateHistory,
        });

        const batch1Actions = [
          new VoteAction({
            vote: Vote.YAY,
            publicKey: testContext.testAccounts[0].publicKey,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const batch2Actions = [
          new VoteAction({
            vote: Vote.NAY,
            publicKey: testContext.testAccounts[1].publicKey,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const proof1 = await VoteReducer.reduceBatch(
          VoteReducerPublicInput.clone(publicInput),
          batch1Actions,
        );

        const updatedVotingAccount = new VotingAccount({
          balance: testContext.testAccounts[2].balance.add(UInt64.from(1)),
        });

        await testContext.votingLedger.setVotingAccount(
          testContext.testAccounts[2].publicKey.toBase58(),
          updatedVotingAccount,
        );
        await testContext.votingLedger.setLeaf(
          testContext.testAccounts[2].publicKey.toBase58(),
          updatedVotingAccount,
        );

        const proof2 = await VoteReducer.reduceBatch(
          new VoteReducerPublicInput({
            fromActionsHash: proof1.proof.publicOutput.toActionsHash,
            votingLedgerRoot: await testContext.votingLedger.getRoot(),
            fromNullifierRoot: proof1.proof.publicOutput.toNullifierRoot,
            actionStateHistory,
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
          publicKey: testContext.testAccounts[0].publicKey,
        });
        const action2 = new VoteAction({
          vote: Vote.NAY,
          publicKey: testContext.testAccounts[1].publicKey,
        });

        const actionStateHistory = context.buildActionStateHistory([
          action1,
          action2,
        ]);

        const publicInput = new VoteReducerPublicInput({
          fromActionsHash: Reducer.initialActionState,
          votingLedgerRoot: await testContext.votingLedger.getRoot(),
          fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
          actionStateHistory,
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
            actionStateHistory,
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
        const actionStateHistory = context.buildActionStateHistory([
          new VoteAction({
            vote: Vote.YAY,
            publicKey: testContext.testAccounts[0].publicKey,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: testContext.testAccounts[1].publicKey,
          }),
        ]);

        const publicInput = new VoteReducerPublicInput({
          fromActionsHash: Reducer.initialActionState,
          votingLedgerRoot: await testContext.votingLedger.getRoot(),
          fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
          actionStateHistory,
        });

        const batch1Actions = [
          new VoteAction({
            vote: Vote.YAY,
            publicKey: testContext.testAccounts[0].publicKey,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const batch2Actions = [
          new VoteAction({
            vote: Vote.NAY,
            publicKey: testContext.testAccounts[1].publicKey,
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
            actionStateHistory,
          }),
          batch2Actions,
        );

        const wrongInput = new VoteReducerPublicInput({
          fromActionsHash: Field(123),
          votingLedgerRoot: publicInput.votingLedgerRoot,
          fromNullifierRoot: publicInput.fromNullifierRoot,
          actionStateHistory,
        });

        await assert.rejects(
          async () => VoteReducer.merge(wrongInput, proof1.proof, proof2.proof),
          /Vote reducer merge public input does not match first proof input/,
        );
      },
    );

    await t.test(
      "should reject merge when action hash chain is not contiguous",
      async () => {
        const actionStateHistory = context.buildActionStateHistory([
          new VoteAction({
            vote: Vote.YAY,
            publicKey: testContext.testAccounts[0].publicKey,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: testContext.testAccounts[1].publicKey,
          }),
        ]);

        const publicInput = new VoteReducerPublicInput({
          fromActionsHash: Reducer.initialActionState,
          votingLedgerRoot: await testContext.votingLedger.getRoot(),
          fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
          actionStateHistory,
        });

        const batch1Actions = [
          new VoteAction({
            vote: Vote.YAY,
            publicKey: testContext.testAccounts[0].publicKey,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const batch2Actions = [
          new VoteAction({
            vote: Vote.NAY,
            publicKey: testContext.testAccounts[1].publicKey,
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
            actionStateHistory,
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
        const actionStateHistory = context.buildActionStateHistory([
          new VoteAction({
            vote: Vote.YAY,
            publicKey: testContext.testAccounts[0].publicKey,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: testContext.testAccounts[1].publicKey,
          }),
        ]);

        const publicInput = new VoteReducerPublicInput({
          fromActionsHash: Reducer.initialActionState,
          votingLedgerRoot: await testContext.votingLedger.getRoot(),
          fromNullifierRoot: await testContext.nullifierLedger.getRoot(),
          actionStateHistory,
        });

        const batch1Actions = [
          new VoteAction({
            vote: Vote.YAY,
            publicKey: testContext.testAccounts[0].publicKey,
          }),
          new VoteAction({
            vote: Vote.NAY,
            publicKey: testContext.testAccounts[1].publicKey,
          }),
          ...context.createDummyVoteActions(VOTE_ACTION_BATCH_SIZE),
        ].slice(0, VOTE_ACTION_BATCH_SIZE);

        const batch2Actions = [
          new VoteAction({
            vote: Vote.ABSTRAIN,
            publicKey: testContext.testAccounts[2].publicKey,
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
            actionStateHistory,
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
