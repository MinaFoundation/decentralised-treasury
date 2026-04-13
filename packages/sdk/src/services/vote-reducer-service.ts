import type { RedisOptions } from "bullmq";
import type { Proof } from "o1js";
import type {
  SideLoadedVoteReducerProof,
  VoteAction,
  VoteReducerPublicInput,
  VoteReducerPublicOutput,
} from "../provable/contracts/treasury-proposal/vote-reducer.js";
import type { VoteReducerRunBatchTrace } from "../proving/tracing/vote-reducer-tracer.js";
import type {
  FetchProposalActionsResult,
  VoteReducerActionStateHistoryTargetSnapshot,
} from "./vote-reducer-types.js";

export interface CompileVoteReducerOptions {
  proofsEnabled?: boolean;
}

export interface VoteReducerServiceOptions {
  lifecycleId: string;
  redisConnection?: RedisOptions;
  queueName?: string;
  archiveNodeUrl?: string;
  proposalPublicKey?: string;
  proposalTokenId?: string;
  actionStateHistoryTarget?: VoteReducerActionStateHistoryTargetSnapshot;
}

export interface VoteReducerService {
  start(): Promise<void>;
  getVoteWeight(voterPublicKey: string): Promise<bigint>;
  clearPersistentState(): Promise<void>;
  compile(options?: CompileVoteReducerOptions): Promise<void>;
  fetchProposalActions(): Promise<FetchProposalActionsResult>;
  traceRunBatch(
    voteActions: VoteAction[],
    onTraceComplete?: (index: number, trace: VoteReducerRunBatchTrace) => void,
  ): Promise<void>;
  proveRunBatch(
    startIndex?: number,
    endIndex?: number,
    onRunBatchComplete?: (
      index: number,
      proof: Proof<VoteReducerPublicInput, VoteReducerPublicOutput>,
    ) => void,
  ): Promise<void>;
  proveMerge(
    onMergeComplete?: (index: number, proof: SideLoadedVoteReducerProof) => void,
  ): Promise<SideLoadedVoteReducerProof>;
}
