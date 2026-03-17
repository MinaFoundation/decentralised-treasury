export type KeyValueEntry = {
  key: string;
  value: string;
};

export interface KeyValueStorage {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  setMany(entries: KeyValueEntry[]): Promise<void>;
  clear(): Promise<void>;
  close(): Promise<void>;
  count(): Promise<number>;
}
