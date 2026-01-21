import { PublicKey } from "o1js";
import { Account } from "../provable/account.js";
import { KeyValueStorage } from "./key-value-storage.js";

export interface AccountStorage extends KeyValueStorage {
  getAllAccounts(): Promise<Account[]>;
  getAccount(index: bigint): Promise<Account | undefined>;
  setAccount(index: bigint, account: Account): Promise<void>;
  close(): Promise<void>;
}
