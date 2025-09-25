export interface VoteNullifierService {
  nullify: (publicKey: string) => Promise<void>;
  getNullifier: (publicKey: string) => Promise<boolean>;
}

export class VoteNullifierInMemoryService implements VoteNullifierService {
  public nullifiers: Record<string, boolean> = {};

  public async nullify(publicKey: string): Promise<void> {
    this.nullifiers[publicKey] = true;
  }

  public async getNullifier(publicKey: string): Promise<boolean> {
    return this.nullifiers[publicKey] ?? false;
  }
}
