import {
  SideLoadedVoteReducerProof,
  VoteReducer,
  voteReducerContext,
} from "../../provable/contracts/treasury-proposal/vote-reducer.js";
import { Task } from "../task-queue.js";
import { Cache, JsonProof } from "o1js";
import { ReplayableVotingLedger } from "../../ledgers/voting-ledger/replayable-voting-ledger.js";
import { ReplayableNullifierLedger } from "../../ledgers/nullifier-ledger/replayable-nullifier-ledger.js";
import { logger, provableLog, time, timeEnd } from "../../logging/logger.js";

export interface VoteReducerMergeTaskInput {
  proofs: {
    1: SideLoadedVoteReducerProof;
    2: SideLoadedVoteReducerProof;
  };
}

export interface VoteReducerMergeTaskOutput {
  proof: SideLoadedVoteReducerProof;
}

const proofsEnabled = process.env.PROOFS_ENABLED === "true";

export const VoteReducerMergeTask: Task<
  VoteReducerMergeTaskInput,
  VoteReducerMergeTaskOutput
> = class {
  public static taskName = "vote-reducer-merge";

  public static serializers = {
    input: async (input: VoteReducerMergeTaskInput) =>
      JSON.stringify({
        proofs: {
          1: input.proofs[1].toJSON(),
          2: input.proofs[2].toJSON(),
        },
      }),
    output: async (output: VoteReducerMergeTaskOutput) =>
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
          1: await SideLoadedVoteReducerProof.fromJSON(proofs[1]),
          2: await SideLoadedVoteReducerProof.fromJSON(proofs[2]),
        },
      };
    },
    output: async (output: string) => {
      const { proof } = JSON.parse(output) as { proof: JsonProof };
      return {
        proof: await SideLoadedVoteReducerProof.fromJSON(proof),
      };
    },
  };

  public static async prepare() {
    logger.info("compiling vote reducer", { proofsEnabled });

    voteReducerContext.set({
      votingLedger: new ReplayableVotingLedger({}, {}),
      nullifierLedger: new ReplayableNullifierLedger({}, {}),
    });

    time("compile", "info");
    await VoteReducer.compile({
      proofsEnabled,
      cache: Cache.FileSystem(`${process.cwd()}/cache`),
    });
    timeEnd("compile", "info");
  }

  public static async run(input: VoteReducerMergeTaskInput) {
    const {
      proofs: { 1: proof1, 2: proof2 },
    } = input;
    logger.info("running vote reducer merge");
    provableLog(
      "merging vote reducer proofs",
      proof1?.publicInput,
      proof1?.publicOutput,
      proof2?.publicInput,
      proof2?.publicOutput
    );

    time("merge", "info");
    const result = await VoteReducer.merge(
      proof1.publicInput,
      proof1,
      proof2
    );
    timeEnd("merge", "info");

    return {
      proof: SideLoadedVoteReducerProof.fromProof(result.proof),
    };
  }
};
