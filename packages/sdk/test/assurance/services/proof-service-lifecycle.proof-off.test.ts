import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Field, UInt32, VerificationKey } from "o1js";

import type { StakingLedger } from "../../../src/ledgers/staking-ledger/staking-ledger.js";
import {
  StakingLedgerToVotingLedgerProver,
  type StakingLedgerToVotingLedgerTaskQueue,
} from "../../../src/proving/prover/staking-ledger-to-voting-ledger-prover.js";
import type { StakingLedgerToVotingLedgerDigestTrace } from "../../../src/proving/tracing/staking-ledger-to-voting-ledger-tracer.js";
import {
  StakingLedgerToVotingLedger,
  SideLoadedStakingLedgerToVotingLedgerProof,
} from "../../../src/provable/staking-ledger-to-voting-ledger.js";
import { TreasuryOwnerSmartContract } from "../../../src/provable/contracts/treasury-owner.js";
import { TreasuryPauseControllerSmartContract } from "../../../src/provable/contracts/treasury-pause-controller/treasury-pause-controller.js";
import { TreasuryProposalSmartContract } from "../../../src/provable/contracts/treasury-proposal/treasury-proposal.js";
import { VoteReducer } from "../../../src/provable/contracts/treasury-proposal/vote-reducer.js";
import { SqliteStakingLedgerToVotingLedgerService } from "../../../src/services/sqlite/sqlite-staking-ledger-to-voting-ledger-service.js";
import { SqliteTreasuryOwnerService } from "../../../src/services/sqlite/sqlite-treasury-owner-service.js";
import { SqliteVoteReducerService } from "../../../src/services/sqlite/sqlite-vote-reducer-service.js";
import type { KeyValueBatchStorage } from "../../../src/storage/batch-key-value-storage.js";
import type { KeyValueEntry } from "../../../src/storage/key-value-storage.js";
import type { StakingLedgerToVotingLedgerDigestTraceStorage } from "../../../src/storage/staking-ledger-to-voting-ledger-digest-trace-storage.js";
import type { StakingLedgerToVotingLedgerProofStorage } from "../../../src/storage/staking-ledger-to-voting-ledger-proof-storage.js";

type FailureClass = "STORAGE_FAILURE";

interface TraceFixture {
  readonly lifecycle: string;
  readonly accountCount: number;
  readonly balancePattern: readonly bigint[];
  readonly changedMetadata?: string;
}

const TRACE_FIXTURES: readonly TraceFixture[] = [
  {
    lifecycle: "lifecycle-empty",
    accountCount: 0,
    balancePattern: [],
  },
  {
    lifecycle: "lifecycle-sparse",
    accountCount: 3,
    balancePattern: [0n, 1n, 9_007_199_254_740_993n],
  },
  {
    lifecycle: "lifecycle-rich",
    accountCount: 5,
    balancePattern: [2n, 17n, 1_000_000_000n, 42n, 3n],
    changedMetadata: "changed-source-ledger-root",
  },
];

class FakeTraceStorage implements StakingLedgerToVotingLedgerDigestTraceStorage {
  public constructor(private readonly traces: readonly TraceFixture[]) {}

  public async getTrace(
    index: number,
  ): Promise<StakingLedgerToVotingLedgerDigestTrace | undefined> {
    return this.traces[index] as unknown as
      | StakingLedgerToVotingLedgerDigestTrace
      | undefined;
  }

  public async setTrace(): Promise<void> {}

  public async getAllTraces(): Promise<
    StakingLedgerToVotingLedgerDigestTrace[]
  > {
    return this.traces as unknown as StakingLedgerToVotingLedgerDigestTrace[];
  }

  public async count(): Promise<number> {
    return this.traces.length;
  }

  public collectEntries(): KeyValueEntry[] {
    return [];
  }

  public clearEntries(): void {}

  public async close(): Promise<void> {}
}

class FakeProofStorage implements StakingLedgerToVotingLedgerProofStorage {
  public readonly durable: Map<
    string,
    SideLoadedStakingLedgerToVotingLedgerProof
  >;
  public readonly pending = new Map<
    string,
    SideLoadedStakingLedgerToVotingLedgerProof
  >();
  private entries: KeyValueEntry[] = [];

  public constructor(
    durable: Map<
      string,
      SideLoadedStakingLedgerToVotingLedgerProof
    > = new Map(),
  ) {
    this.durable = durable;
  }

  public async getProof(
    id: string,
  ): Promise<SideLoadedStakingLedgerToVotingLedgerProof | undefined> {
    return this.durable.get(id);
  }

  public async setProof(
    id: string,
    proof: SideLoadedStakingLedgerToVotingLedgerProof,
  ): Promise<void> {
    this.pending.set(id, proof);
    this.entries.push({ key: `proof:${id}`, value: id });
  }

  public async getMergeProof(): Promise<undefined> {
    return undefined;
  }

  public async setMergeProof(): Promise<void> {}

  public async markAsMerged(): Promise<void> {}

  public async isMerged(): Promise<boolean> {
    return false;
  }

  public async mergeCount(): Promise<number> {
    return 0;
  }

  public async count(): Promise<number> {
    return this.durable.size;
  }

  public collectEntries(): KeyValueEntry[] {
    return [...this.entries];
  }

  public clearEntries(): void {
    this.entries = [];
    this.pending.clear();
  }

  public async close(): Promise<void> {}
}

function fakeQueue(
  enqueued: number[],
  complete = false,
): StakingLedgerToVotingLedgerTaskQueue {
  return {
    async obliterate() {},
    async addTask(_taskName, input, onComplete) {
      enqueued.push(input.traceId);
      if (complete) {
        await onComplete?.({
          traceId: input.traceId,
          proof: {
            toJSON: () => ({ traceId: input.traceId }),
          },
        } as never);
      }
    },
  } as unknown as StakingLedgerToVotingLedgerTaskQueue;
}

function batchWriter(
  storage: FakeProofStorage,
  failure?: Error,
): KeyValueBatchStorage {
  return {
    async setMany(entries) {
      if (failure) throw failure;
      for (const entry of entries) {
        const id = entry.key.slice("proof:".length);
        const proof = storage.pending.get(id);
        assert.ok(proof, `pending proof ${id}`);
        storage.durable.set(id, proof);
      }
    },
    async close() {},
  };
}

function proverHarness(
  traces: readonly TraceFixture[],
  storage: FakeProofStorage,
  queue: StakingLedgerToVotingLedgerTaskQueue,
  writer: KeyValueBatchStorage = batchWriter(storage),
): StakingLedgerToVotingLedgerProver {
  return new StakingLedgerToVotingLedgerProver(
    {} as StakingLedger,
    new FakeTraceStorage(traces),
    storage,
    writer,
    queue,
  );
}

function classifyFailure(error: unknown): FailureClass {
  if (error instanceof Error && error.message.includes("storage")) {
    return "STORAGE_FAILURE";
  }
  throw error;
}

describe("proof-off proof-service lifecycle assurance", () => {
  it("CALL-INTENT-006 derives compile mode from PROOFS_ENABLED at both SQLite service boundaries", async () => {
    assert.equal(process.env.PROOFS_ENABLED, "false");
    const observed: Array<{ service: string; proofsEnabled: boolean }> = [];
    const originalStakingCompile = StakingLedgerToVotingLedger.compile;
    const originalVoteCompile = VoteReducer.compile;

    StakingLedgerToVotingLedger.compile = async (options) => {
      observed.push({
        service: "staking",
        proofsEnabled: options.proofsEnabled,
      });
      return undefined as never;
    };
    VoteReducer.compile = async (options) => {
      observed.push({ service: "vote", proofsEnabled: options.proofsEnabled });
      return undefined as never;
    };

    try {
      for (const service of [
        new SqliteStakingLedgerToVotingLedgerService({
          lifecycleId: "service-mode-staking",
        }),
        new SqliteVoteReducerService({ lifecycleId: "service-mode-vote" }),
      ]) {
        await service.compile();
      }
    } finally {
      StakingLedgerToVotingLedger.compile = originalStakingCompile;
      VoteReducer.compile = originalVoteCompile;
    }

    assert.deepEqual(observed, [
      { service: "staking", proofsEnabled: false },
      { service: "vote", proofsEnabled: false },
    ]);
  });

  it("CALL-INTENT-006 preserves owner compile dependency order and verification-key/root wiring", async () => {
    assert.equal(process.env.PROOFS_ENABLED, "false");
    const order: string[] = [];
    const lifecycleDuration = UInt32.from(37);
    const emptyVotingLedgerRoot = Field(101);
    const emptyNullifierRoot = Field(202);
    const keys = {
      vote: VerificationKey.dummySync(),
      staking: VerificationKey.dummySync(),
      proposal: VerificationKey.dummySync(),
      pause: VerificationKey.dummySync(),
      owner: VerificationKey.dummySync(),
    };
    const original = {
      voteCompile: VoteReducer.compile,
      stakingCompile: StakingLedgerToVotingLedger.compile,
      proposalCompile: TreasuryProposalSmartContract.compile,
      pauseCompile: TreasuryPauseControllerSmartContract.compile,
      ownerCompile: TreasuryOwnerSmartContract.compile,
      voteKey: TreasuryProposalSmartContract.voteReducerVerificationKey,
      stakingKey:
        TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey,
      votingRoot: TreasuryProposalSmartContract.emptyVotingLedgerRoot,
      nullifierRoot: TreasuryProposalSmartContract.emptyNullifierRoot,
      proposalKey: TreasuryOwnerSmartContract.proposalContractVerificationKey,
      lifecycleDuration: TreasuryOwnerSmartContract.lifecyclePeriodDuration,
      participants: TreasuryPauseControllerSmartContract.multisigParticipants,
    };

    VoteReducer.compile = async (options) => {
      assert.equal(options.proofsEnabled, false);
      order.push("vote");
      return { verificationKey: keys.vote } as never;
    };
    StakingLedgerToVotingLedger.compile = async (options) => {
      assert.equal(options.proofsEnabled, false);
      order.push("staking");
      return { verificationKey: keys.staking } as never;
    };
    TreasuryProposalSmartContract.compile = async () => {
      assert.strictEqual(
        TreasuryProposalSmartContract.voteReducerVerificationKey,
        keys.vote,
      );
      assert.strictEqual(
        TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey,
        keys.staking,
      );
      assert.equal(
        TreasuryProposalSmartContract.emptyVotingLedgerRoot.toString(),
        emptyVotingLedgerRoot.toString(),
      );
      assert.equal(
        TreasuryProposalSmartContract.emptyNullifierRoot.toString(),
        emptyNullifierRoot.toString(),
      );
      order.push("proposal");
      return { verificationKey: keys.proposal } as never;
    };
    TreasuryPauseControllerSmartContract.compile = async () => {
      assert.strictEqual(
        TreasuryOwnerSmartContract.proposalContractVerificationKey,
        keys.proposal,
      );
      assert.equal(
        TreasuryOwnerSmartContract.lifecyclePeriodDuration.toString(),
        lifecycleDuration.toString(),
      );
      order.push("pause");
      return { verificationKey: keys.pause } as never;
    };
    TreasuryOwnerSmartContract.compile = async () => {
      order.push("owner");
      return { verificationKey: keys.owner } as never;
    };

    const service = new SqliteTreasuryOwnerService();
    const rootHarness = service as unknown as {
      createEmptyLedgerRoots(): Promise<{
        emptyVotingLedgerRoot: Field;
        emptyNullifierRoot: Field;
      }>;
    };
    rootHarness.createEmptyLedgerRoots = async () => ({
      emptyVotingLedgerRoot,
      emptyNullifierRoot,
    });

    try {
      const result = await service.compile({
        lifecyclePeriodDuration: lifecycleDuration,
        cachePath: "/tmp/proof-service-lifecycle-cache-not-used",
      });

      assert.deepEqual(order, [
        "vote",
        "staking",
        "proposal",
        "pause",
        "owner",
      ]);
      assert.strictEqual(result.voteReducerVerificationKey, keys.vote);
      assert.strictEqual(
        result.stakingLedgerToVotingLedgerVerificationKey,
        keys.staking,
      );
      assert.strictEqual(result.treasuryProposalVerificationKey, keys.proposal);
      assert.strictEqual(
        result.treasuryPauseControllerVerificationKey,
        keys.pause,
      );
      assert.strictEqual(result.treasuryOwnerVerificationKey, keys.owner);
    } finally {
      VoteReducer.compile = original.voteCompile;
      StakingLedgerToVotingLedger.compile = original.stakingCompile;
      TreasuryProposalSmartContract.compile = original.proposalCompile;
      TreasuryPauseControllerSmartContract.compile = original.pauseCompile;
      TreasuryOwnerSmartContract.compile = original.ownerCompile;
      TreasuryProposalSmartContract.voteReducerVerificationKey =
        original.voteKey;
      TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey =
        original.stakingKey;
      TreasuryProposalSmartContract.emptyVotingLedgerRoot = original.votingRoot;
      TreasuryProposalSmartContract.emptyNullifierRoot = original.nullifierRoot;
      TreasuryOwnerSmartContract.proposalContractVerificationKey =
        original.proposalKey;
      TreasuryOwnerSmartContract.lifecyclePeriodDuration =
        original.lifecycleDuration;
      TreasuryPauseControllerSmartContract.multisigParticipants =
        original.participants;
    }
  });

  it("service lifecycle rejects proving before start without creating queue state", async () => {
    const cases = [
      {
        service: new SqliteStakingLedgerToVotingLedgerService({
          lifecycleId: "prestart-staking",
        }),
        prove: async (service: SqliteStakingLedgerToVotingLedgerService) =>
          service.proveDigest(),
      },
      {
        service: new SqliteVoteReducerService({
          lifecycleId: "prestart-vote",
        }),
        prove: async (service: SqliteVoteReducerService) =>
          service.proveRunBatch(),
      },
    ] as const;

    for (const testCase of cases) {
      await assert.rejects(
        testCase.prove(testCase.service as never),
        /start\(\) must be called before proving/,
      );
      assert.equal(
        (testCase.service as unknown as { prover?: unknown }).prover,
        undefined,
      );
      assert.equal(
        (testCase.service as unknown as { taskQueue?: unknown }).taskQueue,
        undefined,
      );
    }
  });

  it("OPS-QUEUE-008 and OPS-RESTART-019 keep deterministic trace job IDs across resume", async () => {
    const durable = new Map<string, SideLoadedStakingLedgerToVotingLedgerProof>(
      [["1", {} as SideLoadedStakingLedgerToVotingLedgerProof]],
    );

    for (const expected of [
      [0, 2],
      [0, 2],
    ]) {
      const enqueued: number[] = [];
      const storage = new FakeProofStorage(durable);
      await proverHarness(TRACE_FIXTURES, storage, fakeQueue(enqueued)).digest(
        0,
        Infinity,
        undefined,
        2,
      );
      assert.deepEqual(enqueued, expected);
      assert.deepEqual([...durable.keys()], ["1"]);
    }
  });

  it("ART-PROOF-011 and ART-PROOF-016 characterize changed trace/proof metadata under a stable proof ID", async () => {
    const mutations = [
      {
        trace: { ...TRACE_FIXTURES[0], changedMetadata: "ledger-root-a" },
        storedProofMetadata: "program-a:key-a:build-a",
      },
      {
        trace: { ...TRACE_FIXTURES[0], changedMetadata: "ledger-root-b" },
        storedProofMetadata: "program-b:key-b:build-b",
      },
    ];

    for (const mutation of mutations) {
      const storedProof = {
        metadata: mutation.storedProofMetadata,
      } as unknown as SideLoadedStakingLedgerToVotingLedgerProof;
      const durable = new Map<
        string,
        SideLoadedStakingLedgerToVotingLedgerProof
      >([["0", storedProof]]);
      const enqueued: number[] = [];
      const storage = new FakeProofStorage(durable);
      await proverHarness(
        [mutation.trace],
        storage,
        fakeQueue(enqueued),
      ).digest();
      assert.deepEqual(enqueued, []);
      assert.strictEqual(storage.durable.get("0"), storedProof);
    }
  });

  it("OPS-RESTART-009 keeps durable state unchanged after proof persistence failure", async () => {
    const storage = new FakeProofStorage();
    const enqueued: number[] = [];
    const failure = new Error("injected storage persistence failure");
    const originalFromJson =
      SideLoadedStakingLedgerToVotingLedgerProof.fromJSON;
    SideLoadedStakingLedgerToVotingLedgerProof.fromJSON = async () =>
      ({ kind: "decoded-proof" }) as never;

    try {
      await assert.rejects(
        proverHarness(
          [TRACE_FIXTURES[1]],
          storage,
          fakeQueue(enqueued, true),
          batchWriter(storage, failure),
        ).digest(),
        (error) => classifyFailure(error) === "STORAGE_FAILURE",
      );
    } finally {
      SideLoadedStakingLedgerToVotingLedgerProof.fromJSON = originalFromJson;
    }

    assert.deepEqual(enqueued, [0]);
    assert.equal(storage.durable.size, 0);
    assert.deepEqual(storage.collectEntries(), [
      { key: "proof:0", value: "0" },
    ]);
    assert.equal(storage.pending.size, 1);
  });

  it("OPS-RESTART-019 recreates a proof service over persisted state and skips completed trace IDs", async () => {
    const durable = new Map<
      string,
      SideLoadedStakingLedgerToVotingLedgerProof
    >();
    const firstStorage = new FakeProofStorage(durable);
    const firstEnqueued: number[] = [];
    const originalFromJson =
      SideLoadedStakingLedgerToVotingLedgerProof.fromJSON;
    SideLoadedStakingLedgerToVotingLedgerProof.fromJSON = async (json) =>
      ({ json }) as never;

    function serviceWithAdapters(
      lifecycleId: string,
      storage: FakeProofStorage,
      queue: StakingLedgerToVotingLedgerTaskQueue,
    ): SqliteStakingLedgerToVotingLedgerService {
      const service = new SqliteStakingLedgerToVotingLedgerService({
        lifecycleId,
        redisConnection: { host: "127.0.0.1", port: 1 },
      });
      Object.assign(service, {
        stakingLedger: {} as StakingLedger,
        traceStorage: new FakeTraceStorage(TRACE_FIXTURES),
        proofStorage: storage,
        proofBatchWriter: batchWriter(storage),
        taskQueue: queue,
      });
      return service;
    }

    try {
      const firstService = serviceWithAdapters(
        "proof-service-restart",
        firstStorage,
        fakeQueue(firstEnqueued, true),
      );
      await firstService.proveDigest();

      const reopenedStorage = new FakeProofStorage(durable);
      const reopenedEnqueued: number[] = [];
      const reopenedService = serviceWithAdapters(
        "proof-service-restart",
        reopenedStorage,
        fakeQueue(reopenedEnqueued, true),
      );
      await reopenedService.proveDigest();

      assert.deepEqual(firstEnqueued, [0, 1, 2]);
      assert.deepEqual(reopenedEnqueued, []);
      assert.deepEqual([...durable.keys()], ["0", "1", "2"]);
      assert.equal(reopenedStorage.collectEntries().length, 0);
      assert.notStrictEqual(
        (firstService as unknown as { prover: unknown }).prover,
        (reopenedService as unknown as { prover: unknown }).prover,
      );
    } finally {
      SideLoadedStakingLedgerToVotingLedgerProof.fromJSON = originalFromJson;
    }
  });
});
