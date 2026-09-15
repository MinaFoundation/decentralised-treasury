import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";
import { Keyv } from "keyv";
import type { JsonProof } from "o1js";

import {
  MergeProofOrchestrator,
  type MergeProofStorage,
} from "../../../src/proving/prover/merge-proof-orchestrator.js";
import type { Task, TaskQueue } from "../../../src/proving/task-queue.js";
import {
  SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
} from "../../../src/provable/staking-ledger-to-voting-ledger.js";
import type { KeyValueBatchStorage } from "../../../src/storage/batch-key-value-storage.js";
import { KeyvStakingLedgerToVotingLedgerProofStorage } from "../../../src/storage/keyv/keyv-staking-ledger-to-voting-ledger-proof-storage.js";
import { KeyvVoteReducerProofStorage } from "../../../src/storage/keyv/keyv-vote-reducer-proof-storage.js";
import type { KeyValueEntry } from "../../../src/storage/key-value-storage.js";

type ArtifactFailureClass = "INPUT_VALIDATION" | "STORAGE_FAILURE";

interface SpanProof {
  readonly from: number;
  readonly to: number;
  readonly content: string;
}

type AnyTaskQueue = TaskQueue<Record<string, Task<unknown, unknown>>>;

const REPOSITORY_ROOT = fileURLToPath(
  new URL("../../../../../", import.meta.url),
);
const COMMITTED_PROOF_FILES = [
  "apps/cli/artifacts/exhausted-proof.json",
  "apps/cli/artifacts/merged-proof.json",
  "apps/cli/test/fixtures/proposal-tally-votes-vote-reducer-merge.json",
  "apps/cli/test/fixtures/staking-ledger-to-voting-ledger-proof-mini.json",
] as const;
const PROOF_PAYLOAD_FIELDS = [
  "maxProofsVerified",
  "proof",
  "publicInput",
  "publicOutput",
] as const;
const PROVENANCE_FIELDS = [
  "applicationBuildSha",
  "chainId",
  "circuitDigest",
  "ledgerHash",
  "lifecycleId",
  "o1jsRevision",
  "program",
  "proofMode",
  "sourceRevision",
  "verificationKeyHash",
] as const;

let canonicalProofJson: JsonProof;

function cloneProofJson(): JsonProof {
  return structuredClone(canonicalProofJson);
}

function classifyArtifactFailure(error: unknown): ArtifactFailureClass {
  if (error instanceof Error && error.message === "injected batch failure") {
    return "STORAGE_FAILURE";
  }
  if (error instanceof Error) {
    return "INPUT_VALIDATION";
  }
  throw error;
}

async function decodeThenPublish(
  serialized: string,
  durableState: Map<string, string>,
): Promise<void> {
  const parsed = JSON.parse(serialized) as JsonProof;
  const decoded =
    await SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(parsed);
  durableState.set("root", JSON.stringify(decoded.toJSON()));
}

class FakeProofStorage implements MergeProofStorage<SpanProof> {
  public entries: KeyValueEntry[] = [];
  public readonly base = new Map<string, SpanProof>();
  public readonly merges = new Map<string, SpanProof>();
  public readonly merged = new Set<string>();

  public constructor(proofs: readonly SpanProof[]) {
    for (const [index, proof] of proofs.entries()) {
      this.base.set(index.toString(), proof);
    }
  }

  public async getProof(id: string): Promise<SpanProof | undefined> {
    return this.base.get(id);
  }

  public async setProof(id: string, proof: SpanProof): Promise<void> {
    this.entries.push({ key: `base:${id}`, value: JSON.stringify(proof) });
  }

  public async getMergeProof(id: string): Promise<SpanProof | undefined> {
    return this.merges.get(id);
  }

  public async setMergeProof(id: string, proof: SpanProof): Promise<void> {
    this.entries.push({ key: `merge:${id}`, value: JSON.stringify(proof) });
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
    return this.base.size;
  }

  public collectEntries(): KeyValueEntry[] {
    return this.entries;
  }

  public clearEntries(): void {
    this.entries = [];
  }

  public async close(): Promise<void> {}

  public commit(entries: readonly KeyValueEntry[]): void {
    for (const { key, value } of entries) {
      const [kind, ...idParts] = key.split(":");
      const id = idParts.join(":");
      if (kind === "base") {
        this.base.set(id, JSON.parse(value) as SpanProof);
      } else if (kind === "merge") {
        this.merges.set(id, JSON.parse(value) as SpanProof);
      } else if (kind === "merged") {
        this.merged.add(id);
      }
    }
  }
}

class SpanOrchestrator extends MergeProofOrchestrator<SpanProof> {
  public findMergeableProofs(
    proofs: Array<{ index: string; proof: SpanProof }>,
  ) {
    for (const proof1 of proofs) {
      const proof2 = proofs.find(
        (candidate) => candidate.proof.from === proof1.proof.to + 1,
      );
      if (proof2) {
        return { proof1, proof2 };
      }
    }
    return { proof1: undefined, proof2: undefined };
  }
}

function batchWriter(
  storage: FakeProofStorage,
  fail = false,
): KeyValueBatchStorage {
  return {
    async setMany(entries: KeyValueEntry[]) {
      if (fail) {
        throw new Error("injected batch failure");
      }
      storage.commit(entries);
    },
    async close() {},
  };
}

function taskQueue(state: { calls: number }): AnyTaskQueue {
  return {
    async obliterate() {},
    async addTask(
      _taskName: string,
      input: { proofs: { 1: SpanProof; 2: SpanProof } },
      onTaskComplete?: (output: { proof: SpanProof }) => Promise<void>,
    ) {
      state.calls += 1;
      const first = input.proofs[1];
      const second = input.proofs[2];
      await onTaskComplete?.({
        proof: {
          from: first.from,
          to: second.to,
          content: createHash("sha256")
            .update(`${first.content}|${second.content}`)
            .digest("hex"),
        },
      });
    },
  } as unknown as AnyTaskQueue;
}

function orchestrator(
  storage: FakeProofStorage,
  queue: AnyTaskQueue,
  failPublication = false,
): SpanOrchestrator {
  return new SpanOrchestrator(
    storage,
    batchWriter(storage, failPublication),
    queue,
    "merge",
  );
}

const zeroCounter = {
  async count(): Promise<number> {
    return 0;
  },
};

function proofCarrier<T>(): T {
  return {
    toJSON: cloneProofJson,
  } as T;
}

before(async () => {
  const proof = await SideLoadedStakingLedgerToVotingLedgerProof.dummy(
    StakingLedgerToVotingLedgerProgramInput.empty(),
    StakingLedgerToVotingLedgerProgramOutput.empty(),
    0,
  );
  canonicalProofJson = proof.toJSON();
});

describe("proof-off proof artifact transport", () => {
  it("requires the proof-off process contract", () => {
    assert.equal(process.env.PROOFS_ENABLED, "false");
  });

  it("ART-PROOF-001 round trips the canonical four-field JSON shape without authenticity credit", async () => {
    const decoded =
      await SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(
        cloneProofJson(),
      );
    const roundTripped = decoded.toJSON();

    assert.deepEqual(Object.keys(roundTripped).sort(), PROOF_PAYLOAD_FIELDS);
    assert.deepEqual(roundTripped, canonicalProofJson);
  });

  it("ART-PROOF-002/OPS-RESTART-012 rejects truncated JSON as INPUT_VALIDATION and preserves durable state", async () => {
    const complete = JSON.stringify(canonicalProofJson);
    const mutations = [
      { name: "empty", serialized: "" },
      { name: "opening brace", serialized: "{" },
      { name: "missing last byte", serialized: complete.slice(0, -1) },
      {
        name: "half payload",
        serialized: complete.slice(0, complete.length / 2),
      },
    ] as const;

    for (const mutation of mutations) {
      const durableState = new Map([["sentinel", "unchanged"]]);
      const beforeState = [...durableState];
      await assert.rejects(
        decodeThenPublish(mutation.serialized, durableState),
        (error) => {
          assert.equal(classifyArtifactFailure(error), "INPUT_VALIDATION");
          return true;
        },
        mutation.name,
      );
      assert.deepEqual([...durableState], beforeState, mutation.name);
    }
  });

  it("ART-PROOF-003 rejects missing required fields as INPUT_VALIDATION and preserves durable state", async () => {
    for (const field of PROOF_PAYLOAD_FIELDS) {
      const mutation = cloneProofJson() as JsonProof & Record<string, unknown>;
      delete mutation[field];
      const durableState = new Map([["sentinel", "unchanged"]]);
      const beforeState = [...durableState];

      await assert.rejects(
        decodeThenPublish(JSON.stringify(mutation), durableState),
        (error) => {
          assert.equal(classifyArtifactFailure(error), "INPUT_VALIDATION");
          return true;
        },
        field,
      );
      assert.deepEqual([...durableState], beforeState, field);
    }
  });

  it("ART-PROOF-004 characterizes unknown top-level fields as accepted and discarded", async () => {
    const mutation = {
      ...cloneProofJson(),
      verifierContext: { program: "unexpected-program" },
      unknownVersionField: "unexpected-value",
    } as JsonProof;
    const decoded =
      await SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(mutation);
    const roundTripped = decoded.toJSON() as JsonProof &
      Record<string, unknown>;

    assert.deepEqual(Object.keys(roundTripped).sort(), PROOF_PAYLOAD_FIELDS);
    assert.equal(roundTripped.verifierContext, undefined);
    assert.equal(roundTripped.unknownVersionField, undefined);
  });

  it("ART-PROOF-005/006 characterizes missing duplicate and reorder guards in proof storage", async () => {
    const stakingStorage = new KeyvStakingLedgerToVotingLedgerProofStorage(
      () => new Keyv(),
      "duplicate-replay",
      zeroCounter,
    );
    const voteStorage = new KeyvVoteReducerProofStorage(
      () => new Keyv(),
      "reordered-replay",
      zeroCounter,
    );

    try {
      await stakingStorage.setProof(
        "0",
        proofCarrier<
          Parameters<KeyvStakingLedgerToVotingLedgerProofStorage["setProof"]>[1]
        >(),
      );
      await stakingStorage.setProof(
        "0",
        proofCarrier<
          Parameters<KeyvStakingLedgerToVotingLedgerProofStorage["setProof"]>[1]
        >(),
      );
      assert.deepEqual(
        stakingStorage.collectEntries().map(({ key }) => key),
        [
          "staking-ledger-to-voting-ledger-proof-duplicate-replay:0",
          "staking-ledger-to-voting-ledger-proof-duplicate-replay:0",
        ],
        "the storage buffers a duplicated replay operation without rejection",
      );

      await voteStorage.setProof(
        "1",
        proofCarrier<Parameters<KeyvVoteReducerProofStorage["setProof"]>[1]>(),
      );
      await voteStorage.setProof(
        "0",
        proofCarrier<Parameters<KeyvVoteReducerProofStorage["setProof"]>[1]>(),
      );
      assert.deepEqual(
        voteStorage.collectEntries().map(({ key }) => key),
        [
          "vote-reducer-proof-reordered-replay:1",
          "vote-reducer-proof-reordered-replay:0",
        ],
        "the storage buffers reordered replay operations without rejection",
      );
    } finally {
      await stakingStorage.close();
      await voteStorage.close();
    }
  });

  it("ART-PROOF-007 characterizes changed public input as transport-valid but unauthenticated", async () => {
    const original = cloneProofJson();
    const mutation = cloneProofJson();
    mutation.publicInput[0] = mutation.publicInput[0] === "1" ? "2" : "1";

    const decoded =
      await SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(mutation);

    assert.notDeepEqual(decoded.toJSON().publicInput, original.publicInput);
    assert.deepEqual(canonicalProofJson, original);
  });

  it("ART-PROOF-008 characterizes changed public output as transport-valid but unauthenticated", async () => {
    const original = cloneProofJson();
    const mutation = cloneProofJson();
    mutation.publicOutput[0] = mutation.publicOutput[0] === "1" ? "2" : "1";

    const decoded =
      await SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(mutation);

    assert.notDeepEqual(decoded.toJSON().publicOutput, original.publicOutput);
    assert.deepEqual(canonicalProofJson, original);
  });

  it("ART-PROOF-009 characterizes verification-key metadata as unauthenticated transport data", async () => {
    const first = {
      ...cloneProofJson(),
      verificationKeyHash: "vk-a",
    } as JsonProof;
    const second = {
      ...cloneProofJson(),
      verificationKeyHash: "vk-b",
    } as JsonProof;

    const firstDecoded =
      await SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(first);
    const secondDecoded =
      await SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(second);

    assert.deepEqual(firstDecoded.toJSON(), secondDecoded.toJSON());
    assert.equal(
      (firstDecoded.toJSON() as JsonProof & Record<string, unknown>)
        .verificationKeyHash,
      undefined,
    );
  });

  it("ART-PROOF-010 characterizes circuit and o1js revisions as absent from cache identity", async () => {
    const revisions = [
      { circuitRevision: "circuit-a", o1jsRevision: "o1js-a" },
      { circuitRevision: "circuit-b", o1jsRevision: "o1js-b" },
    ] as const;

    const decoded = await Promise.all(
      revisions.map(async (revision) =>
        (
          await SideLoadedStakingLedgerToVotingLedgerProof.fromJSON({
            ...cloneProofJson(),
            ...revision,
          } as JsonProof)
        ).toJSON(),
      ),
    );

    assert.deepEqual(decoded[0], decoded[1]);
    assert.deepEqual(Object.keys(decoded[0]).sort(), PROOF_PAYLOAD_FIELDS);
  });

  it("ART-PROOF-012 characterizes stable child IDs as independent of changed proof content", async () => {
    const storage = new FakeProofStorage([
      { from: 0, to: 0, content: "base-a" },
      { from: 1, to: 1, content: "base-b" },
    ]);
    const state = { calls: 0 };
    const firstRoot = await orchestrator(storage, taskQueue(state)).merge();

    storage.base.set("0", { from: 0, to: 0, content: "changed-a" });
    storage.base.set("1", { from: 1, to: 1, content: "changed-b" });
    const secondRoot = await orchestrator(storage, taskQueue(state)).merge();

    assert.equal(state.calls, 1, "the second merge reuses the stable-ID cache");
    assert.deepEqual(secondRoot, firstRoot);
    assert.notEqual(
      secondRoot.content,
      createHash("sha256").update("changed-a|changed-b").digest("hex"),
    );
  });

  it("ART-PROOF-013 characterizes lifecycle isolation and missing proof-mode cache isolation", () => {
    const storageClasses = [
      KeyvStakingLedgerToVotingLedgerProofStorage,
      KeyvVoteReducerProofStorage,
    ] as const;

    for (const StorageClass of storageClasses) {
      const lifecycleA = StorageClass.proofNamespaceFrom("lifecycle-a");
      const lifecycleB = StorageClass.proofNamespaceFrom("lifecycle-b");
      const proofOff = StorageClass.proofNamespaceFrom("shared-lifecycle");
      const proofOn = StorageClass.proofNamespaceFrom("shared-lifecycle");

      assert.notEqual(lifecycleA, lifecycleB, StorageClass.name);
      assert.equal(
        proofOff,
        proofOn,
        `${StorageClass.name} has no proof-mode namespace input`,
      );
    }
  });

  it("ART-PROOF-014 records lifecycle separation and missing build identity", () => {
    for (const StorageClass of [
      KeyvStakingLedgerToVotingLedgerProofStorage,
      KeyvVoteReducerProofStorage,
    ] as const) {
      const lifecycleAUnderBuildA =
        StorageClass.proofNamespaceFrom("lifecycle-a");
      const lifecycleAUnderBuildB =
        StorageClass.proofNamespaceFrom("lifecycle-a");
      const lifecycleB = StorageClass.proofNamespaceFrom("lifecycle-b");

      assert.equal(lifecycleAUnderBuildA, lifecycleAUnderBuildB);
      assert.notEqual(lifecycleAUnderBuildA, lifecycleB);
      assert.equal(lifecycleAUnderBuildA.includes("build"), false);
    }
  });

  it("ART-PROOF-015 records absent program, key, and provenance metadata in committed payloads", async () => {
    const metadataFields = [
      "applicationBuildSha",
      "circuitDigest",
      "lifecycleId",
      "o1jsRevision",
      "program",
      "proofMode",
      "provenance",
      "verificationKeyHash",
    ] as const;

    for (const artifactFile of COMMITTED_PROOF_FILES) {
      const serialized = await readFile(
        new URL(artifactFile, `file://${REPOSITORY_ROOT}/`),
        "utf8",
      );
      const artifact = JSON.parse(serialized) as Record<string, unknown>;

      assert.deepEqual(
        Object.keys(artifact).sort(),
        PROOF_PAYLOAD_FIELDS,
        artifactFile,
      );
      for (const field of metadataFields) {
        assert.equal(artifact[field], undefined, `${artifactFile}:${field}`);
      }
    }
  });

  it("ART-PROOF-017 records that a corrupt proof payload has no proof-off authenticity", async (t) => {
    const mutation = cloneProofJson();
    const finalCharacter = mutation.proof.at(-1);
    mutation.proof = `${mutation.proof.slice(0, -1)}${finalCharacter === "A" ? "B" : "A"}`;

    let transportResult: "accepted" | "rejected";
    try {
      const decoded =
        await SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(mutation);
      assert.notEqual(decoded.toJSON().proof, canonicalProofJson.proof);
      transportResult = "accepted";
    } catch (error) {
      assert.equal(classifyArtifactFailure(error), "INPUT_VALIDATION");
      transportResult = "rejected";
    }

    assert.deepEqual(cloneProofJson(), canonicalProofJson);
    t.diagnostic(
      JSON.stringify({
        transportResult,
        authenticityChecked: false,
      }),
    );
  });

  it("ART-PROOF-018 skips an incompatible first candidate and selects a later pair", () => {
    const storage = new FakeProofStorage([]);
    const candidateOrchestrator = orchestrator(
      storage,
      taskQueue({ calls: 0 }),
    );
    const incompatible = {
      index: "first",
      proof: { from: 7, to: 7, content: "gap" },
    };
    const left = { index: "left", proof: { from: 0, to: 0, content: "left" } };
    const right = {
      index: "right",
      proof: { from: 1, to: 1, content: "right" },
    };

    assert.deepEqual(
      candidateOrchestrator.findMergeableProofs([incompatible, left, right]),
      { proof1: left, proof2: right },
    );
  });

  it("ART-PROOF-019 inventories committed proof provenance without inferring bindings", async (t) => {
    const inventoryFiles = [
      "apps/cli/test/fixtures/proposal-tally-votes-state.json",
      "apps/cli/artifacts/exhausted-proof.json",
      "apps/cli/artifacts/merged-proof.json",
    ] as const;
    const inventory = [];

    for (const artifactFile of inventoryFiles) {
      const artifact = JSON.parse(
        await readFile(
          new URL(artifactFile, `file://${REPOSITORY_ROOT}/`),
          "utf8",
        ),
      ) as Record<string, unknown>;
      const present = Object.fromEntries(
        PROVENANCE_FIELDS.map((field) => [field, field in artifact]),
      );
      inventory.push({ artifactFile, present });
    }

    assert.equal(
      inventory.every(({ present }) => present.sourceRevision === false),
      true,
    );
    assert.equal(
      inventory.every(({ present }) => present.verificationKeyHash === false),
      true,
    );
    assert.equal(
      inventory.every(({ present }) => present.applicationBuildSha === false),
      true,
    );
    t.diagnostic(JSON.stringify(inventory));
  });

  it("preserves durable state when the existing merge publication seam fails", async () => {
    const storage = new FakeProofStorage([
      { from: 0, to: 0, content: "single-base-proof" },
    ]);
    const durableBefore = [...storage.merges];

    await assert.rejects(
      orchestrator(storage, taskQueue({ calls: 0 }), true).merge(),
      (error) => {
        assert.equal(classifyArtifactFailure(error), "STORAGE_FAILURE");
        return true;
      },
    );
    assert.deepEqual([...storage.merges], durableBefore);
    assert.equal(storage.entries.length, 1, "the failed root stays buffered");
    assert.match(storage.entries[0]!.key, /^merge:root$/u);
  });
});
