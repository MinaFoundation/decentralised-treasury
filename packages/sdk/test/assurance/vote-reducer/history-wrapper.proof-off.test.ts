import assert from "node:assert/strict";
import test from "node:test";
import { Bool, Field, Reducer, UInt64, ZkProgram } from "o1js";
import type { InMemoryNullifierLedger } from "../../../src/ledgers/nullifier-ledger/in-memory-nullifier-ledger.js";
import type { InMemoryVotingLedger } from "../../../src/ledgers/voting-ledger/in-memory-voting-ledger.js";
import {
  ActionStateHistory,
  ActionStateHistoryTarget,
  SideLoadedVoteReducerProof,
  Vote,
  VoteAction,
  VoteReducer,
  VoteReducerProof,
  VoteReducerPublicInput,
  VoteReducerPublicOutput,
  voteReducerContext,
} from "../../../src/provable/contracts/treasury-proposal/vote-reducer.js";
import { VotingAccount } from "../../../src/provable/voting-account.js";
import { VoteReducerProver } from "../../../src/proving/prover/vote-reducer-prover.js";
import {
  VoteReducerRunBatchTrace,
  VoteReducerTracer,
} from "../../../src/proving/tracing/vote-reducer-tracer.js";
import type { VoteReducerRunBatchTraceStorage } from "../../../src/storage/vote-reducer-run-batch-trace-storage.js";
import {
  actionHash,
  buildHistoryTarget,
  createVoteReducerFixture,
  padActions,
} from "./helpers.js";

type Fixture = Awaited<ReturnType<typeof createVoteReducerFixture>>;
type ReducerProof = InstanceType<typeof VoteReducerProof>;

const AlternateProgram = ZkProgram({
  name: "assurance-alternate-vote-reducer-program",
  publicInput: VoteReducerPublicInput,
  publicOutput: VoteReducerPublicOutput,
  methods: {
    copy: {
      privateInputs: [VoteReducerPublicOutput],
      method: async (
        _input: VoteReducerPublicInput,
        output: VoteReducerPublicOutput,
      ) => ({ publicOutput: output }),
    },
  },
});

const AlternateKeyProgram = ZkProgram({
  name: "assurance-alternate-vote-reducer-key",
  publicInput: VoteReducerPublicInput,
  publicOutput: VoteReducerPublicOutput,
  methods: {
    constrainedCopy: {
      privateInputs: [VoteReducerPublicOutput],
      method: async (
        input: VoteReducerPublicInput,
        output: VoteReducerPublicOutput,
      ) => {
        input.votingLedgerRoot.equals(input.votingLedgerRoot).assertTrue();
        return { publicOutput: output };
      },
    },
  },
});

class MemoryTraceStorage implements VoteReducerRunBatchTraceStorage {
  readonly traces = new Map<number, VoteReducerRunBatchTrace>();

  async getTrace(index: number): Promise<VoteReducerRunBatchTrace | undefined> {
    return this.traces.get(index);
  }

  async setTrace(
    index: number,
    trace: VoteReducerRunBatchTrace,
  ): Promise<void> {
    this.traces.set(index, trace);
  }

  async getAllTraces(): Promise<VoteReducerRunBatchTrace[]> {
    return [...this.traces.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, trace]) => trace);
  }

  collectEntries(): [] {
    return [];
  }

  clearEntries(): void {}

  async clear(): Promise<void> {
    this.traces.clear();
  }

  async close(): Promise<void> {}
}

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

function cloneInput(
  input: VoteReducerPublicInput,
  overrides: Partial<{
    fromActionsHash: Field;
    votingLedgerRoot: Field;
    fromNullifierRoot: Field;
    actionStateHistoryTarget: ActionStateHistoryTarget;
  }> = {},
): VoteReducerPublicInput {
  return new VoteReducerPublicInput({
    fromActionsHash: overrides.fromActionsHash ?? input.fromActionsHash,
    votingLedgerRoot: overrides.votingLedgerRoot ?? input.votingLedgerRoot,
    fromNullifierRoot: overrides.fromNullifierRoot ?? input.fromNullifierRoot,
    actionStateHistoryTarget:
      overrides.actionStateHistoryTarget ?? input.actionStateHistoryTarget,
  });
}

function cloneHistory(
  history: ActionStateHistory,
  firstHash = history.actionStateOne.hash,
): ActionStateHistory {
  const clone = ActionStateHistory.clone(history);
  clone.actionStateOne.hash = firstHash;
  return clone;
}

function cloneOutput(
  output: VoteReducerPublicOutput,
  overrides: Partial<{
    toActionsHash: Field;
    toNullifierRoot: Field;
    yay: UInt64;
    nay: UInt64;
    abstain: UInt64;
    actionStateHistory: ActionStateHistory;
  }> = {},
): VoteReducerPublicOutput {
  return new VoteReducerPublicOutput({
    toActionsHash: overrides.toActionsHash ?? output.toActionsHash,
    toNullifierRoot: overrides.toNullifierRoot ?? output.toNullifierRoot,
    yay: overrides.yay ?? output.yay,
    nay: overrides.nay ?? output.nay,
    abstain: overrides.abstain ?? output.abstain,
    actionStateHistory:
      overrides.actionStateHistory ??
      ActionStateHistory.clone(output.actionStateHistory),
  });
}

async function dummyProof(
  input: VoteReducerPublicInput,
  output: VoteReducerPublicOutput,
): Promise<ReducerProof> {
  return await VoteReducerProof.dummy(input, output, 2);
}

async function buildProofs(
  fixture: Fixture,
  actions: readonly VoteAction[],
  target = buildHistoryTarget(actions),
): Promise<ReducerProof[]> {
  const proofs: ReducerProof[] = [];
  let input = await fixture.publicInput(actions, {
    actionStateHistoryTarget: target,
  });
  for (const voteAction of actions) {
    const result = await VoteReducer.reduceBatch(
      input,
      padActions([voteAction]),
    );
    proofs.push(result.proof);
    input = new VoteReducerPublicInput({
      fromActionsHash: result.proof.publicOutput.toActionsHash,
      votingLedgerRoot: input.votingLedgerRoot,
      fromNullifierRoot: result.proof.publicOutput.toNullifierRoot,
      actionStateHistoryTarget: target,
    });
  }
  return proofs;
}

async function mergePair(
  first: ReducerProof,
  second: ReducerProof,
): Promise<ReducerProof> {
  return (await VoteReducer.merge(first.publicInput, first, second)).proof;
}

async function mergeLeft(
  proofs: readonly ReducerProof[],
): Promise<ReducerProof> {
  let result = proofs[0]!;
  for (const proof of proofs.slice(1)) result = await mergePair(result, proof);
  return result;
}

async function mergeRight(
  proofs: readonly ReducerProof[],
): Promise<ReducerProof> {
  let result = proofs.at(-1)!;
  for (let index = proofs.length - 2; index >= 0; index--) {
    result = await mergePair(proofs[index]!, result);
  }
  return result;
}

function targetFromStates(states: readonly Field[]): ActionStateHistoryTarget {
  const newest = [...states].reverse();
  while (newest.length < 5) newest.push(Reducer.initialActionState);
  return new ActionStateHistoryTarget({
    actionStateOne: newest[0]!,
    actionStateTwo: newest[1]!,
    actionStateThree: newest[2]!,
    actionStateFour: newest[3]!,
    actionStateFive: newest[4]!,
  });
}

function snapshot(target: ActionStateHistoryTarget) {
  return {
    actionStateOne: target.actionStateOne.toString(),
    actionStateTwo: target.actionStateTwo.toString(),
    actionStateThree: target.actionStateThree.toString(),
    actionStateFour: target.actionStateFour.toString(),
    actionStateFive: target.actionStateFive.toString(),
  };
}

async function traceActions(
  fixture: Fixture,
  actions: VoteAction[],
  target = buildHistoryTarget(actions.slice(0, 5)),
): Promise<VoteReducerRunBatchTrace[]> {
  const traceStorage = new MemoryTraceStorage();
  const nullifierLedger = Object.assign(fixture.nullifierLedger, {
    collectEntries: () => [],
    clearEntries: () => undefined,
  });
  const tracer = new VoteReducerTracer(
    fixture.votingLedger as unknown as InMemoryVotingLedger,
    nullifierLedger as unknown as InMemoryNullifierLedger,
    traceStorage,
    { setMany: async () => undefined, close: async () => undefined },
    { actionStateHistoryTarget: snapshot(target) },
  );
  await tracer.runBatch(actions);
  return await traceStorage.getAllTraces();
}

async function setBalance(
  fixture: Fixture,
  accountIndex: number,
  balance: UInt64,
): Promise<void> {
  const key = fixture.accounts[accountIndex]!.publicKey.toBase58();
  const account = new VotingAccount({ balance });
  await fixture.votingLedger.setVotingAccount(key, account);
  await fixture.votingLedger.setLeaf(key, account);
}

test.before(async () => {
  const proofsEnabled = process.env.PROOFS_ENABLED === "true";
  assert.equal(
    proofsEnabled,
    false,
    "This suite must run with PROOFS_ENABLED=false",
  );
  await VoteReducer.compile({ proofsEnabled });
  await AlternateProgram.compile({ proofsEnabled });
  await AlternateKeyProgram.compile({ proofsEnabled });
});

test(
  "Vote Reducer proof-off direct cardinality characterizes sizes two through six",
  { concurrency: 1 },
  async (t) => {
    for (const method of ["raw", "public"] as const) {
      for (const count of [2, 3, 4, 5, 6] as const) {
        const id =
          method === "raw"
            ? count === 4
              ? "ZK-VOTE-REDUCE-003"
              : count === 5
                ? "ZK-VOTE-REDUCE-004"
                : count === 6
                  ? "ZK-VOTE-REDUCE-005"
                  : "ZK-VOTE-REDUCE-003"
            : count === 4
              ? "ZK-VOTE-REDUCE-008"
              : count === 5
                ? "ZK-VOTE-REDUCE-009"
                : count === 6
                  ? "ZK-VOTE-REDUCE-010"
                  : "ZK-VOTE-REDUCE-008";
        await t.test(`${id} ${method} size ${count}`, async () => {
          await withFixture(`${method}-${count}`, async (fixture) => {
            const actions = Array.from({ length: count }, (_, index) =>
              action(fixture, index, Vote.YAY),
            );
            const input = await fixture.publicInput(actions.slice(0, 5));
            const execute = async () =>
              method === "raw"
                ? (await VoteReducer.rawMethods.reduceBatch(input, actions))
                    .publicOutput
                : (await VoteReducer.reduceBatch(input, actions)).proof
                    .publicOutput;

            if (count < 5) {
              await assert.rejects(execute);
              return;
            }
            const output = await execute();
            const processed = actions.slice(0, 5);
            const expected = processed.reduce(
              (sum, voteAction) =>
                sum +
                fixture.accounts
                  .find((candidate) =>
                    candidate.publicKey
                      .equals(voteAction.publicKey)
                      .toBoolean(),
                  )!
                  .balance.toBigInt(),
              0n,
            );
            assert.equal(output.yay.toBigInt(), expected);
            assert.equal(
              output.toActionsHash.toString(),
              actionHash(processed).toString(),
            );
          });
        });
      }
    }
  },
);

test(
  "Vote Reducer proof-off tracer preserves sizes one through six",
  { concurrency: 1 },
  async (t) => {
    for (const count of [1, 2, 3, 4, 5, 6] as const) {
      const id =
        count === 1
          ? "ZK-VOTE-REDUCE-012"
          : count === 4
            ? "ZK-VOTE-REDUCE-013"
            : count === 5
              ? "ZK-VOTE-REDUCE-014"
              : count === 6
                ? "ZK-VOTE-REDUCE-015"
                : "ZK-VOTE-REDUCE-013";
      await t.test(`${id} tracer size ${count}`, async () => {
        await withFixture(`tracer-${count}`, async (fixture) => {
          const actions = Array.from({ length: count }, (_, index) =>
            action(fixture, index, Vote.YAY),
          );
          const traces = await traceActions(fixture, actions);
          assert.equal(traces.length, count > 5 ? 2 : 1);
          const recovered = traces
            .flatMap((trace) => trace.privateInput.voteActions)
            .filter(
              (voteAction) => !VoteAction.isDummy(voteAction).toBoolean(),
            );
          assert.deepEqual(
            recovered.map((voteAction) => VoteAction.toJSON(voteAction)),
            actions.map((voteAction) => VoteAction.toJSON(voteAction)),
          );
          assert.equal(
            traces.every(
              (trace) => trace.privateInput.voteActions.length === 5,
            ),
            true,
          );
        });
      });
    }
  },
);

test(
  "Vote Reducer proof-off covers vote decoding, dummy identity, and balance boundaries",
  { concurrency: 1 },
  async (t) => {
    await t.test(
      "ZK-VOTE-REDUCE-024 records a dummy vote with a real key",
      async () => {
        await withFixture("dummy-real-key", async (fixture) => {
          const realKeyDummy = action(fixture, 0, Vote.DUMMY);
          const before = await fixture.nullifierLedger.getRoot();
          const result = await VoteReducer.reduceBatch(
            await fixture.publicInput([realKeyDummy]),
            padActions([realKeyDummy]),
          );
          const output = result.proof.publicOutput;
          assert.equal(VoteAction.isDummy(realKeyDummy).toBoolean(), false);
          assert.equal(output.yay.toBigInt(), 0n);
          assert.equal(output.nay.toBigInt(), 0n);
          assert.equal(output.abstain.toBigInt(), 0n);
          assert.notEqual(
            output.toActionsHash.toString(),
            Reducer.initialActionState.toString(),
          );
          assert.notEqual(output.toNullifierRoot.toString(), before.toString());
        });
      },
    );

    await t.test(
      "ZK-VOTE-REDUCE-025 rejects an invalid vote before ledger writes",
      async () => {
        await withFixture("invalid-vote", async (fixture) => {
          const before = await fixture.nullifierLedger.getRoot();
          const invalid = action(fixture, 0, new Vote(4));
          await assert.rejects(
            async () =>
              VoteReducer.reduceBatch(
                await fixture.publicInput([invalid]),
                padActions([invalid]),
              ),
            /Invalid vote/,
          );
          assert.equal(
            (await fixture.nullifierLedger.getRoot()).toString(),
            before.toString(),
          );
        });
      },
    );

    await t.test("POL-003 records malformed VoteAction decoding", () => {
      const malformed = VoteAction.fromJSON({ vote: "not-a-field" });
      assert.equal(VoteAction.isDummy(malformed).toBoolean(), true);
    });

    for (const boundary of [
      { id: "ZK-VOTE-REDUCE-021", name: "zero", value: 0n },
      { id: "ZK-VOTE-REDUCE-016", name: "one", value: 1n },
      {
        id: "ZK-VOTE-REDUCE-022",
        name: "maximum",
        value: UInt64.MAXINT().toBigInt(),
      },
    ] as const) {
      await t.test(
        `${boundary.id} accepts ${boundary.name} balance`,
        async () => {
          await withFixture(`balance-${boundary.name}`, async (fixture) => {
            await setBalance(fixture, 0, UInt64.from(boundary.value));
            const actions = padActions([action(fixture, 0, Vote.YAY)]);
            const output = (
              await VoteReducer.reduceBatch(
                await fixture.publicInput(actions),
                actions,
              )
            ).proof.publicOutput;
            assert.equal(output.yay.toBigInt(), boundary.value);
          });
        },
      );
    }
  },
);

test(
  "Vote Reducer proof-off rejects each reduce overflow and records host writes",
  { concurrency: 1 },
  async (t) => {
    for (const overflow of [
      { id: "ZK-VOTE-REDUCE-033", vote: Vote.YAY },
      { id: "ZK-VOTE-REDUCE-034", vote: Vote.NAY },
      { id: "ZK-VOTE-REDUCE-035", vote: Vote.ABSTRAIN },
    ] as const) {
      await t.test(overflow.id, async () => {
        await withFixture(overflow.id, async (fixture) => {
          await setBalance(fixture, 0, UInt64.MAXINT());
          await setBalance(fixture, 1, UInt64.from(1));
          const actions = padActions([
            action(fixture, 0, overflow.vote),
            action(fixture, 1, overflow.vote),
          ]);
          const beforeVoting = await fixture.votingLedger.getRoot();
          const beforeNullifier = await fixture.nullifierLedger.getRoot();
          await assert.rejects(async () =>
            VoteReducer.reduceBatch(
              await fixture.publicInput(actions),
              actions,
            ),
          );
          assert.equal(
            (await fixture.votingLedger.getRoot()).toString(),
            beforeVoting.toString(),
          );
          assert.notEqual(
            (await fixture.nullifierLedger.getRoot()).toString(),
            beforeNullifier.toString(),
            "current witness callbacks write before overflow rejection",
          );
        });
      });
    }
  },
);

test(
  "Vote Reducer proof-off merge covers recursive shapes and independent relations",
  { concurrency: 1 },
  async (t) => {
    await withFixture("merge-relations", async (fixture) => {
      const realActions = Array.from({ length: 5 }, (_, index) =>
        action(fixture, index, index % 2 === 0 ? Vote.YAY : Vote.NAY),
      );
      const proofs = await buildProofs(fixture, realActions);
      const leftThree = await mergeLeft(proofs.slice(0, 3));
      const rightThree = await mergeRight(proofs.slice(0, 3));
      const leftFive = await mergeLeft(proofs);
      const rightFive = await mergeRight(proofs);

      await t.test("ZK-VOTE-MERGE-010 three-proof associativity", () => {
        assert.deepEqual(
          VoteReducerPublicOutput.toJSON(leftThree.publicOutput),
          VoteReducerPublicOutput.toJSON(rightThree.publicOutput),
        );
      });
      await t.test("ZK-VOTE-MERGE-011 five-proof alternate trees", () => {
        assert.deepEqual(
          VoteReducerPublicOutput.toJSON(leftFive.publicOutput),
          VoteReducerPublicOutput.toJSON(rightFive.publicOutput),
        );
      });

      const first = proofs[0]!;
      const second = proofs[1]!;
      const before = await fixture.nullifierLedger.getRoot();
      const changedHistory = cloneHistory(
        second.publicOutput.actionStateHistory,
        second.publicOutput.actionStateHistory.actionStateOne.hash.add(1),
      );
      const cases = [
        {
          id: "ZK-VOTE-MERGE-002",
          name: "merge input",
          input: cloneInput(first.publicInput, {
            fromActionsHash: first.publicInput.fromActionsHash.add(1),
          }),
          child: second,
          error: /public input does not match first proof input/,
        },
        {
          id: "ZK-VOTE-MERGE-003",
          name: "voting root",
          input: first.publicInput,
          child: await dummyProof(
            cloneInput(second.publicInput, {
              votingLedgerRoot: second.publicInput.votingLedgerRoot.add(1),
            }),
            cloneOutput(second.publicOutput),
          ),
          error: /Voting ledger root does not match between merged proofs/,
        },
        {
          id: "ZK-VOTE-MERGE-005",
          name: "nullifier root",
          input: first.publicInput,
          child: await dummyProof(
            cloneInput(second.publicInput, {
              fromNullifierRoot: second.publicInput.fromNullifierRoot.add(1),
            }),
            cloneOutput(second.publicOutput),
          ),
          error: /Nullifier root does not match between merged proofs/,
        },
        {
          id: "ZK-VOTE-MERGE-006",
          name: "history target",
          input: first.publicInput,
          child: await dummyProof(
            second.publicInput,
            cloneOutput(second.publicOutput, {
              actionStateHistory: changedHistory,
            }),
          ),
          error: /Action state hash does not match between merged proofs/,
        },
      ] as const;
      for (const scenario of cases) {
        await t.test(`${scenario.id} rejects ${scenario.name}`, async () => {
          await assert.rejects(
            () => VoteReducer.merge(scenario.input, first, scenario.child),
            scenario.error,
          );
          assert.equal(
            (await fixture.nullifierLedger.getRoot()).toString(),
            before.toString(),
          );
        });
      }
    });
  },
);

test(
  "Vote Reducer proof-off records alternate-program and alternate-key boundaries",
  { concurrency: 1 },
  async (t) => {
    await withFixture("alternate-program", async (fixture) => {
      const proofs = await buildProofs(fixture, [
        action(fixture, 0, Vote.YAY),
        action(fixture, 1, Vote.NAY),
      ]);
      const first = proofs[0]!;
      const second = proofs[1]!;
      const alternateProof = (
        await AlternateProgram.copy(second.publicInput, second.publicOutput)
      ).proof;
      const alternateKeyProof = (
        await AlternateKeyProgram.constrainedCopy(
          second.publicInput,
          second.publicOutput,
        )
      ).proof;
      for (const scenario of [
        { id: "ZK-VOTE-MERGE-007", proof: alternateProof },
        { id: "ZK-VOTE-MERGE-008", proof: alternateKeyProof },
      ] as const) {
        await t.test(scenario.id, async () => {
          const output = (
            await VoteReducer.rawMethods.merge(
              first.publicInput,
              first,
              scenario.proof as unknown as ReducerProof,
            )
          ).publicOutput;
          assert.equal(
            output.toActionsHash.toString(),
            second.publicOutput.toActionsHash.toString(),
          );
        });
      }
    });
  },
);

test(
  "Vote Reducer proof-off rejects each merge overflow without ledger writes",
  { concurrency: 1 },
  async (t) => {
    await withFixture("merge-overflow", async (fixture) => {
      const proofs = await buildProofs(fixture, [
        action(fixture, 0, Vote.YAY),
        action(fixture, 1, Vote.NAY),
      ]);
      const first = proofs[0]!;
      const second = proofs[1]!;
      const before = await fixture.nullifierLedger.getRoot();
      for (const scenario of [
        { id: "ZK-VOTE-MERGE-012", field: "yay" },
        { id: "ZK-VOTE-MERGE-013", field: "nay" },
        { id: "ZK-VOTE-MERGE-014", field: "abstain" },
      ] as const) {
        await t.test(scenario.id, async () => {
          const firstOutput = cloneOutput(first.publicOutput, {
            [scenario.field]: UInt64.MAXINT(),
          });
          const secondOutput = cloneOutput(second.publicOutput, {
            [scenario.field]: UInt64.from(1),
          });
          await assert.rejects(async () =>
            VoteReducer.rawMethods.merge(
              first.publicInput,
              await dummyProof(first.publicInput, firstOutput),
              await dummyProof(second.publicInput, secondOutput),
            ),
          );
          assert.equal(
            (await fixture.nullifierLedger.getRoot()).toString(),
            before.toString(),
          );
        });
      }
    });
  },
);

test(
  "Vote Reducer proof-off records action order, target reuse, and long history",
  { concurrency: 1 },
  async (t) => {
    await withFixture("history-targets", async (fixture) => {
      const actions = Array.from({ length: 5 }, (_, index) =>
        action(fixture, index, Vote.YAY),
      );
      const states = actions.map((_, index) =>
        actionHash(actions.slice(0, index + 1)),
      );
      const base = targetFromStates(states);
      const cases = [
        {
          id: "ZK-VOTE-HISTORY-003",
          name: "initial target",
          target: new ActionStateHistoryTarget({
            ...base,
            actionStateOne: Reducer.initialActionState,
          }),
          expected: [false, true, true, true, true],
        },
        {
          id: "ZK-VOTE-HISTORY-004",
          name: "duplicate target",
          target: new ActionStateHistoryTarget({
            ...base,
            actionStateTwo: base.actionStateOne,
          }),
          expected: [true, true, true, true, true],
        },
        {
          id: "ZK-VOTE-HISTORY-005",
          name: "wrong final target",
          target: new ActionStateHistoryTarget({
            ...base,
            actionStateOne: base.actionStateOne.add(1),
          }),
          expected: [false, true, true, true, true],
        },
        {
          id: "ZK-VOTE-HISTORY-006",
          name: "reversed targets",
          target: targetFromStates([...states].reverse()),
          expected: [true, true, true, true, true],
        },
      ] as const;
      for (const scenario of cases) {
        await t.test(`${scenario.id} ${scenario.name}`, async () => {
          const isolated = await createVoteReducerFixture(scenario.id);
          try {
            const isolatedActions = Array.from({ length: 5 }, (_, index) =>
              action(isolated, index, Vote.YAY),
            );
            const output = (
              await VoteReducer.reduceBatch(
                await isolated.publicInput(isolatedActions, {
                  actionStateHistoryTarget: scenario.target,
                }),
                isolatedActions,
              )
            ).proof.publicOutput;
            assert.deepEqual(
              Object.values(output.actionStateHistory).map((entry) =>
                entry.found.toBoolean(),
              ),
              scenario.expected,
            );
          } finally {
            await isolated.cleanup();
          }
        });
      }
    });

    await t.test(
      "ZK-VOTE-HISTORY-007 retains the last five of six states",
      async () => {
        await withFixture("history-six", async (fixture) => {
          const actions = Array.from({ length: 6 }, (_, index) =>
            action(fixture, index, Vote.YAY),
          );
          const states = actions.map((_, index) =>
            actionHash(actions.slice(0, index + 1)),
          );
          const target = targetFromStates(states.slice(1));
          const batchOne = actions.slice(0, 5);
          const first = await VoteReducer.reduceBatch(
            await fixture.publicInput(actions, {
              actionStateHistoryTarget: target,
            }),
            batchOne,
          );
          const secondInput = cloneInput(first.proof.publicInput, {
            fromActionsHash: first.proof.publicOutput.toActionsHash,
            fromNullifierRoot: first.proof.publicOutput.toNullifierRoot,
          });
          const second = await VoteReducer.reduceBatch(
            secondInput,
            padActions([actions[5]!]),
          );
          const merged = await mergePair(first.proof, second.proof);
          assert.equal(
            Object.values(merged.publicOutput.actionStateHistory).every(
              (entry) => entry.found.toBoolean(),
            ),
            true,
          );
        });
      },
    );
  },
);

test("ZK-VOTE-REDUCE-032/ZK-VOTE-HISTORY-008 records equal-root lifecycle reuse", async () => {
  const observations: string[] = [];
  for (const label of ["lifecycle-a", "lifecycle-b"] as const) {
    await withFixture(label, async (fixture) => {
      const actions = padActions([action(fixture, 0, Vote.YAY)]);
      const input = await fixture.publicInput(actions);
      const output = (await VoteReducer.reduceBatch(input, actions)).proof
        .publicOutput;
      observations.push(
        JSON.stringify({
          input: VoteReducerPublicInput.toJSON(input),
          output: VoteReducerPublicOutput.toJSON(output),
        }),
      );
    });
  }
  assert.equal(observations[0], observations[1]);
});

test(
  "Vote Reducer proof-off prover wrapper preflights preserve storage",
  { concurrency: 1 },
  async (t) => {
    let obliterateCalls = 0;
    let addTaskCalls = 0;
    let published: SideLoadedVoteReducerProof | undefined;
    const traceStorage = {
      getTrace: async () => undefined,
      close: async () => undefined,
    };
    const proofStorage = {
      count: async () => 0,
      getProof: async (_id?: string) => undefined,
      getMergeProof: async () => undefined,
      setMergeProof: async (_id: string, proof: SideLoadedVoteReducerProof) => {
        published = proof;
      },
      markAsMerged: async () => undefined,
      isMerged: async () => false,
      mergeCount: async () => 0,
      collectEntries: () => [],
      clearEntries: () => undefined,
      clear: async () => undefined,
      close: async () => undefined,
    };
    const queue = {
      obliterate: async () => {
        obliterateCalls++;
      },
      addTask: async () => {
        addTaskCalls++;
      },
      waitUntilEmpty: async () => undefined,
      close: async () => undefined,
    };
    const prover = new VoteReducerProver(
      traceStorage as never,
      proofStorage as never,
      { setMany: async () => undefined, close: async () => undefined },
      queue as never,
    );

    await t.test(
      "ZK-VOTE-REDUCE-011 no trace performs no proof work",
      async () => {
        await prover.runBatch();
        assert.equal(obliterateCalls, 1);
        assert.equal(addTaskCalls, 0);
        assert.equal(published, undefined);
      },
    );
    await t.test("wrapper rejects merge with no base proofs", async () => {
      await assert.rejects(
        () => prover.merge(),
        /No base proofs found. Run proving before merge/,
      );
      assert.equal(published, undefined);
    });

    await withFixture("single-wrapper-proof", async (fixture) => {
      const actions = padActions([action(fixture, 0, Vote.YAY)]);
      const base = (
        await VoteReducer.reduceBatch(
          await fixture.publicInput(actions),
          actions,
        )
      ).proof;
      const sideLoaded = await SideLoadedVoteReducerProof.fromJSON(
        base.toJSON(),
      );
      proofStorage.count = async () => 1;
      proofStorage.getProof = async (id?: string) =>
        id === "0" ? sideLoaded : undefined;
      await t.test(
        "ZK-VOTE-MERGE-009 publishes one base proof as root",
        async () => {
          const root = await prover.merge();
          assert.equal(root, sideLoaded);
          assert.equal(published, sideLoaded);
          assert.equal(addTaskCalls, 0);
        },
      );
    });
  },
);
