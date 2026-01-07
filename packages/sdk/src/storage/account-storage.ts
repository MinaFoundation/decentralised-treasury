import { PublicKey } from "o1js";
import { Account } from "../provable/account.js";

export interface AccountStorage {
  getAllAccounts(): Promise<Account[]>;
  getAccount(index: bigint): Promise<Account | undefined>;
  setAccount(index: bigint, account: Account): Promise<void>;
  close(): Promise<void>;
}
