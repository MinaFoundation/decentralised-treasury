import { Field } from "o1js";
import type { Account } from "../provable/account.js";
import type { PrefixedMerkleWitness36 } from "../provable/merkle-tree/prefixed-merkle-tree.js";

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
  getAllAccounts(): Promise<Account[]>;
  getAccount(index: bigint): Promise<Account>;
  getAccountByPublicKey(
    publicKey: string,
  ): Promise<{ index: bigint; account: Account } | null>;
  getWitness(index: bigint): Promise<PrefixedMerkleWitness36>;
  getRootHash(): Promise<Field>;
  close(): Promise<void>;
}
