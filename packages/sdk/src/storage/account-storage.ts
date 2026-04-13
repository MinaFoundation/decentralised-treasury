import { Account } from "../provable/account.js";
import { KeyValueStorage } from "./key-value-storage.js";

export interface AccountLookupResult {
  index: bigint;
  account: Account;
}

export interface AccountStorage extends KeyValueStorage {
  getAllAccounts(): Promise<Account[]>;
  getAccount(index: bigint): Promise<Account | undefined>;
  getAccountByPublicKey(publicKey: string): Promise<AccountLookupResult | null>;
  setAccount(index: bigint, account: Account): Promise<void>;
  close(): Promise<void>;
}
