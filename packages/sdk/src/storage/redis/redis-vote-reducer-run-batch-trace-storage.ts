import { VoteReducerRunBatchTrace } from "../../proving/tracing/vote-reducer-tracer.js";
import { VoteReducerRunBatchTraceStorage } from "../vote-reducer-run-batch-trace-storage.js";
import { RedisKeyValueStorage } from "./redis-key-value-storage.js";

export class RedisVoteReducerRunBatchTraceStorage
  extends RedisKeyValueStorage
  implements VoteReducerRunBatchTraceStorage
{
  constructor(redisUrl: string, namespace: string) {
    super(redisUrl, namespace + "-vote-reducer-traces");
  }

  async getTrace(index: number): Promise<VoteReducerRunBatchTrace | undefined> {
    const traceJson = await this.get(index.toString());
    const trace = traceJson
      ? VoteReducerRunBatchTrace.fromJSON(JSON.parse(traceJson))
      : undefined;
    return trace;
  }

  async setTrace(
    index: number,
    trace: VoteReducerRunBatchTrace
  ): Promise<void> {
    await this.set(
      index.toString(),
      JSON.stringify(VoteReducerRunBatchTrace.toJSON(trace))
    );
  }

  async getAllTraces(): Promise<VoteReducerRunBatchTrace[]> {
    const traces: VoteReducerRunBatchTrace[] = [];
    let index = 0;
    let trace: VoteReducerRunBatchTrace | undefined;
    while (trace || index === 0) {
      trace = await this.getTrace(index);
      trace && traces.push(trace);
      index++;
    }

    return traces;
  }
}
