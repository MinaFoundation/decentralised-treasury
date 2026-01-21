import {
  SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedger,
  stakingLedgerToVotingLedgerContext,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
} from "../../provable/staking-ledger-to-voting-ledger.js";
import { Task } from "../task-queue.js";
import { Cache, JsonProof, Proof, Provable } from "o1js";
import { ReplayableStakingLedger } from "../../ledgers/staking-ledger/replayable-staking-ledger.js";
import { ReplayableVotingLedger } from "../../ledgers/voting-ledger/replayable-voting-ledger.js";

export interface StakingLedgerToVotingLedgerMergeTaskInput {
  proofs: {
    1: SideLoadedStakingLedgerToVotingLedgerProof;
    2: SideLoadedStakingLedgerToVotingLedgerProof;
  };
}

export interface StakingLedgerToVotingLedgerMergeTaskOutput {
  proof: SideLoadedStakingLedgerToVotingLedgerProof;
}

const proofsEnabled = process.env.PROOFS_ENABLED === "true";

export const StakingLedgerToVotingLedgerMergeTask: Task<
  StakingLedgerToVotingLedgerMergeTaskInput,
  StakingLedgerToVotingLedgerMergeTaskOutput
> = class {
  public static taskName = "staking-ledger-to-voting-ledger-merge";

  public static serializers = {
    input: async (input: StakingLedgerToVotingLedgerMergeTaskInput) =>
      JSON.stringify({
        proofs: {
          1: input.proofs[1].toJSON(),
          2: input.proofs[2].toJSON(),
        },
      }),
    output: async (output: StakingLedgerToVotingLedgerMergeTaskOutput) =>
      JSON.stringify({
        proof: output.proof.toJSON(),
      }),
  };

  public static deserializers = {
    input: async (input: string) => {
      const { proofs } = JSON.parse(input) as {
        proofs: {
          1: JsonProof;
          2: JsonProof;
        };
      };
      return {
        proofs: {
          1: await SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(
            proofs[1]
          ),
          2: await SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(
            proofs[2]
          ),
        },
      };
    },
    output: async (output: string) => {
      const { proof } = JSON.parse(output) as {
        proof: JsonProof;
      };
      return {
        proof: await SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(proof),
      };
    },
  };

  public static async prepare() {
    console.log("compiling staking ledger to voting ledger", {
      proofsEnabled,
    });

    stakingLedgerToVotingLedgerContext.set({
      stakingLedger: new ReplayableStakingLedger({}),
      votingLedger: new ReplayableVotingLedger({}, {}),
    });

    console.time("compile");
    await StakingLedgerToVotingLedger.compile({
      proofsEnabled,
      cache: Cache.FileSystem(`${process.cwd()}/cache`),
    });
    console.timeEnd("compile");
  }

  public static async run(input: StakingLedgerToVotingLedgerMergeTaskInput) {
    const {
      proofs: { 1: proof1, 2: proof2 },
    } = input;
    console.log("running staking ledger to voting ledger merge");
    Provable.log(
      "merging proofs in task",
      proof1?.publicInput,
      proof1?.publicOutput,
      proof2?.publicInput,
      proof2?.publicOutput
    );

    console.time("merge");
    const result = await StakingLedgerToVotingLedger.merge(
      proof1.publicInput,
      proof1,
      proof2
    );
    console.timeEnd("merge");

    return {
      proof: SideLoadedStakingLedgerToVotingLedgerProof.fromProof(result.proof),
    };
  }
};
