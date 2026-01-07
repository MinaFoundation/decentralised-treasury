import { RedisVotingAccountStorage } from "../../storage/redis/redis-voting-account-storage.js";
import { RedisMerkleTreeStorage } from "../../storage/redis/redis-merkle-tree-storage.js";
import { BaseStakingLedger, StakingLedger } from "./staking-ledger.js";
import { RedisAccountStorage } from "../../storage/redis/redis-account-storage.js";

export class RedisStakingLedger
  extends BaseStakingLedger
  implements StakingLedger
{
  public accountStorage: RedisAccountStorage;
  public merkleTreeStorage: RedisMerkleTreeStorage;

  public constructor(
    public redisUrl: string,
    public lifecycleId: string
  ) {
    const namespace = `staking-ledger-${lifecycleId}`;

    const accountStorage = new RedisAccountStorage(redisUrl, namespace);
    const merkleTreeStorage = new RedisMerkleTreeStorage(redisUrl, namespace);
    super(accountStorage, merkleTreeStorage);
  }
}
