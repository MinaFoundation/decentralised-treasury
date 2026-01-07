import { StakingLedgerToVotingLedgerDigestTrace } from "../../proving/tracing/staking-ledger-to-voting-ledger-tracer.js";
import { StakingLedgerToVotingLedgerDigestTraceStorage } from "../staking-ledger-to-voting-ledger-digest-trace-storage.js";
import { RedisKeyValueStorage } from "./redis-key-value-storage.js";

export class RedisStakingLedgerToVotingLedgerDigestTraceStorage
  extends RedisKeyValueStorage
  implements StakingLedgerToVotingLedgerDigestTraceStorage
{
  constructor(redisUrl: string, namespace: string) {
    super(redisUrl, namespace + "-traces");
  }

  async getTrace(
    index: number
  ): Promise<StakingLedgerToVotingLedgerDigestTrace | undefined> {
    const trace = await this.get(index.toString());
    return trace
      ? StakingLedgerToVotingLedgerDigestTrace.fromJSON(JSON.parse(trace))
      : undefined;
  }

  async setTrace(
    index: number,
    trace: StakingLedgerToVotingLedgerDigestTrace
  ): Promise<void> {
    await this.set(
      index.toString(),
      JSON.stringify(StakingLedgerToVotingLedgerDigestTrace.toJSON(trace))
    );
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
