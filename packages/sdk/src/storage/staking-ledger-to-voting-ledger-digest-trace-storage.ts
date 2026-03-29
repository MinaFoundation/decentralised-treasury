import { StakingLedgerToVotingLedgerDigestTrace } from "../proving/tracing/staking-ledger-to-voting-ledger-tracer.js";
import { BatchStorage } from "./batch-storage.js";

export interface StakingLedgerToVotingLedgerDigestTraceStorage
  extends BatchStorage {
  getTrace(
    index: number,
  ): Promise<StakingLedgerToVotingLedgerDigestTrace | undefined>;
  setTrace(
    index: number,
    trace: StakingLedgerToVotingLedgerDigestTrace,
  ): Promise<void>;
  getAllTraces(): Promise<StakingLedgerToVotingLedgerDigestTrace[]>;
  count(): Promise<number>;
  close(): Promise<void>;
}
