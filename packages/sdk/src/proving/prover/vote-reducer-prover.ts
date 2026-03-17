import { Proof } from "o1js";
import {
  SideLoadedVoteReducerProof,
  VoteReducerPublicInput,
  VoteReducerPublicOutput,
} from "../../provable/contracts/treasury-proposal/vote-reducer.js";
import { VoteReducerRunBatchTraceStorage } from "../../storage/vote-reducer-run-batch-trace-storage.js";
import { VoteReducerProofStorage } from "../../storage/vote-reducer-proof-storage.js";
import { TaskQueue } from "../task-queue.js";
import { VoteReducerRunBatchTask } from "../tasks/vote-reducer-run-batch-task.js";
import { VoteReducerMergeTask } from "../tasks/vote-reducer-merge-task.js";
import { MergeProofOrchestrator } from "./merge-proof-orchestrator.js";
import { KeyValueBatchStorage } from "../../storage/batch-key-value-storage.js";

export type VoteReducerTaskQueue = TaskQueue<{
  voteReducerRunBatch: typeof VoteReducerRunBatchTask;
  voteReducerMerge: typeof VoteReducerMergeTask;
}>;

export class VoteReducerProver extends MergeProofOrchestrator<SideLoadedVoteReducerProof> {
  constructor(
    public traceStorage: VoteReducerRunBatchTraceStorage,
    public proofStorage: VoteReducerProofStorage,
    public batchWriter: KeyValueBatchStorage,
    public taskQueue: VoteReducerTaskQueue,
  ) {
    super(proofStorage, batchWriter, taskQueue, "voteReducerMerge");
  }

  public async runBatch(
    startIndex: number = 0,
    endIndex: number = Infinity,
    onRunBatchComplete?: (
      index: number,
      proof: Proof<VoteReducerPublicInput, VoteReducerPublicOutput>,
    ) => void,
  ) {
    const taskPromises: Promise<void>[] = [];
    let callbackQueue: Promise<void> = Promise.resolve();
    let callbackError: Error | undefined;

    await this.taskQueue.obliterate();

    for (let i = startIndex; i <= endIndex; i++) {
      const trace = await this.traceStorage.getTrace(i);
      if (!trace) break;

      const taskPromise = this.taskQueue.addTask(
        "voteReducerRunBatch",
        {
          trace,
          traceId: i,
        },
        async (result) => {
          callbackQueue = callbackQueue
            .then(async () => {
              const sideLoadedProof = await SideLoadedVoteReducerProof.fromJSON(
                result.proof.toJSON(),
              );
              await this.proofStorage.setProof(
                result.traceId.toString(),
                sideLoadedProof,
              );

              const entries = this.proofStorage.collectEntries();
              await this.batchWriter.setMany(entries);
              this.proofStorage.clearEntries();

              onRunBatchComplete?.(result.traceId, result.proof);
            })
            .catch((error: unknown) => {
              callbackError =
                error instanceof Error ? error : new Error(String(error));
            });
        },
      );

      taskPromises.push(taskPromise);
    }

    await this.taskQueue.waitUntilEmpty();
    await Promise.all(taskPromises);
    await callbackQueue;
    if (callbackError) {
      throw callbackError;
    }
  }

  public findMergeableProofs(
    proofs: {
      index: string;
      proof: SideLoadedVoteReducerProof;
    }[],
  ) {
    if (proofs.length < 2) {
      return { proof1: undefined, proof2: undefined };
    }

    for (const proof1 of proofs) {
      const proof1ActionsHash =
        proof1.proof.publicOutput.toActionsHash.toString();
      const proof2 = proofs.find(
        ({ proof }) =>
          proof.publicInput.fromActionsHash.toString() === proof1ActionsHash,
      );

      if (proof2) {
        return { proof1, proof2 };
      }
    }

    return { proof1: undefined, proof2: undefined };
  }

  public async close(): Promise<void> {
    await this.traceStorage.close();
    await this.proofStorage.close();
    await this.taskQueue.close();
  }
}
