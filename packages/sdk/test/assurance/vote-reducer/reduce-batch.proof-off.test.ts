import assert from "node:assert/strict";
import test from "node:test";
import { Bool, Reducer, UInt64 } from "o1js";
import type { NullifierLedger } from "../../../src/ledgers/nullifier-ledger/nullifier-ledger.js";
import type { VotingLedger } from "../../../src/ledgers/voting-ledger/voting-ledger.js";
import {
  Vote,
  VoteAction,
  VoteReducer,
  VoteReducerPublicInput,
  voteReducerContext,
  voteReducerErrors,
} from "../../../src/provable/contracts/treasury-proposal/vote-reducer.js";
import { VotingAccount } from "../../../src/provable/voting-account.js";
import {
  actionHash,
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

function assertTallies(
  output: {
    yay: { toBigInt(): bigint };
    nay: { toBigInt(): bigint };
    abstain: { toBigInt(): bigint };
  },
  expected: { yay?: bigint; nay?: bigint; abstain?: bigint },
): void {
  assert.equal(output.yay.toBigInt(), expected.yay ?? 0n, "yay tally");
  assert.equal(output.nay.toBigInt(), expected.nay ?? 0n, "nay tally");
  assert.equal(
    output.abstain.toBigInt(),
    expected.abstain ?? 0n,
    "abstain tally",
  );
}

async function ledgerSnapshot(fixture: Fixture) {
  return {
    voting: (await fixture.votingLedger.getRoot()).toString(),
    nullifier: (await fixture.nullifierLedger.getRoot()).toString(),
  };
}

function classifyConstraintFailure(error: unknown): "CONSTRAINT_UNSATISFIED" {
  assert.ok(error instanceof Error);
  assert.match(
    error.message,
    /Voting ledger root does not match|Calculated nullifier root does not match/,
  );
  return "CONSTRAINT_UNSATISFIED";
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

test(
  "proof-off Vote Reducer batch assurance",
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
      "ZK-VOTE-REDUCE-001/002 reject raw empty and single-entry arrays",
      async () => {
        for (const testCase of [
          {
            id: "ZK-VOTE-REDUCE-001",
            actions: [],
            nullifierChanges: false,
          },
          {
            id: "ZK-VOTE-REDUCE-002",
            actions: ["single"],
            nullifierChanges: true,
          },
        ] as const) {
          await withFixture(testCase.id, async (fixture) => {
            const actions =
              testCase.actions.length === 0
                ? []
                : [action(fixture, 0, Vote.YAY)];
            const input = await fixture.publicInput(actions);
            const before = await ledgerSnapshot(fixture);
            await assert.rejects(
              async () => {
                await VoteReducer.rawMethods.reduceBatch(input, actions);
              },
              undefined,
              testCase.id,
            );
            const after = await ledgerSnapshot(fixture);
            assert.equal(after.voting, before.voting);
            if (testCase.nullifierChanges) {
              assert.notEqual(after.nullifier, before.nullifier);
            } else {
              assert.equal(after.nullifier, before.nullifier);
            }
          });
        }
      },
    );

    await t.test(
      "ZK-VOTE-REDUCE-006/007 record public reducer zero/one cardinality behavior",
      async () => {
        for (const testCase of [
          { id: "ZK-VOTE-REDUCE-006", count: 0, nullifierChanges: false },
          { id: "ZK-VOTE-REDUCE-007", count: 1, nullifierChanges: true },
        ] as const) {
          await withFixture(testCase.id, async (fixture) => {
            const actions =
              testCase.count === 0 ? [] : [action(fixture, 0, Vote.YAY)];
            const before = await ledgerSnapshot(fixture);
            await assert.rejects(
              async () =>
                VoteReducer.reduceBatch(
                  await fixture.publicInput(actions),
                  actions,
                ),
              undefined,
              testCase.id,
            );
            const after = await ledgerSnapshot(fixture);
            assert.equal(after.voting, before.voting);
            if (testCase.nullifierChanges) {
              assert.notEqual(after.nullifier, before.nullifier);
            } else {
              assert.equal(after.nullifier, before.nullifier);
            }
          });
        }
      },
    );

    await t.test(
      "ZK-VOTE-REDUCE-023 keeps an empty padded batch neutral",
      async () => {
        await withFixture("empty-padded", async (fixture) => {
          const actions = padActions([]);
          const input = await fixture.publicInput(actions);
          const result = await VoteReducer.reduceBatch(input, actions);
          const output = result.proof.publicOutput;

          assertTallies(output, {});
          assert.equal(
            output.toActionsHash.toString(),
            Reducer.initialActionState.toString(),
          );
          assert.equal(
            output.toNullifierRoot.toString(),
            input.fromNullifierRoot.toString(),
          );
          for (const state of Object.values(output.actionStateHistory)) {
            assert.equal(state.found.toBoolean(), true);
          }
        });
      },
    );

    await t.test(
      "ZK-VOTE-REDUCE-016 tallies single yay, nay, and abstain actions",
      async () => {
        const cases = [
          { name: "yay", vote: Vote.YAY, tally: "yay" },
          { name: "nay", vote: Vote.NAY, tally: "nay" },
          { name: "abstain", vote: Vote.ABSTRAIN, tally: "abstain" },
        ] as const;

        for (const testCase of cases) {
          await withFixture(`single-${testCase.name}`, async (fixture) => {
            const realAction = action(fixture, 2, testCase.vote);
            const actions = padActions([realAction]);
            const result = await VoteReducer.reduceBatch(
              await fixture.publicInput(actions),
              actions,
            );
            const expected = { [testCase.tally]: 8n };

            assertTallies(result.proof.publicOutput, expected);
            assert.equal(
              result.proof.publicOutput.toActionsHash.toString(),
              actionHash([realAction]).toString(),
              testCase.name,
            );
          });
        }
      },
    );

    await t.test(
      "ZK-VOTE-REDUCE-004/016 and ZK-VOTE-HISTORY-001 tally a full batch",
      async () => {
        await withFixture("full-batch", async (fixture) => {
          const actions = [
            action(fixture, 0, Vote.YAY),
            action(fixture, 1, Vote.NAY),
            action(fixture, 2, Vote.ABSTRAIN),
            action(fixture, 3, Vote.YAY),
            action(fixture, 4, Vote.NAY),
          ];
          const result = await VoteReducer.reduceBatch(
            await fixture.publicInput(actions),
            actions,
          );
          const output = result.proof.publicOutput;

          assertTallies(output, { yay: 16n, nay: 26n, abstain: 8n });
          assert.equal(
            output.toActionsHash.toString(),
            actionHash(actions).toString(),
          );
          for (const state of Object.values(output.actionStateHistory)) {
            assert.equal(state.found.toBoolean(), true);
          }
        });
      },
    );

    await t.test(
      "ZK-VOTE-REDUCE-017 counts a same-batch duplicate once but hashes both",
      async () => {
        await withFixture("same-batch-duplicate", async (fixture) => {
          const actions = padActions([
            action(fixture, 0, Vote.YAY),
            action(fixture, 0, Vote.YAY),
            action(fixture, 1, Vote.NAY),
          ]);
          const result = await VoteReducer.reduceBatch(
            await fixture.publicInput(actions),
            actions,
          );

          assertTallies(result.proof.publicOutput, { yay: 3n, nay: 5n });
          assert.equal(
            result.proof.publicOutput.toActionsHash.toString(),
            actionHash(actions).toString(),
          );
          assert.equal(
            result.proof.publicOutput.toNullifierRoot.toString(),
            (await fixture.nullifierLedger.getRoot()).toString(),
          );
        });
      },
    );

    await t.test(
      "ZK-VOTE-REDUCE-018 prevents a duplicate across two batches",
      async () => {
        await withFixture("cross-batch-duplicate", async (fixture) => {
          const batchOne = padActions([action(fixture, 0, Vote.YAY)]);
          const batchTwo = padActions([
            action(fixture, 0, Vote.NAY),
            action(fixture, 1, Vote.ABSTRAIN),
          ]);
          const realActions = [batchOne[0]!, batchTwo[0]!, batchTwo[1]!];
          const history = buildHistoryTarget(realActions);
          const inputOne = await fixture.publicInput(realActions, {
            actionStateHistoryTarget: history,
          });
          const proofOne = await VoteReducer.reduceBatch(inputOne, batchOne);
          const inputTwo = new VoteReducerPublicInput({
            fromActionsHash: proofOne.proof.publicOutput.toActionsHash,
            votingLedgerRoot: inputOne.votingLedgerRoot,
            fromNullifierRoot: proofOne.proof.publicOutput.toNullifierRoot,
            actionStateHistoryTarget: history,
          });
          const proofTwo = await VoteReducer.reduceBatch(inputTwo, batchTwo);

          assertTallies(proofOne.proof.publicOutput, { yay: 3n });
          assertTallies(proofTwo.proof.publicOutput, { abstain: 5n });
          assert.equal(
            proofTwo.proof.publicOutput.toActionsHash.toString(),
            actionHash(realActions).toString(),
          );
        });
      },
    );

    await t.test(
      "ZK-VOTE-REDUCE-019 gives an already-nullified action zero weight",
      async () => {
        await withFixture("already-nullified", async (fixture) => {
          const voter = fixture.accounts[0]!.publicKey.toBase58();
          await fixture.nullifierLedger.setNullifier(voter, Bool(true));
          await fixture.nullifierLedger.setLeaf(voter, Bool(true));
          const initialRoot = await fixture.nullifierLedger.getRoot();
          const realAction = action(fixture, 0, Vote.YAY);
          const actions = padActions([realAction]);
          const result = await VoteReducer.reduceBatch(
            await fixture.publicInput(actions),
            actions,
          );

          assertTallies(result.proof.publicOutput, {});
          assert.equal(
            result.proof.publicOutput.toNullifierRoot.toString(),
            initialRoot.toString(),
          );
          assert.equal(
            result.proof.publicOutput.toActionsHash.toString(),
            actionHash([realAction]).toString(),
          );
        });
      },
    );

    await t.test(
      "ZK-VOTE-HISTORY-002 records a wrong target as not found",
      async () => {
        await withFixture("wrong-history-target", async (fixture) => {
          const realAction = action(fixture, 0, Vote.YAY);
          const actions = padActions([realAction]);
          const wrongTarget = buildHistoryTarget([
            action(fixture, 1, Vote.YAY),
          ]);
          const result = await VoteReducer.reduceBatch(
            await fixture.publicInput(actions, {
              actionStateHistoryTarget: wrongTarget,
            }),
            actions,
          );

          assert.equal(
            result.proof.publicOutput.actionStateHistory.actionStateOne.found.toBoolean(),
            false,
          );
          assert.notEqual(
            result.proof.publicOutput.toActionsHash.toString(),
            wrongTarget.actionStateOne.toString(),
          );
        });
      },
    );

    await t.test(
      "ZK-VOTE-REDUCE-026/027/028/029 reject witness and root mismatches",
      async () => {
        const cases = [
          {
            id: "ZK-VOTE-REDUCE-026",
            error: voteReducerErrors.VOTING_ACCOUNT_INDEX_DOES_NOT_MATCH,
            configure: async (
              fixture: Fixture,
              input: VoteReducerPublicInput,
            ) => {
              const votingLedger = fixture.votingLedger;
              const wrongKey = fixture.accounts[1]!.publicKey.toBase58();
              const mismatched: VotingLedger = {
                getVotingAccount:
                  votingLedger.getVotingAccount.bind(votingLedger),
                setVotingAccount:
                  votingLedger.setVotingAccount.bind(votingLedger),
                getWitness: () => votingLedger.getWitness(wrongKey),
                setLeaf: votingLedger.setLeaf.bind(votingLedger),
                getRoot: votingLedger.getRoot.bind(votingLedger),
                close: votingLedger.close.bind(votingLedger),
              };
              voteReducerContext.set({
                votingLedger: mismatched,
                nullifierLedger: fixture.nullifierLedger,
              });
              return input;
            },
          },
          {
            id: "ZK-VOTE-REDUCE-027",
            error: voteReducerErrors.VOTING_LEDGER_ROOT_DOES_NOT_MATCH,
            configure: async (
              _fixture: Fixture,
              input: VoteReducerPublicInput,
            ) =>
              new VoteReducerPublicInput({
                ...input,
                votingLedgerRoot: input.votingLedgerRoot.add(1),
              }),
          },
          {
            id: "ZK-VOTE-REDUCE-028",
            error: voteReducerErrors.INVALID_WITNESS_FOR_THE_VOTE_NULLIFIER,
            configure: async (
              fixture: Fixture,
              input: VoteReducerPublicInput,
            ) => {
              const nullifierLedger = fixture.nullifierLedger;
              const wrongKey = fixture.accounts[1]!.publicKey.toBase58();
              const mismatched: NullifierLedger = {
                getNullifier:
                  nullifierLedger.getNullifier.bind(nullifierLedger),
                setNullifier:
                  nullifierLedger.setNullifier.bind(nullifierLedger),
                getWitness: () => nullifierLedger.getWitness(wrongKey),
                setLeaf: nullifierLedger.setLeaf.bind(nullifierLedger),
                getRoot: nullifierLedger.getRoot.bind(nullifierLedger),
                close: nullifierLedger.close.bind(nullifierLedger),
              };
              voteReducerContext.set({
                votingLedger: fixture.votingLedger,
                nullifierLedger: mismatched,
              });
              return input;
            },
          },
          {
            id: "ZK-VOTE-REDUCE-029",
            error:
              voteReducerErrors.CALCULATED_NULLIFIER_ROOT_DOES_NOT_MATCH_TO_NULLIFIER_ROOT,
            configure: async (
              _fixture: Fixture,
              input: VoteReducerPublicInput,
            ) =>
              new VoteReducerPublicInput({
                ...input,
                fromNullifierRoot: input.fromNullifierRoot.add(1),
              }),
          },
        ] as const;

        for (const testCase of cases) {
          await withFixture(testCase.id, async (fixture) => {
            const actions = padActions([action(fixture, 0, Vote.YAY)]);
            const input = await testCase.configure(
              fixture,
              await fixture.publicInput(actions),
            );
            await assert.rejects(
              () => VoteReducer.reduceBatch(input, actions),
              new RegExp(testCase.error),
              testCase.id,
            );
          });
        }
      },
    );

    await t.test(
      "ZK-VOTE-REDUCE-020/030/031 reject missing or stale ledger data",
      async () => {
        for (const testCase of [
          {
            id: "ZK-VOTE-REDUCE-020",
            error: /Voting ledger root does not match/,
            configure: async (fixture: Fixture) => {
              const key = fixture.accounts[0]!.publicKey.toBase58();
              const votingLedger = fixture.votingLedger;
              const missingAccount: VotingLedger = {
                getVotingAccount: async (publicKey) =>
                  publicKey === key
                    ? VotingAccount.empty()
                    : votingLedger.getVotingAccount(publicKey),
                setVotingAccount:
                  votingLedger.setVotingAccount.bind(votingLedger),
                getWitness: votingLedger.getWitness.bind(votingLedger),
                setLeaf: votingLedger.setLeaf.bind(votingLedger),
                getRoot: votingLedger.getRoot.bind(votingLedger),
                close: votingLedger.close.bind(votingLedger),
              };
              voteReducerContext.set({
                votingLedger: missingAccount,
                nullifierLedger: fixture.nullifierLedger,
              });
            },
          },
          {
            id: "ZK-VOTE-REDUCE-030",
            error: /Voting ledger root does not match/,
            configure: async (fixture: Fixture) => {
              const key = fixture.accounts[0]!.publicKey.toBase58();
              const staleWitness = await fixture.votingLedger.getWitness(key);
              const changedKey = fixture.accounts[1]!.publicKey.toBase58();
              const changedAccount = new VotingAccount({
                balance: UInt64.from(89),
              });
              await fixture.votingLedger.setVotingAccount(
                changedKey,
                changedAccount,
              );
              await fixture.votingLedger.setLeaf(changedKey, changedAccount);
              const votingLedger = fixture.votingLedger;
              const staleVotingLedger: VotingLedger = {
                getVotingAccount:
                  votingLedger.getVotingAccount.bind(votingLedger),
                setVotingAccount:
                  votingLedger.setVotingAccount.bind(votingLedger),
                getWitness: async (publicKey) =>
                  publicKey === key
                    ? staleWitness
                    : votingLedger.getWitness(publicKey),
                setLeaf: votingLedger.setLeaf.bind(votingLedger),
                getRoot: votingLedger.getRoot.bind(votingLedger),
                close: votingLedger.close.bind(votingLedger),
              };
              voteReducerContext.set({
                votingLedger: staleVotingLedger,
                nullifierLedger: fixture.nullifierLedger,
              });
            },
          },
          {
            id: "ZK-VOTE-REDUCE-031",
            error: /Calculated nullifier root does not match/,
            configure: async (fixture: Fixture) => {
              const key = fixture.accounts[0]!.publicKey.toBase58();
              const staleWitness =
                await fixture.nullifierLedger.getWitness(key);
              const changedKey = fixture.accounts[1]!.publicKey.toBase58();
              await fixture.nullifierLedger.setNullifier(
                changedKey,
                Bool(true),
              );
              await fixture.nullifierLedger.setLeaf(changedKey, Bool(true));
              const nullifierLedger = fixture.nullifierLedger;
              const staleNullifierLedger: NullifierLedger = {
                getNullifier:
                  nullifierLedger.getNullifier.bind(nullifierLedger),
                setNullifier:
                  nullifierLedger.setNullifier.bind(nullifierLedger),
                getWitness: async (publicKey) =>
                  publicKey === key
                    ? staleWitness
                    : nullifierLedger.getWitness(publicKey),
                setLeaf: nullifierLedger.setLeaf.bind(nullifierLedger),
                getRoot: nullifierLedger.getRoot.bind(nullifierLedger),
                close: nullifierLedger.close.bind(nullifierLedger),
              };
              voteReducerContext.set({
                votingLedger: fixture.votingLedger,
                nullifierLedger: staleNullifierLedger,
              });
            },
          },
        ] as const) {
          await withFixture(testCase.id, async (fixture) => {
            await testCase.configure(fixture);
            const actions = padActions([action(fixture, 0, Vote.YAY)]);
            const input = await fixture.publicInput(actions);
            const before = await ledgerSnapshot(fixture);
            await assert.rejects(
              () => VoteReducer.reduceBatch(input, actions),
              (error) => {
                assert.match((error as Error).message, testCase.error);
                assert.equal(
                  classifyConstraintFailure(error),
                  "CONSTRAINT_UNSATISFIED",
                );
                return true;
              },
              testCase.id,
            );
            assert.deepEqual(await ledgerSnapshot(fixture), before);
          });
        }
      },
    );

    await t.test(
      "ZK-VOTE-REDUCE-022 accepts the maximum-minus-one balance",
      async () => {
        await withFixture("balance-maximum-minus-one", async (fixture) => {
          const key = fixture.accounts[0]!.publicKey.toBase58();
          const balance = UInt64.from(UInt64.MAXINT().toBigInt() - 1n);
          const account = new VotingAccount({ balance });
          await fixture.votingLedger.setVotingAccount(key, account);
          await fixture.votingLedger.setLeaf(key, account);
          const before = await ledgerSnapshot(fixture);
          const actions = padActions([action(fixture, 0, Vote.YAY)]);
          const output = (
            await VoteReducer.reduceBatch(
              await fixture.publicInput(actions),
              actions,
            )
          ).proof.publicOutput;

          assert.equal(output.yay.toBigInt(), balance.toBigInt());
          assert.equal(output.nay.toBigInt(), 0n);
          assert.equal(output.abstain.toBigInt(), 0n);
          assert.equal(
            output.toActionsHash.toString(),
            actionHash(actions).toString(),
          );
          assert.equal(
            output.toNullifierRoot.toString(),
            (await fixture.nullifierLedger.getRoot()).toString(),
          );
          assert.equal(
            (await fixture.votingLedger.getRoot()).toString(),
            before.voting,
          );
          assert.notEqual(output.toNullifierRoot.toString(), before.nullifier);
        });
      },
    );
  },
);
