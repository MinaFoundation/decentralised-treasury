import { RedisVoteNullifierStorage } from "../../storage/redis/redis-vote-nullifier-storage.js";
import { RedisMerkleTreeStorage } from "../../storage/redis/redis-merkle-tree-storage.js";
import { BaseNullifierLedger, NullifierLedger } from "./nullifier-ledger.js";

export class RedisNullifierLedger
  extends BaseNullifierLedger
  implements NullifierLedger
{
  public nullifierStorage: RedisVoteNullifierStorage;
  public merkleTreeStorage: RedisMerkleTreeStorage;

  public constructor(
    public redisUrl: string,
    public lifecycleId: string
  ) {
    const namespace = `nullifier-ledger-${lifecycleId}`;

    const nullifierStorage = new RedisVoteNullifierStorage(
      redisUrl,
      `${namespace}-nullifiers`
    );
    const merkleTreeStorage = new RedisMerkleTreeStorage(
      redisUrl,
      `${namespace}-merkle-tree`
    );
    super(nullifierStorage, merkleTreeStorage);
  }
}
