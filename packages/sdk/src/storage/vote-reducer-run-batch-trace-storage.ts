import { VoteReducerRunBatchTrace } from "../proving/tracing/vote-reducer-tracer.js";

export interface VoteReducerRunBatchTraceStorage {
  getTrace(index: number): Promise<VoteReducerRunBatchTrace | undefined>;
  setTrace(index: number, trace: VoteReducerRunBatchTrace): Promise<void>;
  getAllTraces(): Promise<VoteReducerRunBatchTrace[]>;
  close(): Promise<void>;
}
