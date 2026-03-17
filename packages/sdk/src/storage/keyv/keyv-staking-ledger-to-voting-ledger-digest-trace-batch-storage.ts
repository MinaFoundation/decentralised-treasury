import { StakingLedgerToVotingLedgerDigestTrace } from "../../proving/tracing/staking-ledger-to-voting-ledger-tracer.js";
import { KeyValueEntry } from "../key-value-storage.js";
import { StakingLedgerToVotingLedgerDigestTraceBatchStorage } from "../staking-ledger-to-voting-ledger-digest-trace-batch-storage.js";
import { KeyvCounter, KeyvKeyValueStorage } from "./keyv-key-value-storage.js";
import { Keyv } from "keyv";

export class KeyvStakingLedgerToVotingLedgerDigestTraceBatchStorage
  extends KeyvKeyValueStorage
  implements StakingLedgerToVotingLedgerDigestTraceBatchStorage
{
  public entries: Array<KeyValueEntry> = [];

  constructor(keyv: Keyv, namespace: string, keyvCounter: KeyvCounter) {
    super(keyv, keyvCounter, `${namespace}-traces`);
  }

  async getTrace(
    index: number,
  ): Promise<StakingLedgerToVotingLedgerDigestTrace | undefined> {
    const traceJson = await this.get(index.toString());
    const trace = traceJson
      ? StakingLedgerToVotingLedgerDigestTrace.fromJSON(JSON.parse(traceJson))
      : undefined;
    return trace;
  }

  async setTrace(index: number, trace: StakingLedgerToVotingLedgerDigestTrace) {
    this.entries.push({
      key: `${this.namespace}:${index}`,
      value: JSON.stringify(
        StakingLedgerToVotingLedgerDigestTrace.toJSON(trace),
      ),
    });
  }

  collectEntries(): Array<KeyValueEntry> {
    return this.entries;
  }

  clearEntries(): void {
    this.entries = [];
  }

  async getAllTraces(): Promise<StakingLedgerToVotingLedgerDigestTrace[]> {
    const traces: StakingLedgerToVotingLedgerDigestTrace[] = [];
    let index = 0;
    let trace: StakingLedgerToVotingLedgerDigestTrace | undefined;

    while (trace || index === 0) {
      trace = await this.getTrace(index);
      trace && traces.push(trace);
      index++;
    }

    return traces;
  }
}
