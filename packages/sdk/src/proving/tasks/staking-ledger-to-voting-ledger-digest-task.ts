import {
  StakingLedgerToVotingLedger,
  stakingLedgerToVotingLedgerContext,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
} from "../../provable/staking-ledger-to-voting-ledger.js";
import { Task } from "../task-queue.js";
import { Proof, Cache, JsonProof } from "o1js";
import { logger, provableLog, time, timeEnd } from "../../logging/logger.js";

import { StakingLedgerToVotingLedgerDigestTrace } from "../tracing/staking-ledger-to-voting-ledger-tracer.js";
import { readdirSync } from "node:fs";
import { ReplayableStakingLedger } from "../../ledgers/staking-ledger/replayable-staking-ledger.js";
import { ReplayableVotingLedger } from "../../ledgers/voting-ledger/replayable-voting-ledger.js";

export interface StakingLedgerToVotingLedgerDigestTaskInput {
  trace: StakingLedgerToVotingLedgerDigestTrace;
  traceId: number;
}

export interface StakingLedgerToVotingLedgerDigestTaskOutput {
  proof: Proof<
    StakingLedgerToVotingLedgerProgramInput,
    StakingLedgerToVotingLedgerProgramOutput
  >;
  traceId: number;
}

const proofsEnabled = process.env.PROOFS_ENABLED === "true";

export const StakingLedgerToVotingLedgerDigestTask: Task<
  StakingLedgerToVotingLedgerDigestTaskInput,
  StakingLedgerToVotingLedgerDigestTaskOutput
> = class {
  public static taskName = "staking-ledger-to-voting-ledger-digest";

  public static async prepare() {
    logger.info("compiling staking ledger to voting ledger", {
      proofsEnabled,
    });

    stakingLedgerToVotingLedgerContext.set({
      stakingLedger: new ReplayableStakingLedger({}),
      votingLedger: new ReplayableVotingLedger({}, {}),
    });

    time("compile", "info");
    await StakingLedgerToVotingLedger.compile({
      proofsEnabled,
      cache: Cache.FileSystem(`${process.cwd()}/cache`),
    });
    timeEnd("compile", "info");
  }

  public static serializers = {
    input: async (input: StakingLedgerToVotingLedgerDigestTaskInput) => {
      return JSON.stringify({
        trace: StakingLedgerToVotingLedgerDigestTrace.toJSON(input.trace),
        traceId: input.traceId,
      });
    },
    output: async (output: StakingLedgerToVotingLedgerDigestTaskOutput) => {
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
        trace: StakingLedgerToVotingLedgerDigestTrace.fromJSON(trace),
        traceId: traceId,
      };
    },
    output: async (output: string) => {
      const { proof, traceId } = JSON.parse(output) as {
        proof: JsonProof;
        traceId: number;
      };
      return {
        proof: await StakingLedgerToVotingLedger.Proof.fromJSON(proof),
        traceId: traceId,
      };
    },
  };

  public static async run(input: StakingLedgerToVotingLedgerDigestTaskInput) {
    const {
      trace: {
        publicInput,
        privateInput: { accounts },
        stakingLedgerWitnesses,
        votingAccounts,
        votingLedgerWitnesses,
      },
      traceId,
    } = input;

    provableLog("running task with input", input);

    const stakingLedger = new ReplayableStakingLedger(stakingLedgerWitnesses);
    const votingLedger = new ReplayableVotingLedger(
      votingLedgerWitnesses,
      votingAccounts,
    );

    stakingLedgerToVotingLedgerContext.set({
      stakingLedger,
      votingLedger,
    });

    let result: Awaited<ReturnType<typeof StakingLedgerToVotingLedger.digest>>;
    time("digest", "info");
    result = await StakingLedgerToVotingLedger.digest(publicInput, accounts);
    timeEnd("digest", "info");

    return {
      proof: result.proof,
      traceId,
    };
  }
};
