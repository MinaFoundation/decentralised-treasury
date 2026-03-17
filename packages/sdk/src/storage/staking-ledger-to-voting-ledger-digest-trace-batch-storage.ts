import { StakingLedgerToVotingLedgerDigestTrace } from "../proving/tracing/staking-ledger-to-voting-ledger-tracer.js";
import { KeyValueEntry, KeyValueStorage } from "./key-value-storage.js";
import { BatchStorage } from "./batch-storage.js";

export interface StakingLedgerToVotingLedgerDigestTraceBatchStorage
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
