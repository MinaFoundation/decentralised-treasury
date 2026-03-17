import { KeyValueEntry } from "./key-value-storage.js";

export interface BatchStorage {
  collectEntries(): Array<KeyValueEntry>;
  clearEntries(): void;
}
