import type {
  StakingLedgerToVotingLedgerDigestTrace,
} from "../proving/tracing/staking-ledger-to-voting-ledger-tracer.js";
import type { RedisOptions } from "bullmq";
import type {
  SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
} from "../provable/staking-ledger-to-voting-ledger.js";
import type { Proof } from "o1js";

export interface CompileStakingLedgerToVotingLedgerOptions {
  proofsEnabled?: boolean;
}

export interface StakingLedgerToVotingLedgerServiceOptions {
  lifecycleId: string;
  redisConnection?: RedisOptions;
  queueName?: string;
}

export interface StakingLedgerToVotingLedgerService {
  start(): Promise<void>;
  compile(
    options?: CompileStakingLedgerToVotingLedgerOptions,
  ): Promise<void>;
  traceDigest(
    startIndex?: number,
    endIndex?: number,
    onTraceComplete?: (
      index: number,
      trace: StakingLedgerToVotingLedgerDigestTrace,
      publicOutput: StakingLedgerToVotingLedgerProgramOutput,
    ) => void,
  ): Promise<void>;
  proveDigest(
    startIndex?: number,
    endIndex?: number,
    onDigestComplete?: (
      index: number,
      proof: Proof<
        StakingLedgerToVotingLedgerProgramInput,
        StakingLedgerToVotingLedgerProgramOutput
      >,
    ) => void,
  ): Promise<void>;
  proveMerge(
    onMergeComplete?: (
      index: number,
      proof: SideLoadedStakingLedgerToVotingLedgerProof,
    ) => void,
  ): Promise<SideLoadedStakingLedgerToVotingLedgerProof>;
  proveExhaust(): Promise<SideLoadedStakingLedgerToVotingLedgerProof>;
}
