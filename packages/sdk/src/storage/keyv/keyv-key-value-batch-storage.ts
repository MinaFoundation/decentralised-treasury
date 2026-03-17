import { Keyv } from "keyv";
import { KeyValueBatchStorage } from "../batch-key-value-storage.js";

export class KeyvKeyValueBatchStorage implements KeyValueBatchStorage {
  public constructor(public keyv: Keyv) {}

  public async setMany(
    entries: Array<{ key: string; value: string }>,
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    await this.keyv.setMany(entries);
  }

  public async close(): Promise<void> {
    await this.keyv.disconnect();
  }
}
