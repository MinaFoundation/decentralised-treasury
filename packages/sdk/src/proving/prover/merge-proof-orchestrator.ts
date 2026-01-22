import { Provable } from "o1js";
import { Task, TaskQueue } from "../task-queue.js";

export interface MergeProofStorage<ProofType> {
  getProof(id: string): Promise<ProofType | undefined>;
  setProof(id: string, proof: ProofType): Promise<void>;
  getMergeProof(id: string): Promise<ProofType | undefined>;
  setMergeProof(id: string, proof: ProofType): Promise<void>;
  markAsMerged(id: string): Promise<void>;
  isMerged(id: string): Promise<boolean>;
  mergeCount(): Promise<number>;
  count(): Promise<number>;
}

// TODO: generalize to any proof type
export abstract class MergeProofOrchestrator<ProofType> {
  private static asMergeTaskOutput<ProofType>(value: unknown) {
    return value as { proof: ProofType };
  }
  abstract findMergeableProofs(
    proofs: {
      index: string;
      proof: ProofType;
    }[]
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
    public taskQueue: TaskQueue<Record<string, Task<unknown, unknown>>>,
    public mergeTaskName: string
  ) {}

  public async merge(
    onMergeComplete?: (
      index: number,
      proof: ProofType
    ) => void
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

    let index = 0;

    // wait until at least 1 worker is available
    // TODO: use queue pending/active jobs instead
    // const waitForWorkers = async () => {
    //   while (availableWorkers === 0) {
    //     await new Promise((resolve) => setTimeout(resolve, 100));
    //   }
    // };

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

      this.taskQueue.addTask(
        this.mergeTaskName,
        {
          proofs: { 1: proof1.proof, 2: proof2.proof },
        },
        async (result) => {
          const typedResult =
            MergeProofOrchestrator.asMergeTaskOutput<ProofType>(result);
          //   availableWorkers++;
          mergeCount = await this.proofStorage.mergeCount();

          Provable.log("setting merge proof", mergeCount);

          proofs.push({
            proof: typedResult.proof,
            index: mergeCount.toString(),
          });

          await this.proofStorage.setMergeProof(
            mergeCount.toString(),
            typedResult.proof
          );

          await this.proofStorage.markAsMerged(proof1.index);
          await this.proofStorage.markAsMerged(proof2.index);
          mergeCount = await this.proofStorage.mergeCount();

          if (mergeCount < expectedMergeCount) {
            merge();
          }
        }
      );
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
        while (mergeCount < expectedMergeCount) {
          Provable.log(
            "waiting for merging to finish",
            mergeCount,
            "/",
            expectedMergeCount
          );
          await this.taskQueue.waitUntilEmpty();
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        const proof = await this.proofStorage.getMergeProof(
          (expectedMergeCount - 1).toString()
        );

        if (!proof) {
          throw new Error("No merge proof found");
        }

        resolve(proof);
      }
    );
  }
}
