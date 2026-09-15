import assert from "node:assert/strict";
import test from "node:test";
import { Reducer } from "o1js";
import {
  Vote,
  VoteAction,
  VoteReducer,
  VoteReducerProof,
  VoteReducerPublicInput,
  voteReducerContext,
} from "../../../src/provable/contracts/treasury-proposal/vote-reducer.js";
import {
  buildHistoryTarget,
  createVoteReducerFixture,
  padActions,
} from "./helpers.js";

type Fixture = Awaited<ReturnType<typeof createVoteReducerFixture>>;

function action(fixture: Fixture, account: number, vote: Vote): VoteAction {
  return new VoteAction({
    vote,
    publicKey: fixture.accounts[account]!.publicKey,
  });
}

async function withFixture(
  label: string,
  run: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const fixture = await createVoteReducerFixture(label);
  try {
    await run(fixture);
  } finally {
    voteReducerContext.set({
      votingLedger: fixture.votingLedger,
      nullifierLedger: fixture.nullifierLedger,
    });
    await fixture.cleanup();
  }
}

async function createProofPair(fixture: Fixture, contiguous: boolean) {
  const batchOne = padActions([
    action(fixture, 0, Vote.YAY),
    action(fixture, 1, Vote.NAY),
    action(fixture, 2, Vote.ABSTRAIN),
  ]);
  const batchTwo = padActions([
    action(fixture, 3, Vote.YAY),
    action(fixture, 4, Vote.NAY),
  ]);
  const realActions = [...batchOne.slice(0, 3), ...batchTwo.slice(0, 2)];
  const history = buildHistoryTarget(realActions);
  const inputOne = await fixture.publicInput(realActions, {
    actionStateHistoryTarget: history,
  });
  const proofOne = await VoteReducer.reduceBatch(inputOne, batchOne);
  const inputTwo = new VoteReducerPublicInput({
    fromActionsHash: contiguous
      ? proofOne.proof.publicOutput.toActionsHash
      : Reducer.initialActionState,
    votingLedgerRoot: inputOne.votingLedgerRoot,
    fromNullifierRoot: proofOne.proof.publicOutput.toNullifierRoot,
    actionStateHistoryTarget: history,
  });
  const proofTwo = await VoteReducer.reduceBatch(inputTwo, batchTwo);
  return {
    inputOne,
    inputTwo,
    proofOne: proofOne.proof,
    proofTwo: proofTwo.proof,
  };
}

test(
  "proof-off Vote Reducer merge assurance",
  { concurrency: 1 },
  async (t) => {
    assert.equal(
      process.env.PROOFS_ENABLED,
      "false",
      "this lane must run with PROOFS_ENABLED=false",
    );
    const proofsEnabled = String(process.env.PROOFS_ENABLED) === "true";
    await VoteReducer.compile({ proofsEnabled });

    await t.test(
      "ZK-VOTE-MERGE-001 merges contiguous children in order",
      async () => {
        await withFixture("merge-contiguous", async (fixture) => {
          const { inputOne, proofOne, proofTwo } = await createProofPair(
            fixture,
            true,
          );
          const merged = await VoteReducer.merge(inputOne, proofOne, proofTwo);
          const output = merged.proof.publicOutput;

          assert.equal(output.yay.toBigInt(), 16n);
          assert.equal(output.nay.toBigInt(), 26n);
          assert.equal(output.abstain.toBigInt(), 8n);
          assert.equal(
            output.toActionsHash.toString(),
            proofTwo.publicOutput.toActionsHash.toString(),
          );
          assert.equal(
            output.toNullifierRoot.toString(),
            proofTwo.publicOutput.toNullifierRoot.toString(),
          );
          for (const state of Object.values(output.actionStateHistory)) {
            assert.equal(state.found.toBoolean(), true);
          }
        });
      },
    );

    await t.test(
      "ZK-VOTE-MERGE-004 rejects a discontinuous action-hash chain",
      async () => {
        await withFixture("merge-discontinuous", async (fixture) => {
          const { inputOne, proofOne, proofTwo } = await createProofPair(
            fixture,
            false,
          );

          await assert.rejects(
            () => VoteReducer.merge(inputOne, proofOne, proofTwo),
            /Action hash chain is not contiguous between merged proofs/,
          );
        });
      },
    );

    await t.test(
      "ZK-VOTE-MERGE-004 rejects valid child proofs in reverse order",
      async () => {
        await withFixture("merge-reversed", async (fixture) => {
          const { inputTwo, proofOne, proofTwo } = await createProofPair(
            fixture,
            true,
          );

          await assert.rejects(
            () => VoteReducer.merge(inputTwo, proofTwo, proofOne),
            /Action hash chain is not contiguous between merged proofs/,
          );
        });
      },
    );

    await t.test(
      "ZK-VOTE-MERGE-015 records the proof-off artifact boundary without authenticity credit",
      async () => {
        await withFixture("merge-proof-off-artifact", async (fixture) => {
          const { inputOne, proofOne, proofTwo } = await createProofPair(
            fixture,
            true,
          );
          const merged = await VoteReducer.merge(inputOne, proofOne, proofTwo);
          const serialized = merged.proof.toJSON();
          const decoded = await VoteReducerProof.fromJSON(serialized);

          assert.equal(process.env.PROOFS_ENABLED, "false");
          assert.deepEqual(decoded.toJSON(), serialized);
          assert.equal(
            decoded.publicOutput.toActionsHash.toString(),
            proofTwo.publicOutput.toActionsHash.toString(),
          );
          assert.equal(decoded.maxProofsVerified, 2);
        });
      },
    );
  },
);
