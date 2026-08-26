// Exercises digest()'s enqueue decisions in isolation - which indices get
// pushed at the (fake) task queue and which get skipped - without touching
// redis or o1js proving. The full round trip (real queue, real proofs) is
// still covered by staking-ledger-to-voting-ledger-prover.test.ts; this file
// is specifically about the resume-by-skip behaviour that test can't easily
// isolate.
import { it } from "node:test";
import assert from "node:assert";
import { StakingLedgerToVotingLedgerProver } from "../../../src/proving/prover/staking-ledger-to-voting-ledger-prover.js";
import type { StakingLedgerToVotingLedgerTaskQueue } from "../../../src/proving/prover/staking-ledger-to-voting-ledger-prover.js";
import type { StakingLedgerToVotingLedgerDigestTraceStorage } from "../../../src/storage/staking-ledger-to-voting-ledger-digest-trace-storage.js";
import type { StakingLedgerToVotingLedgerProofStorage } from "../../../src/storage/staking-ledger-to-voting-ledger-proof-storage.js";
import type { KeyValueBatchStorage } from "../../../src/storage/batch-key-value-storage.js";
import type { StakingLedgerToVotingLedgerDigestTrace } from "../../../src/proving/tracing/staking-ledger-to-voting-ledger-tracer.js";
import type { StakingLedger } from "../../../src/ledgers/staking-ledger/staking-ledger.js";
import type { SideLoadedStakingLedgerToVotingLedgerProof } from "../../../src/provable/staking-ledger-to-voting-ledger.js";

function fakeTraceStorage(
  traceCount: number,
): StakingLedgerToVotingLedgerDigestTraceStorage {
  return {
    async getTrace(index) {
      if (index >= traceCount) return undefined;
      return {} as StakingLedgerToVotingLedgerDigestTrace;
    },
    async setTrace() {},
    async getAllTraces() {
      return [];
    },
    async count() {
      return traceCount;
    },
    async close() {},
    collectEntries() {
      return [];
    },
    clearEntries() {},
  };
}

function fakeProofStorage(
  alreadyProven: Set<string>,
): StakingLedgerToVotingLedgerProofStorage {
  return {
    async getProof(id) {
      return alreadyProven.has(id)
        ? ({} as SideLoadedStakingLedgerToVotingLedgerProof)
        : undefined;
    },
    async setProof() {},
    async getMergeProof() {
      return undefined;
    },
    async setMergeProof() {},
    async markAsMerged() {},
    async isMerged() {
      return false;
    },
    async mergeCount() {
      return 0;
    },
    async count() {
      return 0;
    },
    collectEntries() {
      return [];
    },
    clearEntries() {},
    async close() {},
  };
}

function fakeBatchWriter(): KeyValueBatchStorage {
  return {
    async setMany() {},
    async close() {},
  };
}

// Records which traceIds get enqueued and, deliberately, never resolves the
// completion callback - digest()'s post-completion callback chain touches
// real o1js proof (de)serialization, which is out of scope for a test about
// enqueue decisions.
function fakeTaskQueue(enqueued: number[]): StakingLedgerToVotingLedgerTaskQueue {
  return {
    async obliterate() {},
    async addTask(_taskName: string, input: { traceId: number }) {
      enqueued.push(input.traceId);
    },
  } as unknown as StakingLedgerToVotingLedgerTaskQueue;
}

it("enqueues every index that has no existing proof", async () => {
  const enqueued: number[] = [];
  const prover = new StakingLedgerToVotingLedgerProver(
    {} as StakingLedger,
    fakeTraceStorage(5),
    fakeProofStorage(new Set()),
    fakeBatchWriter(),
    fakeTaskQueue(enqueued),
  );

  await prover.digest(0, Infinity, undefined, 10);

  assert.deepStrictEqual(enqueued.slice().sort((a, b) => a - b), [
    0, 1, 2, 3, 4,
  ]);
});

it("skips indices that already have a persisted proof", async () => {
  const enqueued: number[] = [];
  const prover = new StakingLedgerToVotingLedgerProver(
    {} as StakingLedger,
    fakeTraceStorage(5),
    fakeProofStorage(new Set(["1", "3"])),
    fakeBatchWriter(),
    fakeTaskQueue(enqueued),
  );

  await prover.digest(0, Infinity, undefined, 10);

  assert.deepStrictEqual(enqueued.slice().sort((a, b) => a - b), [0, 2, 4]);
});

it("skips every index when a full prior attempt already proved them all - the restart-from-startIndex case", async () => {
  const enqueued: number[] = [];
  const prover = new StakingLedgerToVotingLedgerProver(
    {} as StakingLedger,
    fakeTraceStorage(5),
    fakeProofStorage(new Set(["0", "1", "2", "3", "4"])),
    fakeBatchWriter(),
    fakeTaskQueue(enqueued),
  );

  await prover.digest(0, Infinity, undefined, 10);

  assert.deepStrictEqual(enqueued, []);
});
