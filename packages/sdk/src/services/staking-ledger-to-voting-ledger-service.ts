import { hashWithPrefix } from "../provable/hashing-helpers.js";
import {
  Account,
  accountHashPrefix,
  packToFields,
} from "../provable/account.js";
import { readLedger } from "../read-ledger.js";
import {
  MerkleTree256InMemoryService,
  PrefixedMerkleTree36InMemoryService,
  PrefixedMerkleTree36Service,
} from "./merkle-tree-service.js";
import { VotingAccountInMemoryService } from "./voting-account-service.js";
import {
  ACCOUNT_BATCH_SIZE,
  StakingLedgerToVotingLedger,
  stakingLedgerToVotingLedgerContext,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
} from "../provable/staking-ledger-to-voting-ledger.js";
import { Bool, Proof, Provable, UInt32, UInt64 } from "o1js";
import {
  StakingLedgerToVotingLedgerDigestTrace,
  StakingLedgerToVotingLedgerDigestTracer,
} from "../proving/tracing/staking-ledger-to-voting-ledger-digest-tracer.js";
import {
  StakingLedgerToVotingLedgerDigestTask,
  StakingLedgerToVotingLedgerDigestTaskInput,
} from "../proving/tasks/staking-ledger-to-voting-ledger-digest-task.js";
import { TaskQueue } from "src/proving/task-queue.js";
import { StakingLedgerToVotingLedgerMergeTask } from "../proving/tasks/staking-ledger-to-voting-ledger-merge-task.js";

export type StakingLedgerToVotingLedgerTaskQueue = TaskQueue<{
  stakingLedgerToVotingLedgerDigest: typeof StakingLedgerToVotingLedgerDigestTask;
  stakingLedgerToVotingLedgerMerge: typeof StakingLedgerToVotingLedgerMergeTask;
}>;
export class StakingLedgerToVotingLedgerService {
  public constructor(public queue: StakingLedgerToVotingLedgerTaskQueue) {}

  public async readLedger(path: string): Promise<Account[]> {
    return readLedger(path);
  }

  public async traceLedger(
    stakingLedgerPath: string,
    tracesPath: string,
    options: { fromIndex?: number; toIndex?: number; forceTrace?: boolean } = {
      forceTrace: false,
    }
  ): Promise<StakingLedgerToVotingLedgerDigestTrace[]> {
    let accounts = await this.readLedger(stakingLedgerPath);

    // mostly for testing or partially processing a large ledger
    if (options.fromIndex !== undefined && options.toIndex !== undefined) {
      accounts = accounts.slice(options.fromIndex, options.toIndex);
    }

    let traces: StakingLedgerToVotingLedgerDigestTrace[] = [];
    if (!options.forceTrace) {
      try {
        traces =
          await StakingLedgerToVotingLedgerDigestTracer.fromFile(tracesPath);
      } catch (error) {
        console.error("error reading traces from file", tracesPath, error);
      }
    }

    const lastTraceToIndex =
      (traces[traces.length - 1]?.publicInput.index.toBigint() ?? BigInt(0)) +
      BigInt(ACCOUNT_BATCH_SIZE);

    if (
      traces.length === 0 ||
      lastTraceToIndex !== BigInt(options.toIndex ?? 0)
    ) {
      console.log(
        `no traces found for indexes ${options.fromIndex} - ${options.toIndex}, tracing ${accounts.length} accounts, highest index previously traeced: ${lastTraceToIndex}`
      );
      traces = await this.trace(accounts);
      await StakingLedgerToVotingLedgerDigestTracer.toFile(tracesPath, traces);
    } else {
      console.log("traces found, using existing traces");
    }

    return traces;
  }

  public async digestLedger(
    stakingLedgerPath: string,
    tracesPath: string,
    options: { forceTrace?: boolean; fromIndex?: number; toIndex?: number } = {
      forceTrace: false,
    }
  ): Promise<
    Proof<
      StakingLedgerToVotingLedgerProgramInput,
      StakingLedgerToVotingLedgerProgramOutput
    >
  > {
    console.log("tracing ledger");
    const traces = await this.traceLedger(
      stakingLedgerPath,
      tracesPath,
      options
    );
    console.log("digesting traces", traces.length);
    // this only awaits the creation of digest tasks, not the completion, as intended
    // TODO: do all of digest & merge in paralel, since we know the total number of proofs is traces + traces - 1
    const digestProofs = await this.digest(traces);
    return await this.merge(digestProofs);
  }

  public async trace(accounts: Account[]) {
    const missingAccounts =
      ACCOUNT_BATCH_SIZE - (accounts.length % ACCOUNT_BATCH_SIZE);

    if (missingAccounts < ACCOUNT_BATCH_SIZE) {
      console.log(
        `adding ${missingAccounts} extra empty accounts to satisfy batch size`
      );
      for (let i = 0; i < missingAccounts; i++) {
        accounts.push(Account.empty());
      }
    }

    const traces =
      await StakingLedgerToVotingLedgerDigestTracer.trace(accounts);

    console.log("traces", traces.length);
    return traces;
  }

  public async findMergeableProofs(
    proofs: Proof<
      StakingLedgerToVotingLedgerProgramInput,
      StakingLedgerToVotingLedgerProgramOutput
    >[]
  ) {
    // if there are not at least 2 proofs, there is nothing to merge
    if (proofs.length < 2) {
      return { proof1: undefined, proof2: undefined, remainingProofs: proofs };
    }

    // sort proofs by index, so that we can find the first proof that should be merged
    proofs = proofs.sort(
      (a, b) =>
        Number(a.publicInput.index.toBigint()) -
        Number(b.publicInput.index.toBigint())
    );

    const proof1 = proofs[0];
    const proof1OutputIndex = proof1.publicOutput.index.toBigint();
    // TODO: find should return optionally undefined, this is not typed properly
    // find the next proof that can be merged with the first proof
    const proof2 = proofs.find((proof) => {
      console.log("finding", proof.publicInput);
      const proof2InputIndex = proof.publicInput.index.toBigint();
      return proof2InputIndex === proof1OutputIndex + 1n;
    });

    // if we found a pair, remove it from the list of pending proofs
    if (proof1 && proof2) {
      proofs.splice(proofs.indexOf(proof1), 1);
      proofs.splice(proofs.indexOf(proof2), 1);
    }

    return { proof1, proof2, remainingProofs: proofs };
  }

  public async merge(
    proofs: Proof<
      StakingLedgerToVotingLedgerProgramInput,
      StakingLedgerToVotingLedgerProgramOutput
    >[]
  ) {
    let mergesPending = proofs.length - 1;

    const merge = async () => {
      let { proof1, proof2, remainingProofs } =
        await this.findMergeableProofs(proofs);

      proofs = remainingProofs;

      if (!proof1 || !proof2) {
        return;
      }

      await this.queue.addTask("stakingLedgerToVotingLedgerMerge", {
        proofs: { 1: proof1, 2: proof2 },
      });

      mergesPending--;

      if (mergesPending) {
        await merge();
      }
    };

    return new Promise<
      Proof<
        StakingLedgerToVotingLedgerProgramInput,
        StakingLedgerToVotingLedgerProgramOutput
      >
    >(async (resolve) => {
      this.queue.onTaskComplete(
        "stakingLedgerToVotingLedgerMerge",
        async (task, { proof }) => {
          if (mergesPending) {
            proofs.push(proof);
            await merge();
          } else {
            console.log(
              "all merges complete, resolving with final proof",
              proof
            );
            resolve(proof);
          }
        }
      );

      await merge();
    });
  }

  public async digest(traces: StakingLedgerToVotingLedgerDigestTrace[]) {
    console.time("digest");

    const proofs: Proof<
      StakingLedgerToVotingLedgerProgramInput,
      StakingLedgerToVotingLedgerProgramOutput
    >[] = [];

    this.queue.onTaskComplete(
      "stakingLedgerToVotingLedgerDigest",
      async (task, { proof }) => {
        console.log(
          "task completed",
          task.id,
          "index range:",
          proof.publicInput.index.toBigint(),
          "-",
          proof.publicOutput.index.add(1).toBigint()
        );
        proofs.push(proof);
      }
    );

    for (const trace of traces) {
      await this.queue.addTask("stakingLedgerToVotingLedgerDigest", trace);
    }

    // TODO: is queue.waitUntilEmpty() enough?
    while (proofs.length < traces.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await this.queue.waitUntilEmpty();

    return proofs;
  }
}
