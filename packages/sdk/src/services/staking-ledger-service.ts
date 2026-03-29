import { Field } from "o1js";

export interface HydrateAccountsOptions {
  stakingLedgerPath: string;
  startIndex?: number;
  endIndex?: number;
}

export interface HydrateMerkleTreeOptions {
  startIndex?: number;
  endIndex?: number;
}

export interface StakingLedgerService {
  start(): Promise<void>;
  hydrateAccounts(options: HydrateAccountsOptions): Promise<void>;
  hydrateMerkleTree(options?: HydrateMerkleTreeOptions): Promise<void>;
  getRootHash(): Promise<Field>;
  close(): Promise<void>;
}
