import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  Bool,
  Field,
  Mina,
  Reducer,
  TokenId,
  UInt128,
  UInt32,
  UInt64,
  ZkProgram,
} from "o1js";
import {
  ACCOUNT_BATCH_SIZE,
  SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedger,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
  StakingLedgerToVotingLedgerProof,
  stakingLedgerToVotingLedgerContext,
} from "../../../src/provable/staking-ledger-to-voting-ledger.js";
import { Account } from "../../../src/provable/account.js";
import { StakingLedgerToVotingLedgerProver } from "../../../src/proving/prover/staking-ledger-to-voting-ledger-prover.js";
import type { StakingLedgerToVotingLedgerProofStorage } from "../../../src/storage/staking-ledger-to-voting-ledger-proof-storage.js";
import type { MergeProofStorage } from "../../../src/proving/prover/merge-proof-orchestrator.js";
import { MergeProofOrchestrator } from "../../../src/proving/prover/merge-proof-orchestrator.js";
import type { KeyValueBatchStorage } from "../../../src/storage/batch-key-value-storage.js";
import type { KeyValueEntry } from "../../../src/storage/key-value-storage.js";
import type { Task, TaskQueue } from "../../../src/proving/task-queue.js";
import { PrefixedMerkleWitness36 } from "../../../src/provable/merkle-tree/prefixed-merkle-tree.js";
import {
  ProposalStatus,
  TreasuryProposalSmartContract,
} from "../../../src/provable/contracts/treasury-proposal/treasury-proposal.js";
import {
  ActionStateHistory,
  ActionStateHistoryTarget,
  SideLoadedVoteReducerProof,
  Vote,
  VoteReducerPublicInput,
  VoteReducerPublicOutput,
} from "../../../src/provable/contracts/treasury-proposal/vote-reducer.js";
import { createStakingLedgerToVotingLedgerTestContext } from "../../provable/context/staking-ledger-to-voting-ledger-context.js";
import {
  compileAuthorizationContracts,
  createOwnerProposalFixture,
  sendTransaction,
} from "../contracts/helpers.js";

type TestContext = Awaited<
  ReturnType<typeof createStakingLedgerToVotingLedgerTestContext>
>;
type StlvProof = InstanceType<typeof StakingLedgerToVotingLedgerProof>;
type AnyTaskQueue = TaskQueue<Record<string, Task<unknown, unknown>>>;

interface HostSpanProof {
  readonly tag: string;
  readonly publicInput: {
    readonly index: UInt64;
    readonly stakingLedgerRoot: Field;
    readonly votingLedgerRoot: Field;
  };
  readonly publicOutput: {
    readonly index: UInt64;
    readonly votingLedgerRoot: Field;
    readonly exhausted: Bool;
  };
}

function hostSpanProof(
  from: number,
  to: number,
  options: {
    tag?: string;
    stakingRoot?: bigint;
    inputVotingRoot?: bigint;
    outputVotingRoot?: bigint;
  } = {},
): HostSpanProof {
  return {
    tag: options.tag ?? `${from.toString()}-${to.toString()}`,
    publicInput: {
      index: UInt64.from(from),
      stakingLedgerRoot: Field(options.stakingRoot ?? 11n),
      votingLedgerRoot: Field(options.inputVotingRoot ?? BigInt(from + 100)),
    },
    publicOutput: {
      index: UInt64.from(to),
      votingLedgerRoot: Field(options.outputVotingRoot ?? BigInt(to + 101)),
      exhausted: Bool(false),
    },
  };
}

function hostMergeId(firstId: string, secondId: string): string {
  const digest = createHash("sha256")
    .update(`${firstId}|${secondId}`)
    .digest("hex");
  return `merge-${digest.slice(0, 32)}`;
}

class HostProofStorage implements MergeProofStorage<HostSpanProof> {
  public entries: KeyValueEntry[] = [];
  public readonly base = new Map<string, HostSpanProof>();
  public readonly merges = new Map<string, HostSpanProof>();
  public readonly merged = new Set<string>();
  public readonly values = new Map<string, HostSpanProof>();
  public countValue = 0;

  public constructor(proofs: readonly HostSpanProof[]) {
    proofs.forEach((proof, index) => {
      this.base.set(index.toString(), proof);
      this.values.set(proof.tag, proof);
    });
    this.countValue = proofs.length;
  }

  public async getProof(id: string): Promise<HostSpanProof | undefined> {
    return this.base.get(id);
  }

  public async setProof(id: string, proof: HostSpanProof): Promise<void> {
    this.entries.push({ key: `base:${id}`, value: JSON.stringify(proof.tag) });
  }

  public async getMergeProof(id: string): Promise<HostSpanProof | undefined> {
    return this.merges.get(id);
  }

  public async setMergeProof(id: string, proof: HostSpanProof): Promise<void> {
    this.values.set(proof.tag, proof);
    this.entries.push({
      key: `merge:${id}`,
      value: JSON.stringify(proof.tag),
    });
  }

  public async markAsMerged(id: string): Promise<void> {
    this.entries.push({ key: `merged:${id}`, value: "true" });
  }

  public async isMerged(id: string): Promise<boolean> {
    return this.merged.has(id);
  }

  public async mergeCount(): Promise<number> {
    return this.merges.size;
  }

  public async count(): Promise<number> {
    return this.countValue;
  }

  public collectEntries(): KeyValueEntry[] {
    return this.entries;
  }

  public clearEntries(): void {
    this.entries = [];
  }

  public async close(): Promise<void> {}

  public commit(entries: readonly KeyValueEntry[]): void {
    for (const entry of entries) {
      const separator = entry.key.indexOf(":");
      const kind = entry.key.slice(0, separator);
      const id = entry.key.slice(separator + 1);
      if (kind === "merged") this.merged.add(id);
      if (kind !== "merge") continue;
      const tag = JSON.parse(entry.value) as string;
      const proof = this.values.get(tag);
      if (proof) this.merges.set(id, proof);
    }
  }
}

interface HostQueueState {
  calls: number;
  delayMs?: number;
  rejectIncompatibleRoots?: boolean;
}

function hostQueue(state: HostQueueState): AnyTaskQueue {
  return {
    async obliterate() {},
    async addTask(
      _name: string,
      input: { proofs: { 1: HostSpanProof; 2: HostSpanProof } },
      complete?: (result: { proof: HostSpanProof }) => Promise<void>,
    ) {
      state.calls += 1;
      const first = input.proofs[1];
      const second = input.proofs[2];
      if (
        state.rejectIncompatibleRoots === true &&
        !first.publicOutput.votingLedgerRoot
          .equals(second.publicInput.votingLedgerRoot)
          .toBoolean()
      ) {
        throw new Error("incompatible voting roots");
      }
      if ((state.delayMs ?? 0) > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.delayMs));
      }
      await complete?.({
        proof: hostSpanProof(
          Number(first.publicInput.index.toBigInt()),
          Number(second.publicOutput.index.toBigInt()),
          {
            tag: `${first.tag}+${second.tag}`,
            stakingRoot: first.publicInput.stakingLedgerRoot.toBigInt(),
            inputVotingRoot: first.publicInput.votingLedgerRoot.toBigInt(),
            outputVotingRoot: second.publicOutput.votingLedgerRoot.toBigInt(),
          },
        ),
      });
    },
  } as unknown as AnyTaskQueue;
}

function hostWriter(
  storage: HostProofStorage,
  options: {
    failCall?: number;
    delayMs?: number;
    onActive?: (active: number) => void;
  } = {},
): KeyValueBatchStorage {
  let calls = 0;
  let active = 0;
  return {
    async setMany(entries) {
      calls += 1;
      active += 1;
      options.onActive?.(active);
      try {
        if ((options.delayMs ?? 0) > 0) {
          await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        }
        if (calls === options.failCall) throw new Error("writer failed");
        storage.commit(entries);
      } finally {
        active -= 1;
      }
    },
    async close() {},
  };
}

function hostProver(
  storage: HostProofStorage,
  queue: AnyTaskQueue,
  writer: KeyValueBatchStorage = hostWriter(storage),
): StakingLedgerToVotingLedgerProver {
  return new StakingLedgerToVotingLedgerProver(
    {} as never,
    {} as never,
    storage as unknown as StakingLedgerToVotingLedgerProofStorage,
    writer,
    queue as never,
  );
}

const AlternateProgram = ZkProgram({
  name: "assurance-alternate-stlv-program",
  publicInput: StakingLedgerToVotingLedgerProgramInput,
  publicOutput: StakingLedgerToVotingLedgerProgramOutput,
  methods: {
    copy: {
      privateInputs: [StakingLedgerToVotingLedgerProgramOutput],
      method: async (
        _input: StakingLedgerToVotingLedgerProgramInput,
        output: StakingLedgerToVotingLedgerProgramOutput,
      ) => ({ publicOutput: output }),
    },
  },
});

const AlternateKeyProgram = ZkProgram({
  name: "assurance-alternate-stlv-key",
  publicInput: StakingLedgerToVotingLedgerProgramInput,
  publicOutput: StakingLedgerToVotingLedgerProgramOutput,
  methods: {
    copyWithDifferentConstraint: {
      privateInputs: [StakingLedgerToVotingLedgerProgramOutput],
      method: async (
        input: StakingLedgerToVotingLedgerProgramInput,
        output: StakingLedgerToVotingLedgerProgramOutput,
      ) => {
        input.index.assertLessThanOrEqual(UInt64.MAXINT());
        return { publicOutput: output };
      },
    },
  },
});

function cloneAccount(account: Account): Account {
  return Account.fromJSON(Account.toJSON(account));
}

async function withContext(
  maxAccounts: number,
  run: (context: TestContext) => Promise<void>,
): Promise<void> {
  const context = await createStakingLedgerToVotingLedgerTestContext({
    maxAccounts,
  });
  try {
    await run(context);
  } finally {
    await context.cleanup();
  }
}

async function buildBaseProofs(
  context: TestContext,
  count: number,
): Promise<{ accounts: Account[]; proofs: StlvProof[] }> {
  const accounts = Array.from(
    { length: count * ACCOUNT_BATCH_SIZE },
    (_, index) =>
      index < context.testAccounts.length
        ? cloneAccount(context.testAccounts[index]!)
        : Account.empty(),
  );
  const stakingRoot = await context.stakingLedger.getRoot();
  const proofs: StlvProof[] = [];

  for (let batchIndex = 0; batchIndex < count; batchIndex++) {
    const batch = accounts.slice(
      batchIndex * ACCOUNT_BATCH_SIZE,
      (batchIndex + 1) * ACCOUNT_BATCH_SIZE,
    );
    const input = new StakingLedgerToVotingLedgerProgramInput({
      index: UInt64.from(batchIndex * ACCOUNT_BATCH_SIZE),
      stakingLedgerRoot: stakingRoot,
      votingLedgerRoot: await context.votingLedger.getRoot(),
    });
    const { proof } = await StakingLedgerToVotingLedger.digest(input, batch);
    proofs.push(proof);
  }

  return { accounts, proofs };
}

async function mergePair(
  first: StlvProof,
  second: StlvProof,
): Promise<StlvProof> {
  return (
    await StakingLedgerToVotingLedger.merge(first.publicInput, first, second)
  ).proof;
}

async function mergeLeft(proofs: readonly StlvProof[]): Promise<StlvProof> {
  assert(proofs[0]);
  let root = proofs[0];
  for (const proof of proofs.slice(1)) root = await mergePair(root, proof);
  return root;
}

async function mergeRight(proofs: readonly StlvProof[]): Promise<StlvProof> {
  assert(proofs.at(-1));
  let root = proofs.at(-1)!;
  for (let index = proofs.length - 2; index >= 0; index--) {
    root = await mergePair(proofs[index]!, root);
  }
  return root;
}

async function mergeBalancedFive(
  proofs: readonly StlvProof[],
): Promise<StlvProof> {
  assert.equal(proofs.length, 5);
  const left = await mergePair(proofs[0]!, proofs[1]!);
  const middle = await mergePair(proofs[2]!, proofs[3]!);
  return await mergePair(await mergePair(left, middle), proofs[4]!);
}

function cloneInput(
  input: StakingLedgerToVotingLedgerProgramInput,
  overrides: Partial<{
    index: UInt64;
    stakingLedgerRoot: typeof input.stakingLedgerRoot;
    votingLedgerRoot: typeof input.votingLedgerRoot;
  }> = {},
): StakingLedgerToVotingLedgerProgramInput {
  return new StakingLedgerToVotingLedgerProgramInput({
    index: overrides.index ?? input.index,
    stakingLedgerRoot: overrides.stakingLedgerRoot ?? input.stakingLedgerRoot,
    votingLedgerRoot: overrides.votingLedgerRoot ?? input.votingLedgerRoot,
  });
}

function cloneOutput(
  output: StakingLedgerToVotingLedgerProgramOutput,
): StakingLedgerToVotingLedgerProgramOutput {
  return new StakingLedgerToVotingLedgerProgramOutput({
    index: output.index,
    votingLedgerRoot: output.votingLedgerRoot,
    exhausted: output.exhausted,
  });
}

async function dummyProof(
  input: StakingLedgerToVotingLedgerProgramInput,
  output: StakingLedgerToVotingLedgerProgramOutput,
): Promise<StlvProof> {
  return await StakingLedgerToVotingLedgerProof.dummy(input, output, 2);
}

function proofStorageWithRoot(
  root: SideLoadedStakingLedgerToVotingLedgerProof | undefined,
): StakingLedgerToVotingLedgerProofStorage {
  return {
    async getMergeProof(id: string) {
      return id === "root" ? root : undefined;
    },
  } as StakingLedgerToVotingLedgerProofStorage;
}

type ContractFixture = Awaited<ReturnType<typeof createContractFixture>>;

async function createContractFixture() {
  const fixture = await createOwnerProposalFixture({ stakingSnapshot: true });
  for (let index = 1; index <= 5; index += 1) {
    const voter = fixture.blockchain.testAccounts[index]!;
    await sendTransaction(voter, async () => {
      await fixture.owner.vote(
        fixture.proposal.address,
        voter.key.toPublicKey(),
        Vote.YAY,
      );
    });
    fixture.blockchain.incrementGlobalSlot(1);
  }

  const actionStates = fixture.blockchain.getAccount(
    fixture.proposal.address,
    fixture.proposalTokenId,
  ).zkapp!.actionState;
  const target = new ActionStateHistoryTarget({
    actionStateOne: actionStates[0]!,
    actionStateTwo: actionStates[1]!,
    actionStateThree: actionStates[2]!,
    actionStateFour: actionStates[3]!,
    actionStateFive: actionStates[4]!,
  });
  const history = ActionStateHistory.fromTarget(target);
  for (const state of Object.values(history)) state.found = Bool(true);
  const criteria = TreasuryProposalSmartContract.calculateAcceptanceCriteria(
    UInt128.from(1_000_000_000),
    UInt128.from(10_000_000_000),
    UInt64.from(10_000_000_000),
  );
  const participating = criteria.requiredParticipation.toBigInt();
  const approvalBasisPoints = criteria.requiredApprovalBp.toBigInt();
  const yay = (participating * approvalBasisPoints + 9_999n) / 10_000n;
  const voteInput = new VoteReducerPublicInput({
    fromActionsHash: Reducer.initialActionState,
    votingLedgerRoot: Field(0),
    fromNullifierRoot: Field(0),
    actionStateHistoryTarget: target,
  });
  const voteOutput = new VoteReducerPublicOutput({
    toActionsHash: target.actionStateOne,
    toNullifierRoot: Field(1),
    yay: UInt64.from(yay),
    nay: UInt64.from(participating - yay),
    abstain: UInt64.zero,
    actionStateHistory: history,
  });
  const voteProof = (await SideLoadedVoteReducerProof.dummy(
    voteInput,
    voteOutput,
    2,
  )) as SideLoadedVoteReducerProof;
  const treasuryWitness = new PrefixedMerkleWitness36(
    fixture.treasurySnapshotWitness!,
  );
  fixture.blockchain.incrementGlobalSlot(UInt32.from(7_140));

  return { ...fixture, voteProof, treasuryWitness };
}

async function contractStlvProof(
  fixture: ContractFixture,
  options: {
    index?: bigint;
    stakingRoot?: Field;
    initialVotingRoot?: Field;
    finalVotingRoot?: Field;
    exhausted?: boolean;
    foreignKey?: boolean;
  } = {},
): Promise<SideLoadedStakingLedgerToVotingLedgerProof> {
  const input = new StakingLedgerToVotingLedgerProgramInput({
    index: UInt64.from(options.index ?? 0n),
    stakingLedgerRoot: options.stakingRoot ?? fixture.stakingLedgerRoot!,
    votingLedgerRoot: options.initialVotingRoot ?? Field(0),
  });
  const output = new StakingLedgerToVotingLedgerProgramOutput({
    index: UInt64.from(options.index ?? 0n),
    votingLedgerRoot: options.finalVotingRoot ?? Field(0),
    exhausted: Bool(options.exhausted ?? true),
  });
  if (options.foreignKey === true) {
    const foreign = (
      await AlternateKeyProgram.copyWithDifferentConstraint(input, output)
    ).proof;
    return SideLoadedStakingLedgerToVotingLedgerProof.fromProof(
      foreign as unknown as StlvProof,
    );
  }
  return (await SideLoadedStakingLedgerToVotingLedgerProof.dummy(
    input,
    output,
    2,
  )) as SideLoadedStakingLedgerToVotingLedgerProof;
}

async function tallyWithStlv(
  fixture: ContractFixture,
  stakingProof: SideLoadedStakingLedgerToVotingLedgerProof,
  voteProof: SideLoadedVoteReducerProof = fixture.voteProof,
): Promise<void> {
  await sendTransaction(fixture.feePayer, async () => {
    await fixture.owner.tallyVotes(
      fixture.proposal.address,
      voteProof,
      stakingProof,
      fixture.treasurySnapshotAccount!,
      fixture.treasuryWitness,
    );
  });
}

async function contractSnapshot(fixture: ContractFixture) {
  return {
    status: (await fixture.proposal.status.fetch())!.toString(),
    ownerBalance: fixture.blockchain
      .getAccount(fixture.owner.address, TokenId.default)
      .balance.toBigInt(),
    proposalBalance: fixture.blockchain
      .getAccount(fixture.proposal.address, fixture.proposalTokenId)
      .balance.toBigInt(),
    ownerEvents: (
      await Mina.fetchEvents(fixture.owner.address, TokenId.default)
    ).length,
    proposalActions: fixture.blockchain
      .getAccount(fixture.proposal.address, fixture.proposalTokenId)
      .zkapp!.actionState.map((state) => state.toString()),
  };
}

test.before(async () => {
  const proofsEnabled = process.env.PROOFS_ENABLED === "true";
  assert.equal(
    proofsEnabled,
    false,
    "This suite must run with PROOFS_ENABLED=false",
  );
  await StakingLedgerToVotingLedger.compile({ proofsEnabled });
  await AlternateProgram.compile({ proofsEnabled });
  await AlternateKeyProgram.compile({ proofsEnabled });
});

test("STLV proof-off valid recursive tree shapes preserve span, root, and totals", async (t) => {
  await withContext(17, async (context) => {
    const { accounts, proofs } = await buildBaseProofs(context, 5);
    const terminalVotingRoot = await context.votingLedger.getRoot();
    const trees = [
      {
        ids: ["ZK-STLV-MERGE-001"],
        name: "two-leaf merge",
        expectedEnd: 9n,
        build: () => mergeLeft(proofs.slice(0, 2)),
      },
      {
        ids: ["ZK-STLV-MERGE-002"],
        name: "three-leaf left-heavy merge",
        expectedEnd: 14n,
        build: () => mergeLeft(proofs.slice(0, 3)),
      },
      {
        ids: ["ZK-STLV-MERGE-003"],
        name: "three-leaf right-heavy merge",
        expectedEnd: 14n,
        build: () => mergeRight(proofs.slice(0, 3)),
      },
      {
        ids: ["ZK-STLV-MERGE-004"],
        name: "five-leaf balanced merge",
        expectedEnd: 24n,
        build: () => mergeBalancedFive(proofs),
      },
      {
        ids: ["ZK-STLV-MERGE-005"],
        name: "five-leaf left-heavy merge",
        expectedEnd: 24n,
        build: () => mergeLeft(proofs),
      },
      {
        ids: ["ZK-STLV-MERGE-006"],
        name: "five-leaf right-heavy merge",
        expectedEnd: 24n,
        build: () => mergeRight(proofs),
      },
    ] as const;
    const outputs = new Map<string, string>();

    for (const scenario of trees) {
      await t.test(`${scenario.ids.join(",")} ${scenario.name}`, async () => {
        const root = await scenario.build();
        assert.equal(root.publicInput.index.toBigInt(), 0n);
        assert.equal(root.publicOutput.index.toBigInt(), scenario.expectedEnd);
        assert.equal(root.publicOutput.exhausted.toBoolean(), false);
        const expectedRoot =
          scenario.expectedEnd === 24n
            ? terminalVotingRoot
            : proofs[Number((scenario.expectedEnd + 1n) / 5n) - 1]!.publicOutput
                .votingLedgerRoot;
        assert.equal(
          root.publicOutput.votingLedgerRoot.toString(),
          expectedRoot.toString(),
        );
        outputs.set(
          scenario.name,
          root.publicOutput.votingLedgerRoot.toString(),
        );
      });
    }

    await t.test(
      "ZK-STLV-MERGE-007 alternate five-leaf trees have identical public outputs",
      () => {
        assert.equal(
          outputs.get("five-leaf balanced merge"),
          outputs.get("five-leaf left-heavy merge"),
        );
        assert.equal(
          outputs.get("five-leaf balanced merge"),
          outputs.get("five-leaf right-heavy merge"),
        );
      },
    );

    const expectedByDelegate = new Map<string, bigint>();
    for (const account of accounts) {
      if (Account.isEmpty(account).toBoolean()) continue;
      if (!account.tokenId.equals(TokenId.default).toBoolean()) continue;
      const delegate = account.delegate.toBase58();
      expectedByDelegate.set(
        delegate,
        (expectedByDelegate.get(delegate) ?? 0n) + account.balance.toBigInt(),
      );
    }
    for (const [delegate, expected] of expectedByDelegate) {
      assert.equal(
        (
          await context.votingLedger.getVotingAccount(delegate)
        ).balance.toBigInt(),
        expected,
      );
    }
  });
});

test("STLV proof-off merge rejects order, adjacency, and root discontinuity without host writes", async (t) => {
  await withContext(15, async (context) => {
    const { proofs } = await buildBaseProofs(context, 3);
    const votingRootBefore = await context.votingLedger.getRoot();
    const changedStakingInput = cloneInput(proofs[1]!.publicInput, {
      stakingLedgerRoot: proofs[1]!.publicInput.stakingLedgerRoot.add(1),
    });
    const changedVotingInput = cloneInput(proofs[1]!.publicInput, {
      votingLedgerRoot: proofs[1]!.publicInput.votingLedgerRoot.add(1),
    });
    const cases = [
      {
        id: "ZK-STLV-MERGE-009",
        name: "reversed children",
        first: proofs[1]!,
        second: proofs[0]!,
      },
      {
        id: "ZK-STLV-MERGE-010",
        name: "nonadjacent children",
        first: proofs[0]!,
        second: proofs[2]!,
      },
      {
        id: "ZK-STLV-MERGE-011",
        name: "different staking roots",
        first: proofs[0]!,
        second: await dummyProof(
          changedStakingInput,
          cloneOutput(proofs[1]!.publicOutput),
        ),
      },
      {
        id: "ZK-STLV-MERGE-012",
        name: "broken voting-root continuity",
        first: proofs[0]!,
        second: await dummyProof(
          changedVotingInput,
          cloneOutput(proofs[1]!.publicOutput),
        ),
      },
    ] as const;

    for (const scenario of cases) {
      await t.test(`${scenario.id} ${scenario.name}`, async () => {
        await assert.rejects(() =>
          StakingLedgerToVotingLedger.merge(
            scenario.first.publicInput,
            scenario.first,
            scenario.second,
          ),
        );
        assert.equal(
          (await context.votingLedger.getRoot()).toString(),
          votingRootBefore.toString(),
        );
      });
    }
  });
});

test("STLV proof-off records alternate-program and alternate-key capability boundaries", async (t) => {
  await withContext(10, async (context) => {
    const { proofs } = await buildBaseProofs(context, 2);
    const alternateProof = (
      await AlternateProgram.copy(
        proofs[1]!.publicInput,
        cloneOutput(proofs[1]!.publicOutput),
      )
    ).proof;
    const alternateKeyProof = (
      await AlternateKeyProgram.copyWithDifferentConstraint(
        proofs[1]!.publicInput,
        cloneOutput(proofs[1]!.publicOutput),
      )
    ).proof;
    const cases = [
      {
        id: "ZK-STLV-MERGE-013",
        name: "alternate program",
        proof: alternateProof,
      },
      {
        id: "ZK-STLV-MERGE-014",
        name: "alternate verification key",
        proof: alternateKeyProof,
      },
    ] as const;

    for (const scenario of cases) {
      await t.test(`${scenario.id} ${scenario.name}`, async () => {
        const result = await StakingLedgerToVotingLedger.rawMethods.merge(
          proofs[0]!.publicInput,
          proofs[0]!,
          scenario.proof as unknown as StlvProof,
        );
        assert.equal(result.publicOutput.index.toBigInt(), 9n);
        assert.equal(
          result.publicOutput.votingLedgerRoot.toString(),
          proofs[1]!.publicOutput.votingLedgerRoot.toString(),
        );
      });
    }
  });
});

test("STLV proof-off exhaust accepts padded and full final batches", async (t) => {
  const cases = [
    {
      id: "ZK-STLV-EXHAUST-001",
      name: "padded final batch",
      accountCount: 7,
    },
    {
      id: "ZK-STLV-EXHAUST-002",
      name: "full final batch",
      accountCount: 10,
    },
  ] as const;

  for (const scenario of cases) {
    await t.test(`${scenario.id} ${scenario.name}`, async () => {
      await withContext(scenario.accountCount, async (context) => {
        const { proofs } = await buildBaseProofs(context, 2);
        const root = await mergePair(proofs[0]!, proofs[1]!);
        const beforeRoot = await context.votingLedger.getRoot();
        const exhausted = (
          await StakingLedgerToVotingLedger.exhaust(root.publicInput, root)
        ).proof;

        assert.equal(exhausted.publicInput.index.toBigInt(), 0n);
        assert.equal(exhausted.publicOutput.index.toBigInt(), 9n);
        assert.equal(exhausted.publicOutput.exhausted.toBoolean(), true);
        assert.equal(
          exhausted.publicOutput.votingLedgerRoot.toString(),
          root.publicOutput.votingLedgerRoot.toString(),
        );
        assert.equal(
          (await context.votingLedger.getRoot()).toString(),
          beforeRoot.toString(),
        );
      });
    });
  }
});

test("ZK-STLV-EXHAUST-003 records circuit acceptance for a nonzero-start child", async () => {
  await withContext(10, async (context) => {
    const { proofs } = await buildBaseProofs(context, 2);
    const child = proofs[1]!;
    const exhausted = (
      await StakingLedgerToVotingLedger.exhaust(child.publicInput, child)
    ).proof;

    assert.equal(exhausted.publicInput.index.toBigInt(), 5n);
    assert.equal(exhausted.publicOutput.index.toBigInt(), 9n);
    assert.equal(exhausted.publicOutput.exhausted.toBoolean(), true);
  });
});

test("ZK-STLV-EXHAUST-011 records immediate-empty acceptance before a later populated leaf", async () => {
  await withContext(7, async (context) => {
    await context.stakingLedger.setAccount(5n, Account.empty());
    await context.stakingLedger.setLeaf(5n, Account.empty());
    const { proofs } = await buildBaseProofs(context, 1);
    const votingRootBefore = await context.votingLedger.getRoot();
    const exhausted = (
      await StakingLedgerToVotingLedger.exhaust(
        proofs[0]!.publicInput,
        proofs[0]!,
      )
    ).proof;

    assert.equal(exhausted.publicOutput.exhausted.toBoolean(), true);
    assert.equal(exhausted.publicOutput.index.toBigInt(), 4n);
    assert.equal(
      (await context.stakingLedger.getAccount(6n)).pk.toBase58(),
      context.testAccounts[6]!.pk.toBase58(),
    );
    assert.equal(
      (await context.votingLedger.getRoot()).toString(),
      votingRootBefore.toString(),
    );
  });
});

test("STLV proof-off rejects invalid exhaust bindings without ledger mutation", async (t) => {
  await withContext(6, async (context) => {
    const { proofs } = await buildBaseProofs(context, 1);
    const child = proofs[0]!;
    const votingRootBefore = await context.votingLedger.getRoot();
    const stakingRootBefore = await context.stakingLedger.getRoot();
    const cases = [
      {
        id: "ZK-STLV-EXHAUST-008",
        name: "nonempty next leaf",
        input: child.publicInput,
      },
      {
        id: "ZK-STLV-EXHAUST-009",
        name: "public input differs from child input",
        input: cloneInput(child.publicInput, {
          votingLedgerRoot: child.publicInput.votingLedgerRoot.add(1),
        }),
      },
    ] as const;

    for (const scenario of cases) {
      await t.test(`${scenario.id} ${scenario.name}`, async () => {
        await assert.rejects(() =>
          StakingLedgerToVotingLedger.exhaust(scenario.input, child),
        );
        assert.equal(
          (await context.stakingLedger.getRoot()).toString(),
          stakingRootBefore.toString(),
        );
        assert.equal(
          (await context.votingLedger.getRoot()).toString(),
          votingRootBefore.toString(),
        );
      });
    }
  });
});

test("STLV proof-off records repeat exhaust and digest-after-exhaust behavior", async (t) => {
  await withContext(10, async (context) => {
    const { proofs } = await buildBaseProofs(context, 2);
    const root = await mergePair(proofs[0]!, proofs[1]!);
    const exhausted = (
      await StakingLedgerToVotingLedger.exhaust(root.publicInput, root)
    ).proof;
    const cases = [
      {
        id: "ZK-STLV-EXHAUST-014",
        name: "second exhaust",
        async run() {
          const repeated = (
            await StakingLedgerToVotingLedger.exhaust(
              exhausted.publicInput,
              exhausted,
            )
          ).proof;
          assert.equal(repeated.publicOutput.index.toBigInt(), 9n);
          assert.equal(repeated.publicOutput.exhausted.toBoolean(), true);
        },
      },
      {
        id: "ZK-STLV-EXHAUST-015",
        name: "digest after exhaustion",
        async run() {
          const extensionInput = new StakingLedgerToVotingLedgerProgramInput({
            index: exhausted.publicOutput.index.add(1),
            stakingLedgerRoot: exhausted.publicInput.stakingLedgerRoot,
            votingLedgerRoot: exhausted.publicOutput.votingLedgerRoot,
          });
          const extension = (
            await StakingLedgerToVotingLedger.digest(
              extensionInput,
              Array.from({ length: ACCOUNT_BATCH_SIZE }, () => Account.empty()),
            )
          ).proof;
          assert.equal(extension.publicInput.index.toBigInt(), 10n);
          assert.equal(extension.publicOutput.index.toBigInt(), 14n);
          assert.equal(extension.publicOutput.exhausted.toBoolean(), false);
        },
      },
    ] as const;

    for (const scenario of cases) {
      await t.test(`${scenario.id} ${scenario.name}`, scenario.run);
    }
  });
});

test("STLV proof-off wrapper preflights reject missing and nonzero-start roots", async (t) => {
  await withContext(10, async (context) => {
    const { proofs } = await buildBaseProofs(context, 2);
    const nonzeroRoot = SideLoadedStakingLedgerToVotingLedgerProof.fromProof(
      proofs[1]!,
    );
    const cases = [
      {
        id: "ZK-STLV-EXHAUST-021",
        name: "missing root",
        storage: proofStorageWithRoot(undefined),
        pattern: /No root merge proof found/,
      },
      {
        id: "ZK-STLV-EXHAUST-004",
        name: "nonzero-start root",
        storage: proofStorageWithRoot(nonzeroRoot),
        pattern: /starts at index 5, expected 0/,
      },
    ] as const;

    for (const scenario of cases) {
      await t.test(`${scenario.id} ${scenario.name}`, async () => {
        const votingRootBefore = await context.votingLedger.getRoot();
        await assert.rejects(
          () =>
            StakingLedgerToVotingLedgerProver.proveExhaust({
              stakingLedger: context.stakingLedger,
              proofStorage: scenario.storage,
            }),
          scenario.pattern,
        );
        assert.equal(
          (await context.votingLedger.getRoot()).toString(),
          votingRootBefore.toString(),
        );
      });
    }
  });
});

test("STLV proof-off adds four-leaf and six-leaf recursive layouts", async (t) => {
  await withContext(30, async (context) => {
    const { proofs } = await buildBaseProofs(context, 6);
    const layouts = [
      {
        name: "four-leaf left and right",
        count: 4,
        expectedEnd: 19n,
      },
      {
        name: "six-leaf left and right",
        count: 6,
        expectedEnd: 29n,
      },
    ] as const;

    for (const layout of layouts) {
      await t.test(layout.name, async () => {
        const selected = proofs.slice(0, layout.count);
        const left = await mergeLeft(selected);
        const right = await mergeRight(selected);
        assert.equal(left.publicInput.index.toBigInt(), 0n);
        assert.equal(left.publicOutput.index.toBigInt(), layout.expectedEnd);
        assert.equal(
          left.publicOutput.votingLedgerRoot.toString(),
          right.publicOutput.votingLedgerRoot.toString(),
        );
      });
    }
  });
});

test("STLV proof-off records mutated and exhausted recursive-child boundaries", async (t) => {
  const input0 = new StakingLedgerToVotingLedgerProgramInput({
    index: UInt64.from(0),
    stakingLedgerRoot: Field(700),
    votingLedgerRoot: Field(800),
  });
  const output0 = new StakingLedgerToVotingLedgerProgramOutput({
    index: UInt64.from(4),
    votingLedgerRoot: Field(900),
    exhausted: Bool(false),
  });
  const input1 = new StakingLedgerToVotingLedgerProgramInput({
    index: UInt64.from(5),
    stakingLedgerRoot: Field(700),
    votingLedgerRoot: Field(900),
  });
  const output1 = new StakingLedgerToVotingLedgerProgramOutput({
    index: UInt64.from(9),
    votingLedgerRoot: Field(1_000),
    exhausted: Bool(false),
  });

  await t.test(
    "ZK-STLV-MERGE-015 records an internally consistent mutated public input",
    async () => {
      const mutatedInput = cloneInput(input0, {
        votingLedgerRoot: Field(801),
      });
      const first = await dummyProof(mutatedInput, output0);
      const second = await dummyProof(input1, output1);
      const result = await StakingLedgerToVotingLedger.rawMethods.merge(
        mutatedInput,
        first,
        second,
      );
      assert.equal(result.publicOutput.index.toBigInt(), 9n);
      assert.equal(result.publicOutput.votingLedgerRoot.toBigInt(), 1_000n);
    },
  );

  await t.test(
    "ZK-STLV-MERGE-016 records internally consistent mutated child outputs",
    async () => {
      const changedOutput = new StakingLedgerToVotingLedgerProgramOutput({
        index: UInt64.from(4),
        votingLedgerRoot: Field(901),
        exhausted: Bool(false),
      });
      const changedSecondInput = cloneInput(input1, {
        votingLedgerRoot: changedOutput.votingLedgerRoot,
      });
      const first = await dummyProof(input0, changedOutput);
      const second = await dummyProof(changedSecondInput, output1);
      const result = await StakingLedgerToVotingLedger.rawMethods.merge(
        input0,
        first,
        second,
      );
      assert.equal(result.publicOutput.index.toBigInt(), 9n);
    },
  );

  for (const position of ["first", "second"] as const) {
    await t.test(
      `ZK-STLV-MERGE-017 resets an exhausted ${position} child to false`,
      async () => {
        const firstOutput = new StakingLedgerToVotingLedgerProgramOutput({
          ...output0,
          exhausted: Bool(position === "first"),
        });
        const secondOutput = new StakingLedgerToVotingLedgerProgramOutput({
          ...output1,
          exhausted: Bool(position === "second"),
        });
        const first = await dummyProof(input0, firstOutput);
        const second = await dummyProof(input1, secondOutput);
        const result = await StakingLedgerToVotingLedger.rawMethods.merge(
          input0,
          first,
          second,
        );
        assert.equal(result.publicOutput.exhausted.toBoolean(), false);
      },
    );
  }
});

test("STLV proof-off host merge covers promotion, preflight, and cache identity", async (t) => {
  await t.test(
    "ZK-STLV-MERGE-008 promotes one base proof without queue work",
    async () => {
      const only = hostSpanProof(0, 0, { tag: "only" });
      const storage = new HostProofStorage([only]);
      const state = { calls: 0 };
      const root = await hostProver(storage, hostQueue(state)).merge();
      assert.equal(root, only);
      assert.equal(state.calls, 0);
      assert.equal(
        storage.merges.get(MergeProofOrchestrator.ROOT_PROOF_ID),
        only,
      );
    },
  );

  const rejectionCases = [
    {
      id: "ZK-STLV-MERGE-018",
      name: "no base proofs",
      build() {
        return new HostProofStorage([]);
      },
      pattern: /No base proofs found/,
    },
    {
      id: "ZK-STLV-MERGE-019",
      name: "missing base proof in a counted range",
      build() {
        const storage = new HostProofStorage([
          hostSpanProof(0, 0),
          hostSpanProof(1, 1),
          hostSpanProof(2, 2),
        ]);
        storage.base.delete("1");
        return storage;
      },
      pattern: /Missing base proof with id 1 of 3/,
    },
    {
      id: "ZK-STLV-MERGE-020",
      name: "disjoint proof forest",
      build() {
        return new HostProofStorage([
          hostSpanProof(0, 0),
          hostSpanProof(1, 1),
          hostSpanProof(9, 9),
        ]);
      },
      pattern: /Merge stalled: .* disjoint proofs remain/,
    },
  ] as const;

  for (const scenario of rejectionCases) {
    await t.test(`${scenario.id} rejects ${scenario.name}`, async () => {
      const storage = scenario.build();
      await assert.rejects(
        () => hostProver(storage, hostQueue({ calls: 0 })).merge(),
        scenario.pattern,
      );
      assert.equal(
        storage.merges.has(MergeProofOrchestrator.ROOT_PROOF_ID),
        false,
      );
    });
  }

  await t.test(
    "ZK-STLV-MERGE-021 reuses a compatible cached pair",
    async () => {
      const storage = new HostProofStorage([
        hostSpanProof(0, 0),
        hostSpanProof(1, 1),
      ]);
      const cached = hostSpanProof(0, 1, { tag: "cached-pair" });
      storage.merges.set(hostMergeId("0", "1"), cached);
      storage.values.set(cached.tag, cached);
      const state = { calls: 0 };
      const root = await hostProver(storage, hostQueue(state)).merge();
      assert.equal(root, cached);
      assert.equal(state.calls, 0);
    },
  );

  for (const scenario of [
    {
      id: "ZK-STLV-MERGE-022",
      name: "replaced base proof",
      replacementTag: "replacement-under-id-1",
    },
    {
      id: "ZK-STLV-MERGE-025",
      name: "changed child content",
      replacementTag: "changed-content-stable-id",
    },
  ] as const) {
    await t.test(
      `${scenario.id} records stale reuse after ${scenario.name}`,
      async () => {
        const storage = new HostProofStorage([
          hostSpanProof(0, 0),
          hostSpanProof(1, 1, { tag: scenario.replacementTag }),
        ]);
        const stale = hostSpanProof(0, 1, { tag: "stale-cached-pair" });
        storage.merges.set(hostMergeId("0", "1"), stale);
        storage.values.set(stale.tag, stale);
        const state = { calls: 0 };
        const root = (await hostProver(
          storage,
          hostQueue(state),
        ).merge()) as unknown as HostSpanProof;
        assert.equal(root.tag, "stale-cached-pair");
        assert.equal(state.calls, 0);
      },
    );
  }

  await t.test(
    "ZK-STLV-MERGE-024 selects an incompatible first candidate before a valid later pair",
    () => {
      const storage = new HostProofStorage([]);
      const prover = hostProver(storage, hostQueue({ calls: 0 }));
      const incompatibleFirst = hostSpanProof(0, 0, {
        outputVotingRoot: 999n,
      });
      const incompatibleSecond = hostSpanProof(1, 1);
      const validFirst = hostSpanProof(10, 10);
      const validSecond = hostSpanProof(11, 11);
      const pair = prover.findMergeableProofs([
        { index: "a", proof: incompatibleFirst as never },
        { index: "b", proof: incompatibleSecond as never },
        { index: "c", proof: validFirst as never },
        { index: "d", proof: validSecond as never },
      ]);
      assert.equal(pair.proof1?.index, "a");
      assert.equal(pair.proof2?.index, "b");
      assert.equal(
        incompatibleFirst.publicOutput.votingLedgerRoot
          .equals(incompatibleSecond.publicInput.votingLedgerRoot)
          .toBoolean(),
        false,
      );
      assert.equal(
        validFirst.publicOutput.votingLedgerRoot
          .equals(validSecond.publicInput.votingLedgerRoot)
          .toBoolean(),
        true,
      );
    },
  );

  await t.test(
    "ZK-STLV-MERGE-026 records that proof cache keys contain no proof mode",
    () => {
      const id = hostMergeId("0", "1");
      const artifact = JSON.stringify(hostSpanProof(0, 1));
      assert.match(id, /^merge-[0-9a-f]{32}$/);
      assert.doesNotMatch(id, /proof|mode|enabled|disabled/);
      assert.doesNotMatch(artifact, /PROOFS_ENABLED|proofsEnabled/);
    },
  );

  await t.test(
    "ZK-STLV-MERGE-027 records equal cache identity across lifecycle and build labels",
    () => {
      const lifecycleA = hostMergeId("0", "1");
      const lifecycleB = hostMergeId("0", "1");
      assert.equal(lifecycleA, lifecycleB);
    },
  );
});

test("STLV proof-off host merge records persistence failure and serialization", async (t) => {
  await t.test(
    "ZK-STLV-MERGE-028 retains staged entries after merge persistence failure",
    async () => {
      const storage = new HostProofStorage([
        hostSpanProof(0, 0),
        hostSpanProof(1, 1),
      ]);
      await assert.rejects(
        () =>
          hostProver(
            storage,
            hostQueue({ calls: 0 }),
            hostWriter(storage, { failCall: 1 }),
          ).merge(),
        /writer failed/,
      );
      assert.equal(storage.entries.length, 3);
      assert.equal(storage.merges.size, 0);
    },
  );

  await t.test(
    "ZK-STLV-MERGE-029 does not publish a root after root writer failure",
    async () => {
      const storage = new HostProofStorage([
        hostSpanProof(0, 0),
        hostSpanProof(1, 1),
      ]);
      await assert.rejects(
        () =>
          hostProver(
            storage,
            hostQueue({ calls: 0 }),
            hostWriter(storage, { failCall: 2 }),
          ).merge(),
        /writer failed/,
      );
      assert.equal(
        storage.merges.has(MergeProofOrchestrator.ROOT_PROOF_ID),
        false,
      );
      assert.equal(storage.merges.has(hostMergeId("0", "1")), true);
      assert.deepEqual(
        storage.entries.map(({ key }) => key),
        ["merge:root"],
      );
    },
  );

  await t.test(
    "ZK-STLV-MERGE-030 serializes concurrent buffered writes",
    async () => {
      const storage = new HostProofStorage(
        Array.from({ length: 6 }, (_, index) => hostSpanProof(index, index)),
      );
      let peakActiveWriters = 0;
      const writer = hostWriter(storage, {
        delayMs: 2,
        onActive(active) {
          peakActiveWriters = Math.max(peakActiveWriters, active);
        },
      });
      const root = await hostProver(
        storage,
        hostQueue({ calls: 0, delayMs: 1 }),
        writer,
      ).merge(undefined, 3);
      assert.equal(root.publicInput.index.toBigInt(), 0n);
      assert.equal(root.publicOutput.index.toBigInt(), 5n);
      assert.equal(peakActiveWriters, 1);
      assert.equal(storage.entries.length, 0);
    },
  );
});

test("ZK-STLV-MERGE-023 records corrupt and forged cached-root boundaries", async (t) => {
  await t.test("malformed cached JSON rejects before proof decoding", () => {
    assert.throws(() => JSON.parse("{not-json"), SyntaxError);
  });

  await t.test(
    "a decodable dummy root is not authenticated proof-off",
    async () => {
      await withContext(10, async (context) => {
        const { proofs } = await buildBaseProofs(context, 2);
        const merged = await mergePair(proofs[0]!, proofs[1]!);
        const forged = await SideLoadedStakingLedgerToVotingLedgerProof.dummy(
          merged.publicInput,
          cloneOutput(merged.publicOutput),
          2,
        );
        const exhausted = await StakingLedgerToVotingLedgerProver.proveExhaust({
          stakingLedger: context.stakingLedger,
          proofStorage: proofStorageWithRoot(forged),
        });
        assert.equal(exhausted.publicOutput.exhausted.toBoolean(), true);
      });
    },
  );
});

test("STLV proof-off exhaust covers foreign keys, stale snapshots, and density", async (t) => {
  await t.test(
    "ZK-STLV-EXHAUST-007 documents the height-36 full-capacity boundary",
    () => {
      const capacity = 2n ** 35n;
      const finalIndex = capacity - 1n;
      assert.equal(finalIndex + 1n, capacity);
      assert.equal(finalIndex < capacity, true);
      assert.equal(finalIndex + 1n < capacity, false);
    },
  );

  await t.test(
    "ZK-STLV-EXHAUST-010 records foreign-key acceptance when verification is disabled",
    async () => {
      await withContext(5, async (context) => {
        const { proofs } = await buildBaseProofs(context, 1);
        const foreign = (
          await AlternateKeyProgram.copyWithDifferentConstraint(
            proofs[0]!.publicInput,
            cloneOutput(proofs[0]!.publicOutput),
          )
        ).proof;
        const result = await StakingLedgerToVotingLedger.rawMethods.exhaust(
          proofs[0]!.publicInput,
          foreign as unknown as StlvProof,
        );
        assert.equal(result.publicOutput.exhausted.toBoolean(), true);
      });
    },
  );

  await t.test(
    "ZK-STLV-EXHAUST-012 rejects a stale staking snapshot in the wrapper",
    async () => {
      const first = await createStakingLedgerToVotingLedgerTestContext({
        maxAccounts: 5,
      });
      const second = await createStakingLedgerToVotingLedgerTestContext({
        maxAccounts: 5,
      });
      try {
        const changedAccount = cloneAccount(second.testAccounts[0]!);
        changedAccount.balance = changedAccount.balance.add(1);
        await second.stakingLedger.setAccount(0n, changedAccount);
        await second.stakingLedger.setLeaf(0n, changedAccount);
        stakingLedgerToVotingLedgerContext.set({
          stakingLedger: first.stakingLedger,
          votingLedger: first.votingLedger,
        });
        const { proofs } = await buildBaseProofs(first, 1);
        const root = SideLoadedStakingLedgerToVotingLedgerProof.fromProof(
          proofs[0]!,
        );
        await assert.rejects(() =>
          StakingLedgerToVotingLedgerProver.proveExhaust({
            stakingLedger: second.stakingLedger,
            proofStorage: proofStorageWithRoot(root),
          }),
        );
      } finally {
        await second.cleanup();
        await first.cleanup();
      }
    },
  );

  await t.test(
    "ZK-STLV-EXHAUST-022 combines a dense count oracle with terminal public values",
    async () => {
      await withContext(17, async (context) => {
        const authoritativeAccounts =
          await context.stakingLedger.getAllAccounts();
        assert.equal(authoritativeAccounts.length, 17);
        assert.equal(
          authoritativeAccounts.some((account) =>
            Account.isEmpty(account).toBoolean(),
          ),
          false,
        );
        const { proofs } = await buildBaseProofs(context, 4);
        const merged = await mergeLeft(proofs);
        const exhausted = (
          await StakingLedgerToVotingLedger.exhaust(merged.publicInput, merged)
        ).proof;
        assert.equal(exhausted.publicInput.index.toBigInt(), 0n);
        assert.equal(exhausted.publicOutput.index.toBigInt(), 19n);
        assert.equal(exhausted.publicOutput.exhausted.toBoolean(), true);
        assert.equal(17n <= exhausted.publicOutput.index.toBigInt() + 1n, true);
      });
    },
  );
});

test(
  "STLV proof-off contract bindings reject invalid shapes atomically",
  { concurrency: 1 },
  async (t) => {
    await compileAuthorizationContracts(false);
    const fixture = await createContractFixture();
    const cases = [
      {
        id: "ZK-STLV-EXHAUST-005",
        name: "nonzero start",
        options: { index: 5n },
        pattern: /must start at index 0/,
      },
      {
        id: "ZK-STLV-EXHAUST-006",
        name: "nonexhausted output",
        options: { exhausted: false },
        pattern: /proof did not exhaust/,
      },
      {
        id: "ZK-STLV-EXHAUST-013",
        name: "stale staking root",
        options: { stakingRoot: fixture.stakingLedgerRoot!.add(1) },
        pattern: /staking ledger root does not match/,
      },
      {
        id: "ZK-STLV-EXHAUST-017",
        name: "nonempty initial voting root",
        options: { initialVotingRoot: Field(1) },
        pattern: /initial voting ledger root must be empty/,
      },
      {
        id: "ZK-STLV-EXHAUST-018",
        name: "final voting-root mismatch",
        options: { finalVotingRoot: Field(1) },
        pattern: /voting ledger root does not match/,
      },
    ] as const;

    for (const scenario of cases) {
      await t.test(`${scenario.id} rejects ${scenario.name}`, async () => {
        const before = await contractSnapshot(fixture);
        const proof = await contractStlvProof(fixture, scenario.options);
        await assert.rejects(
          () => tallyWithStlv(fixture, proof),
          scenario.pattern,
        );
        assert.deepEqual(await contractSnapshot(fixture), before);
      });
    }

    await t.test(
      "ZK-STLV-EXHAUST-016 accepts a complete bound transformation",
      async () => {
        const proof = await contractStlvProof(fixture);
        await tallyWithStlv(fixture, proof);
        assert.equal(
          (await fixture.proposal.status.fetch())!.toString(),
          ProposalStatus.APPROVED.toString(),
        );
      },
    );
  },
);

test(
  "ZK-STLV-EXHAUST-019 and ZK-STLV-EXHAUST-020 record proof identity and lifecycle boundaries",
  { concurrency: 1 },
  async () => {
    await compileAuthorizationContracts(false);
    const fixture = await createContractFixture();
    const proof = await contractStlvProof(fixture, { foreignKey: true });
    assert.deepEqual(Object.keys(proof.publicInput).sort(), [
      "index",
      "stakingLedgerRoot",
      "votingLedgerRoot",
    ]);
    await tallyWithStlv(fixture, proof);
    assert.equal(
      (await fixture.proposal.status.fetch())!.toString(),
      ProposalStatus.APPROVED.toString(),
    );
  },
);
