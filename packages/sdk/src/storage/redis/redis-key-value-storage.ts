import { Keyv } from "keyv";
import { createKeyv } from "@keyv/redis";
import { KeyValueStorage } from "../key-value-storage.js";

export class RedisKeyValueStorage implements KeyValueStorage {
  public readonly keyv: Keyv;

  constructor(redisUrl: string, namespace?: string) {
    this.keyv = createKeyv(redisUrl, { namespace });
    this.keyv.on("error", (error) => {
      throw error;
    });
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
