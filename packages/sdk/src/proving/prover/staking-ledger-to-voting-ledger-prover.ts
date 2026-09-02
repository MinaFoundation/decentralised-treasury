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
import { forEachWithConcurrency } from "../../utils/concurrency.js";
import { StakingLedgerToVotingLedgerDigestTrace } from "../tracing/staking-ledger-to-voting-ledger-tracer.js";

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

    // Only ever the root merge() published, never an id derived from a count.
    // Reading `merge-${mergeCount - 1}` used to pick whichever merge happened
    // to be written last, which on any resumed merge is an interior node
    // covering a sliver of the ledger - exhaust then witnesses an index that
    // is not empty and dies on assertEquals every time it runs.
    const mergedProof = await proofStorage.getMergeProof(
      MergeProofOrchestrator.ROOT_PROOF_ID,
    );
    if (!mergedProof) {
      throw new Error(
        "No root merge proof found. Run proveMerge() to completion before proveExhaust().",
      );
    }

    // The root spans the whole staking ledger, so it starts at index 0. A
    // proof that does not is an interior node that reached storage under the
    // root id, and proving exhaust on top of it would produce a proof the
    // treasury contract rejects rather than an error here.
    const rootInputIndex = mergedProof.publicInput.index.toBigInt();
    if (rootInputIndex !== 0n) {
      throw new Error(
        `Root merge proof starts at index ${rootInputIndex.toString()}, expected 0 - the merge did not cover the whole staking ledger.`,
      );
    }

    stakingLedgerToVotingLedgerContext.set({
      stakingLedger,
      votingLedger: new ReplayableVotingLedger({}, {}),
    });

    // Exhaust may execute in a fresh process (e.g. standalone CLI command),
    // so compile here too, while honoring the configured proofs mode.
    await StakingLedgerToVotingLedger.compile({
      proofsEnabled: process.env.PROOFS_ENABLED === "true",
    });
    // The span, not the proof - dumping the whole root proof here put ~25KB of
    // base64 in front of every prove-exhaust failure and told you nothing
    // about which part of the ledger it actually covered.
    Provable.log("proving exhaust", {
      from: rootInputIndex.toString(),
      to: mergedProof.publicOutput.index.toBigInt().toString(),
    });
    const exhaustedProof = await StakingLedgerToVotingLedger.exhaust(
      mergedProof.publicInput,
      mergedProof,
    );

    return SideLoadedStakingLedgerToVotingLedgerProof.fromProof(
      exhaustedProof.proof,
    );
  }

  // How many stakingLedgerToVotingLedgerDigest tasks digest() keeps in
  // flight at once. Each in-flight task retains its serialized trace
  // payload and a pair of redis queue-event listeners in this process's own
  // heap until that specific job completes - so this, not the size of the
  // ledger, is what memory scales with. 256 keeps a full proving-worker
  // fleet fed many times over while staying trivially small in heap terms.
  public static readonly DEFAULT_DIGEST_CONCURRENCY = 256;

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
    concurrency: number = StakingLedgerToVotingLedgerProver.DEFAULT_DIGEST_CONCURRENCY,
  ) {
    let callbackQueue: Promise<void> = Promise.resolve();
    let callbackError: Error | undefined;

    // Only clears the redis queue - proofs already persisted to
    // proofStorage (by a prior attempt at this same range, e.g. one an
    // earlier crash interrupted before it reached endIndex) are untouched
    // and get skipped below rather than re-proved.
    await this.taskQueue.obliterate();

    await forEachWithConcurrency(
      this.pendingTraces(startIndex, endIndex),
      concurrency,
      async ({ index, trace }) => {
        // A previous attempt already proved this index - most likely a
        // restart from startIndex after a crash partway through the range,
        // since obliterate() above only ever clears in-flight work, never
        // proofStorage. Skipping the round trip through redis is what makes
        // restarting from startIndex cheap instead of redoing the whole
        // range every time.
        if (await this.proofStorage.getProof(index.toString())) {
          return;
        }

        await this.taskQueue.addTask(
          "stakingLedgerToVotingLedgerDigest",
          {
            trace,
            traceId: index,
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
      },
    );

    await callbackQueue;
    if (callbackError) {
      throw callbackError;
    }
  }

  // Lazily reads one trace at a time, capping how far ahead of the redis
  // queue this ever gets - paired with forEachWithConcurrency's own bound
  // in digest(), so at most `concurrency` traces are ever held in memory
  // waiting on a task slot.
  private async *pendingTraces(
    startIndex: number,
    endIndex: number,
  ): AsyncGenerator<{
    index: number;
    trace: StakingLedgerToVotingLedgerDigestTrace;
  }> {
    for (let i = startIndex; i <= endIndex; i++) {
      const trace = await this.traceStorage.getTrace(i);
      // no more traces to digest, stop proving
      if (!trace) return;
      yield { index: i, trace };
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
