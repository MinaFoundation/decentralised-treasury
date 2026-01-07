import { RedisStakingLedgerToVotingLedgerDigestTraceStorage } from "../../storage/redis/redis-staking-ledger-to-voting-ledger-digest-trace-storage.js";
import { StakingLedgerToVotingLedgerTracer } from "./staking-ledger-to-voting-ledger-tracer.js";
import { StakingLedger } from "../../ledgers/staking-ledger/staking-ledger.js";
import { VotingLedger } from "../../ledgers/voting-ledger/voting-ledger.js";

export class RedisStakingLedgerToVotingLedgerTracer extends StakingLedgerToVotingLedgerTracer {
  constructor(
    public stakingLedger: StakingLedger,
    public votingLedger: VotingLedger,
    public redisUrl: string,
    public lifecycleId: string
  ) {
    const traceStorage = new RedisStakingLedgerToVotingLedgerDigestTraceStorage(
      redisUrl,
      lifecycleId
    );
    super(stakingLedger, votingLedger, traceStorage);
  }
}
