import {
  SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
} from "../../provable/staking-ledger-to-voting-ledger.js";
import { Proof, Provable } from "o1js";
import { StakingLedgerToVotingLedgerDigestTraceBatchStorage } from "../../storage/staking-ledger-to-voting-ledger-digest-trace-batch-storage.js";
import { StakingLedgerToVotingLedgerDigestTask } from "../tasks/staking-ledger-to-voting-ledger-digest-task.js";
import { TaskQueue } from "../task-queue.js";
import { StakingLedgerToVotingLedgerProofStorage } from "../../storage/staking-ledger-to-voting-ledger-proof-storage.js";
import { StakingLedger } from "../../ledgers/staking-ledger/staking-ledger.js";
import { StakingLedgerToVotingLedgerMergeTask } from "../tasks/staking-ledger-to-voting-ledger-merge-task.js";
import { MergeProofOrchestrator } from "./merge-proof-orchestrator.js";
import { KeyValueBatchStorage } from "../../storage/batch-key-value-storage.js";

export type StakingLedgerToVotingLedgerTaskQueue = TaskQueue<{
  stakingLedgerToVotingLedgerDigest: typeof StakingLedgerToVotingLedgerDigestTask;
  stakingLedgerToVotingLedgerMerge: typeof StakingLedgerToVotingLedgerMergeTask;
}>;

export const WORKER_COUNT = 1;

export class StakingLedgerToVotingLedgerProver extends MergeProofOrchestrator<SideLoadedStakingLedgerToVotingLedgerProof> {
  constructor(
    public stakingLedger: StakingLedger,
    public traceStorage: StakingLedgerToVotingLedgerDigestTraceBatchStorage,
    public proofStorage: StakingLedgerToVotingLedgerProofStorage,
    public batchWriter: KeyValueBatchStorage,
    public taskQueue: StakingLedgerToVotingLedgerTaskQueue,
  ) {
    super(
      proofStorage,
      batchWriter,
      taskQueue,
      "stakingLedgerToVotingLedgerMerge",
    );
    // TODO: add a queue drain on start, to avoid any unwanted behavior
  }

  public async digest(
    startIndex: number = 0,
    endIndex: number = Infinity,
    onDigestComplete?: (
      index: number,
      proof: Proof<
        StakingLedgerToVotingLedgerProgramInput,
        StakingLedgerToVotingLedgerProgramOutput
      >,
    ) => void,
  ) {
    const taskPromises: Promise<void>[] = [];
    let callbackQueue: Promise<void> = Promise.resolve();
    let callbackError: Error | undefined;

    await this.taskQueue.obliterate();

    for (let i = startIndex; i <= endIndex; i++) {
      const trace = await this.traceStorage.getTrace(i);
      // no more traces to digest, stop proving
      if (!trace) break;

      const taskPromise = this.taskQueue.addTask(
        "stakingLedgerToVotingLedgerDigest",
        {
          trace,
          traceId: i,
        },
        async (result) => {
          callbackQueue = callbackQueue
            .then(async () => {
              const sideLoadedProof =
                await SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(
                  result.proof.toJSON(),
                );
              await this.proofStorage.setProof(
                result.traceId.toString(),
                sideLoadedProof,
              );

              const entries = this.proofStorage.collectEntries();
              await this.batchWriter.setMany(entries);
              this.proofStorage.clearEntries();

              onDigestComplete?.(result.traceId, result.proof);
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
      proof: SideLoadedStakingLedgerToVotingLedgerProof;
    }[],
  ) {
    // if there are not at least 2 proofs, there is nothing to merge
    if (proofs.length < 2) {
      return { proof1: undefined, proof2: undefined };
    }

    // sort proofs by index, so that we can find the first proof that should be merged
    proofs = proofs.sort(
      ({ proof: aProof }, { proof: bProof }) =>
        Number(aProof.publicInput.index.toBigInt()) -
        Number(bProof.publicInput.index.toBigInt()),
    );

    for (const proof1 of proofs) {
      const proof1OutputIndex = proof1.proof.publicOutput.index.toBigInt();
      // find the next proof that can be merged with the current proof
      const proof2 = proofs.find(({ proof }) => {
        const proof2InputIndex = proof.publicInput.index.toBigInt();
        return proof2InputIndex === proof1OutputIndex + 1n;
      });

      if (proof2) {
        return { proof1, proof2 };
      }
    }

    return { proof1: undefined, proof2: undefined };
  }
}
