import {
  SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedger,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
  stakingLedgerToVotingLedgerContext,
} from "../../provable/staking-ledger-to-voting-ledger.js";
import { Proof, Provable } from "o1js";
import { StakingLedgerToVotingLedgerDigestTraceStorage } from "../../storage/staking-ledger-to-voting-ledger-digest-trace-storage.js";
import { StakingLedgerToVotingLedgerDigestTask } from "../tasks/staking-ledger-to-voting-ledger-digest-task.js";
import { TaskQueue } from "../task-queue.js";
import { StakingLedgerToVotingLedgerProofStorage } from "../../storage/staking-ledger-to-voting-ledger-proof-storage.js";
import { StakingLedger } from "../../ledgers/staking-ledger/staking-ledger.js";
import { ReplayableVotingLedger } from "../../ledgers/voting-ledger/replayable-voting-ledger.js";
import { StakingLedgerToVotingLedgerMergeTask } from "../tasks/staking-ledger-to-voting-ledger-merge-task.js";
import { MergeProofOrchestrator } from "./merge-proof-orchestrator.js";
import { KeyValueBatchStorage } from "../../storage/batch-key-value-storage.js";

export type StakingLedgerToVotingLedgerTaskQueue = TaskQueue<{
  stakingLedgerToVotingLedgerDigest: typeof StakingLedgerToVotingLedgerDigestTask;
  stakingLedgerToVotingLedgerMerge: typeof StakingLedgerToVotingLedgerMergeTask;
}>;

export const WORKER_COUNT = 1;

export class StakingLedgerToVotingLedgerProver extends MergeProofOrchestrator<SideLoadedStakingLedgerToVotingLedgerProof> {
  public static async proveExhaust(params: {
    stakingLedger: StakingLedger;
    proofStorage: StakingLedgerToVotingLedgerProofStorage;
  }): Promise<SideLoadedStakingLedgerToVotingLedgerProof> {
    const { stakingLedger, proofStorage } = params;
    const mergeCount = await proofStorage.mergeCount();
    if (mergeCount <= 0) {
      throw new Error(
        "No merged proof found. Run proveMerge() before proveExhaust().",
      );
    }

    const mergedProofId = `merge-${(mergeCount - 1).toString()}`;
    const mergedProof = await proofStorage.getMergeProof(mergedProofId);
    if (!mergedProof) {
      throw new Error(`Missing merged proof with id ${mergedProofId}`);
    }

    stakingLedgerToVotingLedgerContext.set({
      stakingLedger,
      votingLedger: new ReplayableVotingLedger({}, {}),
    });

    // Exhaust may execute in a fresh process (e.g. standalone CLI command),
    // so compile with proofs enabled to ensure a prover exists.
    await StakingLedgerToVotingLedger.compile({ proofsEnabled: true });
    const exhaustedProof = await StakingLedgerToVotingLedger.exhaust(
      mergedProof.publicInput,
      mergedProof,
    );

    return SideLoadedStakingLedgerToVotingLedgerProof.fromProof(
      exhaustedProof.proof,
    );
  }

  constructor(
    public stakingLedger: StakingLedger,
    public traceStorage: StakingLedgerToVotingLedgerDigestTraceStorage,
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

  public async exhaust(): Promise<SideLoadedStakingLedgerToVotingLedgerProof> {
    return await StakingLedgerToVotingLedgerProver.proveExhaust({
      stakingLedger: this.stakingLedger,
      proofStorage: this.proofStorage,
    });
  }
}
