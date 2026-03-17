import { Keyv } from "keyv";
import { KeyValueStorage } from "../key-value-storage.js";

export interface KeyvCounter {
  count(namespace: string): Promise<number>;
}

export class KeyvKeyValueStorage implements KeyValueStorage {
  public readonly namespace: string;

  constructor(
    public keyv: Keyv,
    private readonly keyvCounter: KeyvCounter,
    namespace: string,
  ) {
    this.namespace = namespace;
    this.keyv.namespace = namespace;
    this.keyv.on("error", (error) => {
      throw error;
    });
  }

  public async count(): Promise<number> {
    return await this.keyvCounter.count(this.namespace);
  }

  async get(key: string): Promise<string | undefined> {
    return await this.keyv.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this.keyv.set(key, value);
  }

  async setMany(entries: Array<{ key: string; value: string }>): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    await this.keyv.setMany(entries);
  }

  async clear(): Promise<void> {
    await this.keyv.clear();
  }

  async close(): Promise<void> {
    await this.keyv.disconnect();
  }
}
