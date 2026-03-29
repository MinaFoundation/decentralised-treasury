import { VoteReducerRunBatchTrace } from "../proving/tracing/vote-reducer-tracer.js";
import { BatchStorage } from "./batch-storage.js";

export interface VoteReducerRunBatchTraceStorage extends BatchStorage {
  getTrace(index: number): Promise<VoteReducerRunBatchTrace | undefined>;
  setTrace(index: number, trace: VoteReducerRunBatchTrace): Promise<void>;
  getAllTraces(): Promise<VoteReducerRunBatchTrace[]>;
  clear(): Promise<void>;
  close(): Promise<void>;
}
