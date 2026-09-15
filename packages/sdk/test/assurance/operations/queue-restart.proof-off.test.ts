import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { Field, UInt64 } from "o1js";

import {
  MergeProofOrchestrator,
  type MergeProofStorage,
} from "../../../src/proving/prover/merge-proof-orchestrator.js";
import { TaskQueue, type Task } from "../../../src/proving/task-queue.js";
import { Worker as ProofWorker } from "../../../src/proving/worker.js";
import { VotingAccount } from "../../../src/provable/voting-account.js";
import type { KeyValueBatchStorage } from "../../../src/storage/batch-key-value-storage.js";
import { InMemoryMerkleTreeStorage } from "../../../src/storage/in-memory/in-memory-merkle-tree-storage.js";
import { InMemoryVotingAccountStorage } from "../../../src/storage/in-memory/in-memory-voting-account-storage.js";
import type { KeyValueEntry } from "../../../src/storage/key-value-storage.js";
import type { MerkleTreeStorage } from "../../../src/storage/merkle-tree-storage.js";
import type { VotingAccountStorage } from "../../../src/storage/voting-account-storage.js";
import { SqliteStakingLedgerToVotingLedgerService } from "../../../src/services/sqlite/sqlite-staking-ledger-to-voting-ledger-service.js";

type FailureClass = "DEPENDENCY_FAILURE" | "STORAGE_FAILURE" | "TIMEOUT";

interface TestInput {
  readonly value: string;
}

interface TestOutput {
  readonly value: string;
}

interface SpanProof {
  readonly from: number;
  readonly to: number;
}

type TestTasks = { test: Task<TestInput, TestOutput> };
type AnyTaskQueue = TaskQueue<Record<string, Task<unknown, unknown>>>;

const TEST_TASK: Task<TestInput, TestOutput> = {
  async prepare() {},
  async run(input) {
    return input;
  },
  serializers: {
    async input(input) {
      return JSON.stringify(input);
    },
    async output(output) {
      return JSON.stringify(output);
    },
  },
  deserializers: {
    async input(input) {
      return JSON.parse(input) as TestInput;
    },
    async output(output) {
      return JSON.parse(output) as TestOutput;
    },
  },
};
const REPOSITORY_ROOT = fileURLToPath(
  new URL("../../../../../", import.meta.url),
);

function classifyFailure(error: unknown): FailureClass {
  if (
    error instanceof Error &&
    error.message.includes("exceeded MAX_TASK_DURATION")
  ) {
    return "TIMEOUT";
  }
  if (
    error instanceof Error &&
    (error.message.includes("failed for task") ||
      error.message === "queue dependency failed")
  ) {
    return "DEPENDENCY_FAILURE";
  }
  if (error instanceof Error && error.message.includes("storage")) {
    return "STORAGE_FAILURE";
  }
  throw error;
}

class FakeSubprocess extends EventEmitter {
  public connected = true;
  public readonly sent: unknown[] = [];
  public readonly killedWith: Array<NodeJS.Signals | number | undefined> = [];

  public constructor(private readonly result?: string) {
    super();
  }

  public send(message: unknown): boolean {
    this.sent.push(message);
    if (this.result !== undefined) {
      queueMicrotask(() => {
        this.emit("message", { type: "success", result: this.result });
      });
    }
    return true;
  }

  public kill(signal?: NodeJS.Signals | number): boolean {
    this.killedWith.push(signal);
    this.connected = false;
    return true;
  }
}

function attachSubprocess(worker: ProofWorker, subprocess: FakeSubprocess) {
  Object.assign(worker, {
    subprocess,
    subprocessReadyPromise: Promise.resolve(),
  });
}

async function withTemporarySqliteDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(
    join(tmpdir(), "treasury-proof-off-restart-"),
  );
  const previousDirectory = process.env.SQLITE_DATA_DIRECTORY;
  process.env.SQLITE_DATA_DIRECTORY = directory;
  try {
    await run(directory);
  } finally {
    if (previousDirectory === undefined) {
      delete process.env.SQLITE_DATA_DIRECTORY;
    } else {
      process.env.SQLITE_DATA_DIRECTORY = previousDirectory;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

function queueHarness(
  options: {
    readonly add?: (
      taskName: string,
      serialized: string,
    ) => Promise<{ id: string }>;
    readonly obliterate?: (options: { force: boolean }) => Promise<void>;
  } = {},
): {
  readonly queue: TaskQueue<TestTasks>;
  readonly events: EventEmitter;
} {
  const events = new EventEmitter();
  const queue = Object.create(TaskQueue.prototype) as TaskQueue<TestTasks>;
  Object.assign(queue, {
    tasks: { test: TEST_TASK },
    events,
    queue: {
      add:
        options.add ??
        (async () => {
          throw new Error("queue dependency failed");
        }),
      obliterate: options.obliterate ?? (async () => {}),
    },
  });
  return { queue, events };
}

class ParentVotingStorage implements VotingAccountStorage {
  public readonly namespace = "ops-voting";
  public readonly accounts = new Map<string, VotingAccount>();

  public async getVotingAccount(publicKey: string) {
    return this.accounts.get(publicKey);
  }

  public async setVotingAccount(
    publicKey: string,
    account: VotingAccount,
  ): Promise<void> {
    this.accounts.set(publicKey, account);
  }

  public async clear(): Promise<void> {
    this.accounts.clear();
  }

  public async close(): Promise<void> {}
}

class ParentMerkleStorage implements MerkleTreeStorage {
  public readonly namespace = "ops-merkle";
  public readonly nodes = new Map<string, Field>();

  public async getNode(level: number, index: bigint) {
    return this.nodes.get(`${level}-${index.toString()}`);
  }

  public async setNode(
    level: number,
    index: bigint,
    value: Field,
  ): Promise<void> {
    this.nodes.set(`${level}-${index.toString()}`, value);
  }

  public async clear(): Promise<void> {
    this.nodes.clear();
  }

  public async close(): Promise<void> {}
}

class BufferedProofStorage implements MergeProofStorage<SpanProof> {
  public entries: KeyValueEntry[] = [];
  public readonly base = new Map<string, SpanProof>();
  public readonly roots = new Map<string, SpanProof>();
  public readonly merged = new Set<string>();

  public constructor(baseCount: number) {
    for (let index = 0; index < baseCount; index += 1) {
      this.base.set(index.toString(), { from: index, to: index });
    }
  }

  public async getProof(id: string) {
    return this.base.get(id);
  }

  public async setProof(id: string, proof: SpanProof) {
    this.entries.push({ key: `proof:${id}`, value: JSON.stringify(proof) });
  }

  public async getMergeProof(id: string) {
    return this.roots.get(id);
  }

  public async setMergeProof(id: string, proof: SpanProof) {
    this.entries.push({ key: `root:${id}`, value: JSON.stringify(proof) });
  }

  public async markAsMerged(id: string) {
    this.entries.push({ key: `merged:${id}`, value: "true" });
  }

  public async isMerged(id: string) {
    return this.merged.has(id);
  }

  public async mergeCount() {
    return this.roots.size;
  }

  public async count() {
    return this.base.size;
  }

  public collectEntries() {
    return this.entries;
  }

  public clearEntries() {
    this.entries = [];
  }

  public commit(entries: readonly KeyValueEntry[]) {
    for (const entry of entries) {
      const [kind, id] = entry.key.split(":");
      if (kind === "root" && id) {
        this.roots.set(id, JSON.parse(entry.value) as SpanProof);
      }
      if (kind === "merged" && id) {
        this.merged.add(id);
      }
    }
  }
}

class SpanOrchestrator extends MergeProofOrchestrator<SpanProof> {
  public findMergeableProofs(
    proofs: Array<{ index: string; proof: SpanProof }>,
  ) {
    if (proofs.length < 2) {
      return { proof1: undefined, proof2: undefined };
    }
    return { proof1: proofs[0]!, proof2: proofs[1]! };
  }
}

function mergeQueue(): AnyTaskQueue {
  return {
    async obliterate() {},
    async addTask(
      _taskName: string,
      input: { proofs: { 1: SpanProof; 2: SpanProof } },
      complete?: (result: { proof: SpanProof }) => Promise<void>,
    ) {
      await complete?.({
        proof: {
          from: input.proofs[1].from,
          to: input.proofs[2].to,
        },
      });
    },
  } as unknown as AnyTaskQueue;
}

function orchestrator(
  storage: BufferedProofStorage,
  writer: KeyValueBatchStorage,
): SpanOrchestrator {
  return new SpanOrchestrator(storage, writer, mergeQueue(), "merge");
}

describe("proof-off queue and restart operations", () => {
  it("requires the proof-off process contract", () => {
    assert.equal(process.env.PROOFS_ENABLED, "false");
  });

  it("OPS-QUEUE-001/OPS-RESTART-007 characterizes completion before listener setup as a missed event", async () => {
    let events!: EventEmitter;
    const harness = queueHarness({
      async add() {
        events.emit("completed", {
          jobId: "ops-queue-001-job",
          returnvalue: JSON.stringify({ value: "completed" }),
        });
        return { id: "ops-queue-001-job" };
      },
    });
    events = harness.events;

    let callbackCount = 0;
    void harness.queue.addTask("test", { value: "input" }, async () => {
      callbackCount += 1;
    });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(callbackCount, 0);
    assert.equal(events.listenerCount("completed"), 1);
    events.removeAllListeners();
  });

  it("OPS-QUEUE-003 isolates delayed unrelated jobs", async () => {
    const { queue, events } = queueHarness();
    let matchingSettled = false;
    const matching = queue
      .onTaskComplete("test", "matching-job")
      .finally(() => {
        matchingSettled = true;
      });

    events.emit("completed", {
      jobId: "unrelated-job",
      returnvalue: JSON.stringify({ value: "wrong" }),
    });
    await Promise.resolve();
    assert.equal(matchingSettled, false);

    events.emit("completed", {
      jobId: "matching-job",
      returnvalue: JSON.stringify({ value: "right" }),
    });
    assert.deepEqual(await matching, { value: "right" });
    assert.equal(events.listenerCount("completed"), 0);
    assert.equal(events.listenerCount("failed"), 0);
  });

  it("OPS-QUEUE-004 removes both listeners after success, failure, and decode error", async () => {
    const outcomes = ["success", "failure", "decode-error"] as const;

    for (const outcome of outcomes) {
      const { queue, events } = queueHarness();
      const originalDeserializer = queue.tasks.test.deserializers.output;
      if (outcome === "decode-error") {
        queue.tasks.test.deserializers.output = async () => {
          throw new Error("decode error");
        };
      }
      const pending = queue.onTaskComplete("test", `job-${outcome}`);

      if (outcome === "failure") {
        events.emit("failed", {
          jobId: `job-${outcome}`,
          failedReason: "dependency unavailable",
        });
        await assert.rejects(pending, /dependency unavailable/u);
      } else {
        events.emit("completed", {
          jobId: `job-${outcome}`,
          returnvalue: JSON.stringify({ value: outcome }),
        });
        if (outcome === "decode-error") {
          await assert.rejects(pending, /decode error/u);
        } else {
          assert.deepEqual(await pending, { value: outcome });
        }
      }

      assert.equal(events.listenerCount("completed"), 0, outcome);
      assert.equal(events.listenerCount("failed"), 0, outcome);
      queue.tasks.test.deserializers.output = originalDeserializer;
    }
  });

  it("OPS-QUEUE-002 characterizes duplicate completion before asynchronous cleanup", async () => {
    const { queue, events } = queueHarness();
    let decodeCount = 0;
    queue.tasks.test.deserializers.output = async (serialized) => {
      decodeCount += 1;
      return JSON.parse(serialized) as TestOutput;
    };
    const result = queue.onTaskComplete("test", "ops-queue-002-job");
    const event = {
      jobId: "ops-queue-002-job",
      returnvalue: JSON.stringify({ value: "done" }),
    };

    events.emit("completed", event);
    events.emit("completed", event);

    assert.deepEqual(await result, { value: "done" });
    assert.equal(
      decodeCount,
      2,
      "both synchronous events enter the async decoder before cleanup",
    );
    assert.equal(events.listenerCount("completed"), 0);
    assert.equal(events.listenerCount("failed"), 0);
  });

  it("OPS-QUEUE-005 propagates matching failures and ignores unrelated stable job IDs", async () => {
    const { queue, events } = queueHarness();
    const pending = queue.onTaskComplete("test", "ops-queue-005-job");
    events.emit("failed", {
      jobId: "other-job",
      failedReason: "unrelated",
    });
    assert.equal(events.listenerCount("failed"), 1);
    events.emit("failed", {
      jobId: "ops-queue-005-job",
      failedReason: "worker unavailable",
    });

    await assert.rejects(pending, (error) => {
      assert.equal(classifyFailure(error), "DEPENDENCY_FAILURE");
      assert.match(String(error), /worker unavailable/u);
      return true;
    });
    assert.equal(events.listenerCount("completed"), 0);
    assert.equal(events.listenerCount("failed"), 0);
  });

  it("OPS-QUEUE-006 lets later independent work finish after an older failure", async () => {
    const { queue, events } = queueHarness();
    const oldest = queue.onTaskComplete("test", "oldest-lifecycle");
    const later = queue.onTaskComplete("test", "later-lifecycle");

    events.emit("failed", {
      jobId: "oldest-lifecycle",
      failedReason: "permanent failure",
    });
    events.emit("completed", {
      jobId: "later-lifecycle",
      returnvalue: JSON.stringify({ value: "later-complete" }),
    });

    const [oldestResult, laterResult] = await Promise.allSettled([
      oldest,
      later,
    ]);
    assert.equal(oldestResult.status, "rejected");
    assert.deepEqual(laterResult, {
      status: "fulfilled",
      value: { value: "later-complete" },
    });
    assert.equal(events.listenerCount("completed"), 0);
    assert.equal(events.listenerCount("failed"), 0);
  });

  it("OPS-QUEUE-007 characterizes obliterate as forceful and without an owner key", async () => {
    const calls: Array<{ force: boolean }> = [];
    const { queue } = queueHarness({
      async obliterate(options) {
        calls.push(options);
      },
    });

    await queue.obliterate();

    assert.deepEqual(calls, [{ force: true }]);
  });

  it("OPS-QUEUE-009/OPS-RESTART-008 terminates a timed-out subprocess and accepts work from a fresh one", async () => {
    const worker = new ProofWorker("proof-off-worker", {}, "unused", 5);
    const timedOutSubprocess = new FakeSubprocess();
    attachSubprocess(worker, timedOutSubprocess);

    await assert.rejects(
      worker.workJob({
        id: "timed-out-job",
        name: "test",
        data: "input-a",
      } as Parameters<ProofWorker["workJob"]>[0]),
      (error) => {
        assert.equal(classifyFailure(error), "TIMEOUT");
        return true;
      },
    );
    assert.deepEqual(timedOutSubprocess.killedWith, ["SIGKILL"]);

    const freshSubprocess = new FakeSubprocess("fresh-result");
    attachSubprocess(worker, freshSubprocess);
    assert.equal(
      await worker.workJob({
        id: "fresh-job",
        name: "test",
        data: "input-b",
      } as Parameters<ProofWorker["workJob"]>[0]),
      "fresh-result",
    );
    assert.equal(freshSubprocess.killedWith.length, 0);
    assert.equal(freshSubprocess.sent.length, 1);
  });

  it("OPS-QUEUE-010 records the in-memory Redis evidence boundary", async () => {
    const queueTestSource = await readFile(
      `${REPOSITORY_ROOT}/packages/sdk/test/proving/task-queue.test.ts`,
      "utf8",
    );

    assert.match(queueTestSource, /RedisMemoryServer/u);
    assert.doesNotMatch(queueTestSource, /TEST_REDIS_URL|REDIS_URL/u);
  });

  it("OPS-RESTART-001 keeps trace writes buffered before the batch commit", async () => {
    const parentAccounts = new ParentVotingStorage();
    const parentTree = new ParentMerkleStorage();
    const accounts = new InMemoryVotingAccountStorage(parentAccounts);
    const tree = new InMemoryMerkleTreeStorage(parentTree);
    const account = VotingAccount.empty();
    account.balance = UInt64.from(1n);

    await accounts.setVotingAccount("buffered-account", account);
    await tree.setNode(0, 0n, Field(1));

    assert.equal(
      await parentAccounts.getVotingAccount("buffered-account"),
      undefined,
    );
    assert.equal(await parentTree.getNode(0, 0n), undefined);
    assert.equal(accounts.collectEntries().length, 1);
    assert.equal(tree.collectEntries().length, 1);
  });

  it("OPS-RESTART-002 records the exact account-versus-leaf partial write", async () => {
    const parentAccounts = new ParentVotingStorage();
    const parentTree = new ParentMerkleStorage();
    const accounts = new InMemoryVotingAccountStorage(parentAccounts);
    const tree = new InMemoryMerkleTreeStorage(parentTree);
    const account = VotingAccount.empty();
    account.balance = UInt64.from(9_000_000_007n);
    await accounts.setVotingAccount("ops-restart-002-account", account);
    await tree.setNode(7, 11n, Field(42));
    const entries = [...accounts.collectEntries(), ...tree.collectEntries()];

    const commitWithFault = async () => {
      const accountEntry = entries[0]!;
      await parentAccounts.setVotingAccount(
        "ops-restart-002-account",
        VotingAccount.fromJSON(JSON.parse(accountEntry.value)),
      );
      throw new Error("storage leaf write failed");
    };

    await assert.rejects(commitWithFault(), (error) => {
      assert.equal(classifyFailure(error), "STORAGE_FAILURE");
      return true;
    });
    assert.equal(
      (
        await parentAccounts.getVotingAccount("ops-restart-002-account")
      )?.balance.toBigInt(),
      9_000_000_007n,
    );
    assert.equal(await parentTree.getNode(7, 11n), undefined);
    assert.equal(accounts.collectEntries().length, 1);
    assert.equal(tree.collectEntries().length, 1);
  });

  it("OPS-RESTART-003 retries idempotently after setMany commits but buffer clear does not run", async () => {
    const storage = new BufferedProofStorage(1);
    let firstWrite = true;
    const interruptedWriter = {
      async setMany(entries: KeyValueEntry[]) {
        storage.commit(entries);
        if (firstWrite) {
          firstWrite = false;
          throw new Error("storage interrupted after setMany");
        }
      },
      async close() {},
    } satisfies KeyValueBatchStorage;

    await assert.rejects(
      orchestrator(storage, interruptedWriter).merge(),
      (error) => {
        assert.equal(classifyFailure(error), "STORAGE_FAILURE");
        return true;
      },
    );
    assert.deepEqual(storage.roots.get("root"), { from: 0, to: 0 });
    assert.equal(storage.entries.length, 1);

    const root = await orchestrator(storage, interruptedWriter).merge();
    assert.deepEqual(root, { from: 0, to: 0 });
    assert.equal(storage.roots.size, 1);
    assert.equal(storage.entries.length, 0);
  });

  it("OPS-RESTART-004 reopens a transactionally valid SQLite state after WAL checkpoints", async () => {
    await withTemporarySqliteDirectory(async () => {
      const lifecycleId = "restart-wal-valid-state";
      const first = new SqliteStakingLedgerToVotingLedgerService({
        lifecycleId,
      });
      await first.start();
      await first.writeCheckpointLedgerHash("ledger-before-checkpoint");
      await first.checkpointWal();
      await first.writeCheckpointLedgerHash("ledger-after-checkpoint");
      await first.checkpointWal();
      await first.close();

      const reopened = new SqliteStakingLedgerToVotingLedgerService({
        lifecycleId,
      });
      await reopened.start();
      try {
        assert.equal(
          await reopened.readCheckpointLedgerHash(),
          "ledger-after-checkpoint",
        );
        assert.equal(await reopened.getTracedIndexCount(), 0);
      } finally {
        await reopened.close();
      }
    });
  });

  it("OPS-RESTART-005/016 rejects a partial SQLite checkpoint and separates stale ledger hashes", async () => {
    await withTemporarySqliteDirectory(async (directory) => {
      const corruptLifecycle = "restart-partial-checkpoint";
      await writeFile(
        join(directory, `${corruptLifecycle}.sqlite`),
        Buffer.from("partial-sqlite-checkpoint"),
      );
      const corrupt = new SqliteStakingLedgerToVotingLedgerService({
        lifecycleId: corruptLifecycle,
      });
      await assert.rejects(corrupt.start());
      await corrupt.close().catch(() => undefined);

      const staleLifecycle = "restart-stale-checkpoint";
      const stale = new SqliteStakingLedgerToVotingLedgerService({
        lifecycleId: staleLifecycle,
      });
      await stale.start();
      await stale.writeCheckpointLedgerHash("ledger-old");
      await stale.checkpointWal();
      await stale.close();

      const reopened = new SqliteStakingLedgerToVotingLedgerService({
        lifecycleId: staleLifecycle,
      });
      await reopened.start();
      try {
        const stored = await reopened.readCheckpointLedgerHash();
        assert.equal(stored, "ledger-old");
        assert.notEqual(stored, "ledger-new");
      } finally {
        await reopened.close();
      }
    });
  });

  it("OPS-RESTART-006 records that S3 checkpoints have timeout and multipart handling but no content digest", async () => {
    const source = await readFile(
      `${REPOSITORY_ROOT}/apps/cli/src/lib/s3-checkpoint.ts`,
      "utf8",
    );

    assert.match(source, /CHECKPOINT_UPLOAD_TIMEOUT_MS/u);
    assert.match(source, /new Upload\(/u);
    assert.match(source, /pipeline\(/u);
    assert.doesNotMatch(source, /createHash|contentDigest|checksum/u);
  });

  it("OPS-RESTART-009/010 keeps failed proof persistence buffered and durable state unchanged", async () => {
    const storage = new BufferedProofStorage(0);
    await storage.setProof("ops-restart-009-proof", { from: 0, to: 0 });
    const durableBefore = [...storage.base];
    const writer: KeyValueBatchStorage = {
      async setMany() {
        throw new Error("storage proof persistence failed");
      },
      async close() {},
    };

    await assert.rejects(writer.setMany(storage.collectEntries()), (error) => {
      assert.equal(classifyFailure(error), "STORAGE_FAILURE");
      return true;
    });
    assert.deepEqual([...storage.base], durableBefore);
    assert.equal(storage.entries.length, 1);
    assert.equal(storage.entries[0]!.key, "proof:ops-restart-009-proof");
  });

  it("OPS-RESTART-011 rejects failed root publication and reopens without a partial root", async () => {
    const faultModes = ["before-write", "after-buffer"] as const;

    for (const faultMode of faultModes) {
      const storage = new BufferedProofStorage(1);
      const writer: KeyValueBatchStorage = {
        async setMany() {
          throw new Error(`storage root ${faultMode} failed`);
        },
        async close() {},
      };

      await assert.rejects(orchestrator(storage, writer).merge(), (error) => {
        assert.equal(classifyFailure(error), "STORAGE_FAILURE");
        return true;
      });
      const reopenedRoots = new Map(storage.roots);
      assert.equal(reopenedRoots.size, 0, faultMode);
      assert.equal(storage.entries.length, 1, faultMode);
      assert.equal(storage.entries[0]!.key, "root:root", faultMode);
    }
  });

  it("OPS-RESTART-013/018 records non-atomic and presence-only completion marker handling", async () => {
    const provingScheduler = await readFile(
      `${REPOSITORY_ROOT}/devops/docker/proving-scheduler-entrypoint.sh`,
      "utf8",
    );
    const votingScheduler = await readFile(
      `${REPOSITORY_ROOT}/devops/docker/voting-ledger-scheduler-entrypoint.sh`,
      "utf8",
    );

    for (const source of [provingScheduler, votingScheduler]) {
      assert.match(source, /cat > .*marker_path/u);
      assert.doesNotMatch(source, /mktemp.*marker|mv .*marker/u);
    }
    assert.match(provingScheduler, /\[ -e "\$\(proven_marker_path/u);
    assert.match(votingScheduler, /\[ -e "\$\(done_marker_path/u);
  });

  it("OPS-RESTART-014 bounds queue dependency faults before listener creation", async () => {
    const faults = ["disconnect", "refusal", "write failure"] as const;

    for (const fault of faults) {
      const { queue, events } = queueHarness({
        async add() {
          throw new Error("queue dependency failed");
        },
      });
      await assert.rejects(queue.addTask("test", { value: fault }), (error) => {
        assert.equal(classifyFailure(error), "DEPENDENCY_FAILURE");
        return true;
      });
      assert.equal(events.listenerCount("completed"), 0, fault);
      assert.equal(events.listenerCount("failed"), 0, fault);
    }
  });

  it("OPS-RESTART-015 records the shared queue and cross-scheduler obliteration boundary", async () => {
    const source = await readFile(
      `${REPOSITORY_ROOT}/devops/docker/proving-scheduler-entrypoint.sh`,
      "utf8",
    );

    assert.match(
      source,
      /PROVING_QUEUE_NAME="\$\{PROVING_QUEUE_NAME:-staking-ledger-to-voting-ledger\}"/u,
    );
    assert.match(source, /single fixed queue name shared/u);
    assert.match(source, /obliterates/u);
    assert.doesNotMatch(source, /owner[_ -]?key/iu);
  });

  it("OPS-RESTART-017 records SIGTERM checkpoint cleanup and hard-kill limits", async () => {
    const source = await readFile(
      `${REPOSITORY_ROOT}/apps/cli/src/commands/staking-ledger-to-voting-ledger.ts`,
      "utf8",
    );

    assert.match(source, /process\.once\("SIGTERM"/u);
    assert.match(source, /await scheduleCheckpoint/u);
    assert.match(source, /process\.removeListener\("SIGTERM"/u);
    assert.doesNotMatch(source, /SIGKILL/u);
  });

  it("OPS-RESTART-019 reopens only fully committed roots, counts, and next IDs", async () => {
    const storage = new BufferedProofStorage(2);
    const writer = {
      async setMany(entries: KeyValueEntry[]) {
        storage.commit(entries);
      },
      async close() {},
    } satisfies KeyValueBatchStorage;
    const root = await orchestrator(storage, writer).merge();

    const reopened = {
      roots: new Map(storage.roots),
      merged: new Set(storage.merged),
      baseCount: storage.base.size,
      nextBaseId: storage.base.size.toString(),
    };

    assert.deepEqual(root, { from: 0, to: 1 });
    assert.deepEqual(reopened.roots.get("root"), root);
    assert.equal(reopened.baseCount, 2);
    assert.equal(reopened.nextBaseId, "2");
    assert.deepEqual([...reopened.merged].sort(), ["0", "1"]);
  });
});
