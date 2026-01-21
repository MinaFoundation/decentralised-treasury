import { Keyv } from "keyv";
import { createClient, RedisClientType } from "redis";
import { KeyValueStorage } from "../key-value-storage.js";
import KeyvRedis from "@keyv/redis";

export class RedisKeyValueStorage implements KeyValueStorage {
  public redis: RedisClientType;
  public readonly keyv: Keyv;

  constructor(
    redisUrl: string,
    public namespace?: string
  ) {
    this.redis = createClient({
      url: redisUrl,
    });

    this.keyv = new Keyv({
      // @ts-ignore - KeyvRedis is not typed correctly
      store: new KeyvRedis(this.redis),
      namespace,
    });

    this.keyv.on("error", (error) => {
      throw error;
    });
  }

  public async count(): Promise<number> {
    let cursor = "0";
    let count = 0;
    const pattern = `${this.namespace}:*`;

    console.log("pattern", pattern);

    do {
      const reply = await this.redis.scan(cursor, {
        MATCH: pattern,
        COUNT: 1000, // hint, not a guarantee
      });

      cursor = reply.cursor.toString();
      count += reply.keys.length;
    } while (cursor !== "0");

    return count;
  }

  async get(key: string): Promise<string | undefined> {
    return await this.keyv.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this.keyv.set(key, value);
  }

  async clear(): Promise<void> {
    await this.keyv.clear();
  }

  async close(): Promise<void> {
    await this.keyv.disconnect();
  }
}
