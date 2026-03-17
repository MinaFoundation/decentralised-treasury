export interface VoteNullifierStorage {
  namespace: string;
  getNullifier(publicKey: string): Promise<boolean | undefined>;
  setNullifier(publicKey: string, nullifier: boolean): Promise<void>;
  close(): Promise<void>;
}
