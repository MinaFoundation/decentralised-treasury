import {
  VoteReducer,
  voteReducerContext,
  VoteReducerPublicInput,
  VoteReducerPublicOutput,
} from "../../provable/contracts/treasury-proposal/vote-reducer.js";
import { Task } from "../task-queue.js";
import { Cache, JsonProof, Proof, Provable } from "o1js";
import { VoteReducerRunBatchTrace } from "../tracing/vote-reducer-tracer.js";
import { readdirSync } from "node:fs";
import { ReplayableVotingLedger } from "../../ledgers/voting-ledger/replayable-voting-ledger.js";
import { ReplayableNullifierLedger } from "../../ledgers/nullifier-ledger/replayable-nullifier-ledger.js";

export interface VoteReducerRunBatchTaskInput {
  trace: VoteReducerRunBatchTrace;
  traceId: number;
}

export interface VoteReducerRunBatchTaskOutput {
  proof: Proof<VoteReducerPublicInput, VoteReducerPublicOutput>;
  traceId: number;
}

const proofsEnabled = process.env.PROOFS_ENABLED === "true";

export const VoteReducerRunBatchTask: Task<
  VoteReducerRunBatchTaskInput,
  VoteReducerRunBatchTaskOutput
> = class {
  public static taskName = "vote-reducer-run-batch";

  public static async prepare() {
    console.log("compiling vote reducer", { proofsEnabled });

    voteReducerContext.set({
      votingLedger: new ReplayableVotingLedger({}, {}),
      nullifierLedger: new ReplayableNullifierLedger({}, {}),
    });

    const files = readdirSync(`${process.cwd()}/cache`);
    console.log("cache files", `${process.cwd()}/cache`, files);

    console.time("compile");
    await VoteReducer.compile({
      proofsEnabled,
      cache: Cache.FileSystem(`${process.cwd()}/cache`),
    });
    console.timeEnd("compile");
  }

  public static serializers = {
    input: async (input: VoteReducerRunBatchTaskInput) => {
      return JSON.stringify({
        trace: VoteReducerRunBatchTrace.toJSON(input.trace),
        traceId: input.traceId,
      });
    },
    output: async (output: VoteReducerRunBatchTaskOutput) => {
      return JSON.stringify({
        proof: output.proof.toJSON(),
        traceId: output.traceId,
      });
    },
  };

  public static deserializers = {
    input: async (input: string) => {
      const { trace, traceId } = JSON.parse(input) as {
        trace: any;
        traceId: number;
      };
      return {
        trace: VoteReducerRunBatchTrace.fromJSON(trace),
        traceId,
      };
    },
    output: async (output: string) => {
      const { proof, traceId } = JSON.parse(output) as {
        proof: JsonProof;
        traceId: number;
      };
      return {
        proof: await VoteReducer.Proof.fromJSON(proof),
        traceId,
      };
    },
  };

  public static async run(input: VoteReducerRunBatchTaskInput) {
    const {
      trace: {
        publicInput,
        privateInput: { voteActions },
        votingLedgerWitnesses,
        votingAccounts,
        nullifierLedgerWitnesses,
        nullifiers,
      },
      traceId,
    } = input;

    Provable.log("running vote reducer task with input", input);

    const votingLedger = new ReplayableVotingLedger(
      votingLedgerWitnesses,
      votingAccounts
    );
    const nullifierLedger = new ReplayableNullifierLedger(
      nullifierLedgerWitnesses,
      nullifiers
    );

    voteReducerContext.set({
      votingLedger,
      nullifierLedger,
    });

    console.time("reduceBatch");
    const result = await VoteReducer.reduceBatch(publicInput, voteActions);
    console.timeEnd("reduceBatch");

    return {
      proof: result.proof,
      traceId,
    };
  }
};
