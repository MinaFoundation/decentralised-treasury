import { Task, TaskQueue } from "../task-queue.js";
import { BatchStorage } from "../../storage/batch-storage.js";
import { KeyValueBatchStorage } from "../../storage/batch-key-value-storage.js";
import { provableLog } from "../../logging/logger.js";
import { createHash } from "node:crypto";

export interface MergeProofStorage<ProofType> extends BatchStorage {
  getProof(id: string): Promise<ProofType | undefined>;
  setProof(id: string, proof: ProofType): Promise<void>;
  getMergeProof(id: string): Promise<ProofType | undefined>;
  setMergeProof(id: string, proof: ProofType): Promise<void>;
  markAsMerged(id: string): Promise<void>;
  isMerged(id: string): Promise<boolean>;
  mergeCount(): Promise<number>;
  count(): Promise<number>;
}

export abstract class MergeProofOrchestrator<ProofType> {
  // Same reasoning as StakingLedgerToVotingLedgerProver.DEFAULT_DIGEST_CONCURRENCY:
  // merge() used to fire an addTask() for every mergeable pair it found while
  // seeding its pending-proof list, with no bound on how many were in flight
  // at once - each holding a pair of deserialized proof objects and a set of
  // queue-event listeners alive until that specific merge completed. For an
  // 18,000+ leaf tree that is the same unbounded-heap-growth shape as the
  // digest bug, just with heavier payloads per in-flight item.
  public static readonly DEFAULT_MERGE_CONCURRENCY = 256;

  // Where merge() publishes the finished root proof, and the only id anything
  // downstream should read a "the whole ledger" proof back from.
  public static readonly ROOT_PROOF_ID = "root";

  // Merge proofs are keyed by the identity of the pair they were built from,
  // not by a running counter.
  //
  // The counter made the store order-dependent, and that count doubled as both
  // the completion test (`mergeCount < baseProofCount - 1`) and the id the root
  // was read back from (`merge-${baseProofCount - 2}`). An interrupted run
  // resumed by re-merging pairs it had already merged, every duplicate pushed
  // the stored count past the expected one, and past that point merge() did
  // nothing at all, silently returned an interior node as the root, and
  // prove-exhaust - which picked a *different* interior node - failed its root
  // assert on every retry, forever.
  //
  // Hashing the child ids makes an id reproducible across runs and bounded in
  // length: nesting the ids themselves doubles their size at every level of an
  // 18,000-leaf tree. The store becomes a pure cache - a hit skips the proving
  // work, a miss just re-proves it, and stale or overlapping entries from an
  // earlier run are inert because nothing ever enumerates them.
  private static mergeIdFor(index1: string, index2: string): string {
    const digest = createHash("sha256")
      .update(`${index1}|${index2}`)
      .digest("hex");

    return `merge-${digest.slice(0, 32)}`;
  }

  private static asMergeTaskOutput<ProofType>(value: unknown) {
    return value as { proof: ProofType };
  }

  abstract findMergeableProofs(
    proofs: {
      index: string;
      proof: ProofType;
    }[],
  ):
    | { proof1: undefined; proof2: undefined }
    | {
        proof1: {
          index: string;
          proof: ProofType;
        };
        proof2: {
          index: string;
          proof: ProofType;
        };
      };

  constructor(
    public proofStorage: MergeProofStorage<ProofType>,
    public batchWriter: KeyValueBatchStorage,
    public taskQueue: TaskQueue<Record<string, Task<unknown, unknown>>>,
    public mergeTaskName: string,
  ) {}

  private persistQueue: Promise<void> = Promise.resolve();

  // Reduces every base proof to a single root proof and returns it.
  //
  // `onMergeComplete` is called once per merged pair with the running count of
  // completed merges, which is always exactly `baseProofCount - 1` by the time
  // this resolves: each merge consumes two pending proofs and produces one.
  public async merge(
    onMergeComplete?: (completed: number, proof: ProofType) => void,
    concurrency: number = MergeProofOrchestrator.DEFAULT_MERGE_CONCURRENCY,
  ): Promise<ProofType> {
    const baseProofCount = await this.proofStorage.count();

    if (baseProofCount === 0) {
      throw new Error("No base proofs found. Run proving before merge().");
    }

    // The pending forest is seeded from the base proofs alone, and from that
    // point on it - not the merge namespace - is the only authority on what
    // still needs merging. Nothing is ever enumerated out of the merge
    // namespace, only read back by exact id, so entries an earlier
    // interrupted run left behind cannot steer this one.
    const pending: Array<{ index: string; proof: ProofType }> = [];
    for (let index = 0; index < baseProofCount; index++) {
      const id = index.toString();
      const proof = await this.proofStorage.getProof(id);

      if (!proof) {
        throw new Error(
          `Missing base proof with id ${id} of ${baseProofCount.toString()} - base proofs must be contiguous from 0. Re-run digest before merge().`,
        );
      }

      pending.push({ index: id, proof });
    }

    if (pending.length === 1) {
      const root = pending[0]!.proof;
      await this.persist(async () => {
        await this.proofStorage.setMergeProof(
          MergeProofOrchestrator.ROOT_PROOF_ID,
          root,
        );
      });
      return root;
    }

    await this.taskQueue.obliterate();

    const expectedMergeCount = baseProofCount - 1;
    provableLog("merge", { baseProofCount, expectedMergeCount });

    const running = new Set<Promise<void>>();
    let completed = 0;
    let reused = 0;
    let failure: Error | undefined;

    const mergePair = async (
      first: { index: string; proof: ProofType },
      second: { index: string; proof: ProofType },
    ): Promise<void> => {
      const id = MergeProofOrchestrator.mergeIdFor(first.index, second.index);
      let merged: ProofType | undefined =
        await this.proofStorage.getMergeProof(id);

      if (merged) {
        // An earlier run already proved this exact pair. Reusing it is what
        // makes a resumed merge cheap; a miss is merely slower, never wrong.
        reused++;
      } else {
        let output: { proof: ProofType } | undefined;

        await this.taskQueue.addTask(
          this.mergeTaskName,
          { proofs: { 1: first.proof, 2: second.proof } },
          async (result) => {
            output =
              MergeProofOrchestrator.asMergeTaskOutput<ProofType>(result);
          },
        );

        if (!output) {
          throw new Error(`Merge task ${id} completed without a proof`);
        }

        merged = output.proof;
        await this.persist(async () => {
          await this.proofStorage.setMergeProof(id, merged!);
          await this.proofStorage.markAsMerged(first.index);
          await this.proofStorage.markAsMerged(second.index);
        });
      }

      completed++;
      pending.push({ index: id, proof: merged });
      onMergeComplete?.(completed, merged);
    };

    // Pairs are chosen and spliced out synchronously, so no two in-flight
    // merges can ever claim the same pending proof. `running.size` is what
    // bounds how many merges - and so how many held proof pairs and queue-event
    // listeners - exist at once; see DEFAULT_MERGE_CONCURRENCY.
    const schedule = (): void => {
      while (!failure && running.size < concurrency) {
        const { proof1, proof2 } = this.findMergeableProofs(pending);

        if (!proof1 || !proof2) {
          return;
        }

        pending.splice(pending.indexOf(proof1), 1);
        pending.splice(pending.indexOf(proof2), 1);

        const task = mergePair(proof1, proof2).catch((error: unknown) => {
          failure ??= error instanceof Error ? error : new Error(String(error));
        });

        running.add(task);
        void task.finally(() => {
          running.delete(task);
          schedule();
        });
      }
    };

    schedule();

    // Every task is wrapped in a .catch above, so none of these reject and
    // the loop always drains - a failure stops new work being scheduled
    // rather than abandoning merges that are already in flight.
    while (running.size > 0) {
      await Promise.race(Array.from(running));
    }

    if (failure) {
      throw failure;
    }

    if (pending.length !== 1) {
      throw new Error(
        `Merge stalled: ${pending.length.toString()} disjoint proofs remain after ${completed.toString()} of ${expectedMergeCount.toString()} merges (${reused.toString()} reused). The base proofs do not form one contiguous chain: ${pending
          .map(({ index }) => index)
          .join(", ")}`,
      );
    }

    const root = pending[0]!.proof;
    await this.persist(async () => {
      await this.proofStorage.setMergeProof(
        MergeProofOrchestrator.ROOT_PROOF_ID,
        root,
      );
    });

    provableLog("merge complete", { completed, reused, expectedMergeCount });

    return root;
  }

  // Applies storage mutations one at a time. The proof storages buffer writes
  // in a single shared `entries` array that collectEntries()/clearEntries()
  // drain, so two concurrent merges racing on it would let one clear entries
  // the other had pushed but not yet written.
  private async persist(mutate: () => Promise<void>): Promise<void> {
    const next = this.persistQueue.then(async () => {
      await mutate();

      const entries = this.proofStorage.collectEntries();
      if (entries.length > 0) {
        await this.batchWriter.setMany(entries);
        this.proofStorage.clearEntries();
      }
    });

    // Keep the chain alive for the next caller even when this link rejects;
    // the rejection is still delivered to whoever awaited `next`.
    this.persistQueue = next.catch(() => undefined);

    return await next;
  }
}
