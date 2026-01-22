import { SideLoadedVoteReducerProof } from "../../provable/contracts/treasury-proposal/vote-reducer.js";
import { RedisKeyValueStorage } from "./redis-key-value-storage.js";
import { VoteReducerProofStorage } from "../vote-reducer-proof-storage.js";

export class RedisVoteReducerProofStorage implements VoteReducerProofStorage {
  public storage: RedisKeyValueStorage;
  public mergedStorage: RedisKeyValueStorage;
  public mergeStorage: RedisKeyValueStorage;

  constructor(redisUrl: string, namespace: string) {
    this.storage = new RedisKeyValueStorage(redisUrl, namespace + "");
    this.mergedStorage = new RedisKeyValueStorage(
      redisUrl,
      namespace + "-merged"
    );
    this.mergeStorage = new RedisKeyValueStorage(
      redisUrl,
      namespace + "-merge"
    );
  }

  async getProof(
    id: string
  ): Promise<SideLoadedVoteReducerProof | undefined> {
    const proof = await this.storage.get(id);
    return proof
      ? SideLoadedVoteReducerProof.fromJSON(JSON.parse(proof))
      : undefined;
  }

  async setProof(id: string, proof: SideLoadedVoteReducerProof): Promise<void> {
    await this.storage.set(id, JSON.stringify(proof.toJSON()));
  }

  async getMergeProof(
    id: string
  ): Promise<SideLoadedVoteReducerProof | undefined> {
    const proof = await this.mergeStorage.get(id);
    return proof
      ? SideLoadedVoteReducerProof.fromJSON(JSON.parse(proof))
      : undefined;
  }

  async setMergeProof(
    id: string,
    proof: SideLoadedVoteReducerProof
  ): Promise<void> {
    await this.mergeStorage.set(id, JSON.stringify(proof.toJSON()));
  }

  async markAsMerged(id: string): Promise<void> {
    await this.mergedStorage.set(id, "true");
  }

  async isMerged(id: string): Promise<boolean> {
    const merged = await this.mergedStorage.get(id);
    return merged === "true";
  }

  async mergeCount(): Promise<number> {
    try {
      await this.mergeStorage.redis.connect();
    } catch (error) {}
    return await this.mergeStorage.count();
  }

  async count(): Promise<number> {
    try {
      await this.storage.redis.connect();
    } catch (error) {}
    return await this.storage.count();
  }

  async close(): Promise<void> {
    await this.storage.close();
    await this.mergeStorage.close();
    await this.mergedStorage.close();
  }
}
