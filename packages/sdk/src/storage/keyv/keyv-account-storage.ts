import { Account } from "../../provable/account.js";
import { AccountStorage } from "../account-storage.js";
import {
  KeyvKeyValueStorage,
  type KeyvNamespaceCounter,
} from "./keyv-key-value-storage.js";
import { Keyv } from "keyv";

export class KeyvAccountStorage
  extends KeyvKeyValueStorage
  implements AccountStorage
{
  constructor(keyv: Keyv, namespace: string, counter: KeyvNamespaceCounter) {
    super(keyv, `${namespace}-accounts`, counter);
  }

  async getAllAccounts(): Promise<Account[]> {
    const accounts: Account[] = [];
    let index = 0n;
    let account: Account | undefined;
    while (account || index === 0n) {
      account = await this.getAccount(index);
      account && accounts.push(account);
      index++;
    }

    return accounts;
  }

  async getAccount(index: bigint): Promise<Account | undefined> {
    const account = await this.get(index.toString());
    return account ? Account.fromJSON(JSON.parse(account)) : undefined;
  }

  async setAccount(index: bigint, account: Account): Promise<void> {
    await this.set(index.toString(), JSON.stringify(Account.toJSON(account)));
  }

  async close(): Promise<void> {
    await super.close();
  }
}
