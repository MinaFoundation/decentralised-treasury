import { StakingLedgerToVotingLedgerDigestTrace } from "../proving/tracing/staking-ledger-to-voting-ledger-tracer.js";

export interface StakingLedgerToVotingLedgerDigestTraceStorage {
  getTrace(
    index: number
  ): Promise<StakingLedgerToVotingLedgerDigestTrace | undefined>;
  setTrace(
    index: number,
    trace: StakingLedgerToVotingLedgerDigestTrace
  ): Promise<void>;
  getAllTraces(): Promise<StakingLedgerToVotingLedgerDigestTrace[]>;
  close(): Promise<void>;
}
