// Exercises merge()'s reduction and resume behaviour in isolation, with a
// fake queue that "proves" a merge by joining two spans. The real round trip
// (redis, o1js proofs) stays covered by
// staking-ledger-to-voting-ledger-prover.test.ts; this file is about the
// properties that test cannot isolate: that a resumed merge still terminates
// on a true root, and that entries an earlier interrupted run left in storage
// cannot steer a later one.
import { it } from "node:test";
import assert from "node:assert";
import { MergeProofOrchestrator } from "../../../src/proving/prover/merge-proof-orchestrator.js";
import type { MergeProofStorage } from "../../../src/proving/prover/merge-proof-orchestrator.js";
import type { KeyValueBatchStorage } from "../../../src/storage/batch-key-value-storage.js";
import type { KeyValueEntry } from "../../../src/storage/key-value-storage.js";
import type { Task, TaskQueue } from "../../../src/proving/task-queue.js";

// A proof is just the half-open span of base indices it covers.
interface SpanProof {
  from: number;
  to: number;
}

type AnyTaskQueue = TaskQueue<Record<string, Task<unknown, unknown>>>;

// Mirrors the real keyv-backed storages: writes land in an `entries` buffer
// that only reaches the store when the batch writer drains it, so the test
// also covers merge()'s serialization of that shared buffer.
class FakeProofStorage implements MergeProofStorage<SpanProof> {
  public entries: Array<KeyValueEntry> = [];
  public readonly base = new Map<string, SpanProof>();
  public readonly merges = new Map<string, SpanProof>();
  public readonly merged = new Set<string>();
  // Ordered log of base-proof reads and merge enqueues, so a test can assert
  // that leaves are pulled in as merging consumes them rather than all at once.
  public readonly events: string[] = [];

  constructor(baseProofCount: number) {
    for (let index = 0; index < baseProofCount; index++) {
      this.base.set(index.toString(), { from: index, to: index });
    }
  }

  async getProof(id: string) {
    this.events.push("read");
    return this.base.get(id);
  }
  async setProof(id: string, proof: SpanProof) {
    this.entries.push({ key: `base:${id}`, value: JSON.stringify(proof) });
  }
  async getMergeProof(id: string) {
    return this.merges.get(id);
  }
  async setMergeProof(id: string, proof: SpanProof) {
    this.entries.push({ key: `merge:${id}`, value: JSON.stringify(proof) });
  }
  async markAsMerged(id: string) {
    this.entries.push({ key: `merged:${id}`, value: "true" });
  }
  async isMerged(id: string) {
    return this.merged.has(id);
  }
  async mergeCount() {
    return this.merges.size;
  }
  async count() {
    return this.base.size;
  }
  collectEntries() {
    return this.entries;
  }
  clearEntries() {
    this.entries = [];
  }
  async close() {}

  commit(entries: Array<KeyValueEntry>) {
    for (const { key, value } of entries) {
      const [kind, ...rest] = key.split(":");
      const id = rest.join(":");
      if (kind === "merge") this.merges.set(id, JSON.parse(value) as SpanProof);
      if (kind === "base") this.base.set(id, JSON.parse(value) as SpanProof);
      if (kind === "merged") this.merged.add(id);
    }
  }
}

function fakeBatchWriter(storage: FakeProofStorage): KeyValueBatchStorage {
  return {
    async setMany(entries: Array<KeyValueEntry>) {
      storage.commit(entries);
    },
    async close() {},
  } as unknown as KeyValueBatchStorage;
}

// Joins the two spans it is handed. `failAfter` makes it start throwing part
// way through, standing in for the pod restart that used to leave the merge
// namespace inconsistent.
function fakeTaskQueue(
  state: {
    proved: number;
    failAfter: number;
  },
  events?: string[],
): AnyTaskQueue {
  return {
    async obliterate() {},
    async addTask(
      _taskName: string,
      input: { proofs: { 1: SpanProof; 2: SpanProof } },
      onTaskComplete?: (output: { proof: SpanProof }) => Promise<void>,
    ) {
      if (state.proved >= state.failAfter) {
        throw new Error("worker died");
      }
      events?.push("merge");
      state.proved++;
      await onTaskComplete?.({
        proof: { from: input.proofs[1].from, to: input.proofs[2].to },
      });
    },
  } as unknown as AnyTaskQueue;
}

class SpanOrchestrator extends MergeProofOrchestrator<SpanProof> {
  findMergeableProofs(proofs: { index: string; proof: SpanProof }[]) {
    if (proofs.length < 2) {
      return { proof1: undefined, proof2: undefined };
    }

    proofs.sort(({ proof: a }, { proof: b }) => a.from - b.from);

    for (const proof1 of proofs) {
      const proof2 = proofs.find(
        ({ proof }) => proof.from === proof1.proof.to + 1,
      );
      if (proof2) {
        return { proof1, proof2 };
      }
    }

    return { proof1: undefined, proof2: undefined };
  }
}

function orchestrator(storage: FakeProofStorage, queue: AnyTaskQueue) {
  return new SpanOrchestrator(
    storage,
    fakeBatchWriter(storage),
    queue,
    "merge",
  );
}

it("reduces every base proof to a single root spanning the whole range", async () => {
  const storage = new FakeProofStorage(16);
  const state = { proved: 0, failAfter: Infinity };

  const root = await orchestrator(storage, fakeTaskQueue(state)).merge();

  assert.deepStrictEqual(root, { from: 0, to: 15 });
  assert.strictEqual(state.proved, 15, "16 leaves take exactly 15 merges");
});

it("pulls base proofs in as merging consumes them, not all up front", async () => {
  // Reading every leaf before merging anything is what OOM-killed the 2Gi
  // proving-scheduler: 18,400 deserialized proofs resident at once. With a
  // concurrency of 2 the first merge must be reachable after a couple of
  // reads, and reads must stay interleaved with merges for the whole run.
  const storage = new FakeProofStorage(64);
  const state = { proved: 0, failAfter: Infinity };

  const root = await orchestrator(
    storage,
    fakeTaskQueue(state, storage.events),
  ).merge(undefined, 2);

  assert.deepStrictEqual(root, { from: 0, to: 63 });

  const firstMerge = storage.events.indexOf("merge");
  assert.ok(
    firstMerge >= 0 && firstMerge <= 4,
    `first merge should follow a couple of reads, was event ${firstMerge.toString()} of ${storage.events.length.toString()}`,
  );

  // Peak unconsumed leaves: every merge takes two pending proofs, so this is
  // how far reading is allowed to run ahead of merging. It is the number that
  // decides peak heap, and it must not scale with the leaf count.
  let outstanding = 0;
  let peak = 0;
  for (const event of storage.events) {
    outstanding += event === "read" ? 1 : -2;
    peak = Math.max(peak, outstanding);
  }
  assert.ok(
    peak <= 8,
    `reading should not run ahead of merging, peaked at ${peak.toString()} unconsumed leaves of 64`,
  );
});

it("publishes the root under ROOT_PROOF_ID so exhaust never has to guess", async () => {
  const storage = new FakeProofStorage(8);

  await orchestrator(
    storage,
    fakeTaskQueue({ proved: 0, failAfter: Infinity }),
  ).merge();

  assert.deepStrictEqual(
    storage.merges.get(MergeProofOrchestrator.ROOT_PROOF_ID),
    { from: 0, to: 7 },
  );
});

it("returns a true root after an interrupted run, reusing what that run proved", async () => {
  const storage = new FakeProofStorage(16);

  const interrupted = { proved: 0, failAfter: 6 };
  await assert.rejects(
    orchestrator(storage, fakeTaskQueue(interrupted)).merge(),
    /worker died/,
  );
  assert.strictEqual(interrupted.proved, 6);

  // This is the regression: the counter-keyed implementation wedged here -
  // merge() did nothing and handed back an interior node as the root.
  const resumed = { proved: 0, failAfter: Infinity };
  const root = await orchestrator(storage, fakeTaskQueue(resumed)).merge();

  assert.deepStrictEqual(root, { from: 0, to: 15 });
  assert.ok(
    resumed.proved < 15,
    `resume should reuse the interrupted run's merges, re-proved ${resumed.proved.toString()} of 15`,
  );
});

it("ignores duplicate and overlapping merge entries left by an earlier run", async () => {
  const storage = new FakeProofStorage(8);
  // Exactly the shape found on devnet: interior nodes that overlap each other
  // and cover ranges no current pairing would ask for.
  storage.merges.set("merge-stale-a", { from: 2, to: 6 });
  storage.merges.set("merge-stale-b", { from: 3, to: 7 });
  storage.merges.set("merge-stale-c", { from: 0, to: 5 });
  for (const id of ["0", "1", "2", "3", "4", "5", "6", "7"]) {
    storage.merged.add(id);
  }

  const state = { proved: 0, failAfter: Infinity };
  const root = await orchestrator(storage, fakeTaskQueue(state)).merge();

  assert.deepStrictEqual(root, { from: 0, to: 7 });
  assert.strictEqual(state.proved, 7);
});

it("fails loudly when the base proofs do not form one contiguous chain", async () => {
  const storage = new FakeProofStorage(4);
  storage.base.set("2", { from: 9, to: 9 });

  await assert.rejects(
    orchestrator(
      storage,
      fakeTaskQueue({ proved: 0, failAfter: Infinity }),
    ).merge(),
    /Merge stalled: .* disjoint proofs remain/,
  );
});

it("refuses to merge with no base proofs at all", async () => {
  const storage = new FakeProofStorage(0);

  await assert.rejects(
    orchestrator(
      storage,
      fakeTaskQueue({ proved: 0, failAfter: Infinity }),
    ).merge(),
    /No base proofs found/,
  );
});
