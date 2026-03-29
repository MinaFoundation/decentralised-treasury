import { VoteReducerRunBatchTrace } from "../../proving/tracing/vote-reducer-tracer.js";
import { KeyValueEntry } from "../key-value-storage.js";
import { VoteReducerRunBatchTraceStorage } from "../vote-reducer-run-batch-trace-storage.js";
import {
  KeyvKeyValueStorage,
  type KeyvNamespaceCounter,
} from "./keyv-key-value-storage.js";
import { Keyv } from "keyv";

export class KeyvVoteReducerRunBatchTraceStorage
  extends KeyvKeyValueStorage
  implements VoteReducerRunBatchTraceStorage
{
  public entries: Array<KeyValueEntry> = [];

  static namespaceFrom(lifecycleId: string): string {
    return `vote-reducer-run-batch-trace-${lifecycleId}`;
  }

  constructor(keyv: Keyv, lifecycleId: string, counter: KeyvNamespaceCounter) {
    super(
      keyv,
      KeyvVoteReducerRunBatchTraceStorage.namespaceFrom(lifecycleId),
      counter,
    );
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
    trace: VoteReducerRunBatchTrace,
  ): Promise<void> {
    this.entries.push({
      key: `${this.namespace}:${index}`,
      value: JSON.stringify(VoteReducerRunBatchTrace.toJSON(trace)),
    });
  }

  collectEntries(): Array<KeyValueEntry> {
    return this.entries;
  }

  clearEntries(): void {
    this.entries = [];
  }

  async clear(): Promise<void> {
    this.entries = [];
    await super.clear();
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
