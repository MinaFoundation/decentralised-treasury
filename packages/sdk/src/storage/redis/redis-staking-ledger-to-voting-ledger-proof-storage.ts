import { SideLoadedStakingLedgerToVotingLedgerProof } from "../../provable/staking-ledger-to-voting-ledger.js";
import { StakingLedgerToVotingLedgerProofStorage } from "../staking-ledger-to-voting-ledger-proof-storage.js";
import { RedisKeyValueStorage } from "./redis-key-value-storage.js";

export class RedisStakingLedgerToVotingLedgerProofStorage
  extends RedisKeyValueStorage
  implements StakingLedgerToVotingLedgerProofStorage
{
  async getProof(
    id: string
  ): Promise<SideLoadedStakingLedgerToVotingLedgerProof | undefined> {
    const proof = await this.get(id);
    return proof
      ? SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(JSON.parse(proof))
      : undefined;
  }

  async setProof(
    id: string,
    proof: SideLoadedStakingLedgerToVotingLedgerProof
  ): Promise<void> {
    await this.set(id, JSON.stringify(proof.toJSON()));
  }

  async close(): Promise<void> {
    await super.close();
  }
}
