export interface KeyValueBatchStorage {
  setMany(entries: Array<{ key: string; value: string }>): Promise<void>;
  close(): Promise<void>;
}
