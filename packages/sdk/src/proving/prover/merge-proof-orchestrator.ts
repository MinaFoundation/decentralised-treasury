import { Provable } from "o1js";
import { Task, TaskQueue } from "../task-queue.js";
import { BatchStorage } from "../../storage/batch-storage.js";
import { KeyValueBatchStorage } from "../../storage/batch-key-value-storage.js";

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

  public async merge(
    onMergeComplete?: (index: number, proof: ProofType) => void,
  ) {
    // let availableWorkers = WORKER_COUNT;
    let mergeCount = await this.proofStorage.mergeCount();
    const baseProofCount = await this.proofStorage.count();
    const expectedMergeCount = baseProofCount - 1;

    Provable.log("merge", {
      mergeCount,
      baseProofCount,
      expectedMergeCount,
    });

    let proofs: {
      index: string;
      proof: ProofType;
    }[] = [];
    let callbackQueue: Promise<void> = Promise.resolve();
    let callbackError: Error | undefined;
    const mergeTaskPromises: Promise<void>[] = [];

    await this.taskQueue.obliterate();

    const addPendingProof = (proof: { index: string; proof: ProofType }) => {
      if (!proofs.some((pending) => pending.index === proof.index)) {
        proofs.push(proof);
      }
    };

    const merge = async () => {
      const { proof1, proof2 } = this.findMergeableProofs(proofs);

      // if we found a pair, remove it from the list of pending proofs
      if (proof1 && proof2) {
        proofs.splice(proofs.indexOf(proof1), 1);
        proofs.splice(proofs.indexOf(proof2), 1);
      }

      if (!proof1 || !proof2) {
        Provable.log("no mergeable proofs found, skipping");
        return;
      } else {
        Provable.log("found mergeable proofs", proof1?.index, proof2?.index);
      }

      // await waitForWorkers();
      //   availableWorkers--;
      Provable.log("adding merge task", proof1.index, proof2.index);

      const taskPromise = this.taskQueue
        .addTask(
          this.mergeTaskName,
          {
            proofs: { 1: proof1.proof, 2: proof2.proof },
          },
          async (result) => {
            callbackQueue = callbackQueue
              .then(async () => {
                const typedResult =
                  MergeProofOrchestrator.asMergeTaskOutput<ProofType>(result);
                //   availableWorkers++;
                mergeCount = await this.proofStorage.mergeCount();

                Provable.log("setting merge proof", mergeCount);

                proofs.push({
                  proof: typedResult.proof,
                  index: `merge-${mergeCount.toString()}`,
                });

                await this.proofStorage.setMergeProof(
                  `merge-${mergeCount.toString()}`,
                  typedResult.proof,
                );

                await this.proofStorage.markAsMerged(proof1.index);
                await this.proofStorage.markAsMerged(proof2.index);

                const entries = this.proofStorage.collectEntries();
                await this.batchWriter.setMany(entries);
                this.proofStorage.clearEntries();

                mergeCount = await this.proofStorage.mergeCount();

                onMergeComplete?.(mergeCount, typedResult.proof);

                if (mergeCount < expectedMergeCount) {
                  merge();
                }
              })
              .catch((error: unknown) => {
                callbackError =
                  error instanceof Error ? error : new Error(String(error));
              });
          },
        )
        .catch((error: unknown) => {
          // // Reinsert proofs so failed merge jobs do not permanently drop inputs.
          // addPendingProof(proof1);
          // addPendingProof(proof2);
          callbackError =
            error instanceof Error ? error : new Error(String(error));
        });
      mergeTaskPromises.push(taskPromise);
    };

    // read all base proofs and add them to the proofs list for merging
    for (let i = 0; i < baseProofCount; i += 2) {
      const index1 = i;
      const index2 = i + 1;

      const proof1 = await this.proofStorage.getProof(index1.toString());
      const proof2 = await this.proofStorage.getProof(index2.toString());

      const isMerged1 = await this.proofStorage.isMerged(index1.toString());
      const isMerged2 = await this.proofStorage.isMerged(index2.toString());

      proof1 &&
        !isMerged1 &&
        proofs.push({ proof: proof1, index: index1.toString() });
      proof2 &&
        !isMerged2 &&
        proofs.push({ proof: proof2, index: index2.toString() });

      await merge();
    }

    // read all merge proofs and add them to the proofs list for merging
    for (let i = 0; i < expectedMergeCount; i++) {
      // we use this prefix to avoid collisions with indexes in the "isMerged" method
      const index = `merge-${i}`;
      const proof = await this.proofStorage.getMergeProof(index);
      const isMerged = await this.proofStorage.isMerged(index);

      proof && !isMerged && proofs.push({ proof, index });
      await merge();
    }

    return new Promise<ProofType>(async (resolve) => {
      let lastMergeCount = mergeCount;
      let isStalledCount = 0;
      while (mergeCount < expectedMergeCount) {
        if (callbackError) {
          throw callbackError;
        }
        if (lastMergeCount === mergeCount) {
          isStalledCount++;
        }
        lastMergeCount = mergeCount;

        Provable.log(
          "waiting for merging to finish",
          mergeCount,
          "/",
          expectedMergeCount,
          "isStalledCount",
          isStalledCount,
        );
        if (isStalledCount > 5) {
          Provable.log("merge is stalled", {
            jobCounts: await this.taskQueue.queue.getJobCounts(),
            pendingProofs: proofs.length,
            proofs: proofs.map((p) => ({
              index: p.index,
              input: (p.proof as any).publicInput.index.toBigInt(),
              output: (p.proof as any).publicOutput.index.toBigInt(),
            })),
          });
          throw new Error("Merge is stalled");
        }

        await this.taskQueue.waitUntilEmpty();
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      await callbackQueue;
      await Promise.allSettled(mergeTaskPromises);
      if (callbackError) {
        throw callbackError;
      }

      const proof = await this.proofStorage.getMergeProof(
        "merge-" + (expectedMergeCount - 1).toString(),
      );

      if (!proof) {
        throw new Error("No merge proof found");
      }

      resolve(proof);
    });
  }
}
