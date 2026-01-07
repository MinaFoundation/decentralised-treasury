import { RedisVotingAccountStorage } from "../../storage/redis/redis-voting-account-storage.js";
import { RedisMerkleTreeStorage } from "../../storage/redis/redis-merkle-tree-storage.js";
import { BaseVotingLedger, VotingLedger } from "./voting-ledger.js";

export class RedisVotingLedger
  extends BaseVotingLedger
  implements VotingLedger
{
  public votingAccountStorage: RedisVotingAccountStorage;
  public merkleTreeStorage: RedisMerkleTreeStorage;

  public constructor(
    public redisUrl: string,
    public lifecycleId: string
  ) {
    const namespace = `voting-ledger-${lifecycleId}`;

    const votingAccountStorage = new RedisVotingAccountStorage(
      redisUrl,
      `${namespace}-voting-accounts`
    );
    const merkleTreeStorage = new RedisMerkleTreeStorage(
      redisUrl,
      `${namespace}-merkle-tree`
    );
    super(votingAccountStorage, merkleTreeStorage);
  }
}
