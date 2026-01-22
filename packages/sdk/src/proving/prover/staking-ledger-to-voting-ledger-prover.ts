import {
  SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
} from "../../provable/staking-ledger-to-voting-ledger.js";
import { Proof, Provable } from "o1js";
import { StakingLedgerToVotingLedgerDigestTraceStorage } from "../../storage/staking-ledger-to-voting-ledger-digest-trace-storage.js";
import { StakingLedgerToVotingLedgerDigestTask } from "../tasks/staking-ledger-to-voting-ledger-digest-task.js";
import { TaskQueue } from "../task-queue.js";
import { StakingLedgerToVotingLedgerProofStorage } from "../../storage/staking-ledger-to-voting-ledger-proof-storage.js";
import { StakingLedger } from "../../ledgers/staking-ledger/staking-ledger.js";
import { StakingLedgerToVotingLedgerMergeTask } from "../tasks/staking-ledger-to-voting-ledger-merge-task.js";
import { MergeProofOrchestrator } from "./merge-proof-orchestrator.js";

export type StakingLedgerToVotingLedgerTaskQueue = TaskQueue<{
  stakingLedgerToVotingLedgerDigest: typeof StakingLedgerToVotingLedgerDigestTask;
  stakingLedgerToVotingLedgerMerge: typeof StakingLedgerToVotingLedgerMergeTask;
}>;

export const WORKER_COUNT = 1;

export class StakingLedgerToVotingLedgerProver extends MergeProofOrchestrator<SideLoadedStakingLedgerToVotingLedgerProof> {
  constructor(
    public stakingLedger: StakingLedger,
    public traceStorage: StakingLedgerToVotingLedgerDigestTraceStorage,
    public proofStorage: StakingLedgerToVotingLedgerProofStorage,
    public taskQueue: StakingLedgerToVotingLedgerTaskQueue
  ) {
    super(proofStorage, taskQueue, "stakingLedgerToVotingLedgerMerge");
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
      >
    ) => void
  ) {
    const taskPromises: Promise<void>[] = [];
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
          const sideLoadedProof =
            await SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(
              result.proof.toJSON()
            );
          await this.proofStorage.setProof(
            result.traceId.toString(),
            sideLoadedProof
          );
          onDigestComplete?.(i, result.proof);
        }
      );

      taskPromises.push(taskPromise);
    }

    await this.taskQueue.waitUntilEmpty();
    await Promise.all(taskPromises);
  }

  public findMergeableProofs(
    proofs: {
      index: string;
      proof: SideLoadedStakingLedgerToVotingLedgerProof;
    }[]
  ) {
    // if there are not at least 2 proofs, there is nothing to merge
    if (proofs.length < 2) {
      return { proof1: undefined, proof2: undefined };
    }

    // sort proofs by index, so that we can find the first proof that should be merged
    proofs = proofs.sort(
      ({ proof: aProof }, { proof: bProof }) =>
        Number(aProof.publicInput.index.toBigint()) -
        Number(bProof.publicInput.index.toBigint())
    );

    const proof1 = proofs[0];
    const proof1OutputIndex = proof1.proof.publicOutput.index.toBigint();
    // TODO: find should return optionally undefined, this is not typed properly
    // find the next proof that can be merged with the first proof
    const proof2 = proofs.find(({ proof }) => {
      const proof2InputIndex = proof.publicInput.index.toBigint();
      return proof2InputIndex === proof1OutputIndex + 1n;
    });

    return { proof1, proof2 };
  }
}
