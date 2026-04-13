import { Account } from "../../provable/account.js";
import {
  type AccountLookupResult,
  AccountStorage,
} from "../account-storage.js";
import {
  KeyvKeyValueStorage,
  type KeyvNamespaceCounter,
} from "./keyv-key-value-storage.js";
import { Keyv } from "keyv";

export class KeyvAccountStorage
  extends KeyvKeyValueStorage
  implements AccountStorage
{
  static namespaceFrom(lifecycleId: string): string {
    return `staking-ledger-${lifecycleId}-accounts`;
  }

  static publicKeyIndexNamespaceFrom(lifecycleId: string): string {
    return `staking-ledger-${lifecycleId}-account-public-keys`;
  }

  private readonly publicKeyIndexNamespace: string;

  constructor(
    keyv: Keyv,
    lifecycleId: string,
    counter: KeyvNamespaceCounter,
    private readonly publicKeyIndexKeyv: Keyv,
  ) {
    super(keyv, KeyvAccountStorage.namespaceFrom(lifecycleId), counter);
    this.publicKeyIndexNamespace =
      KeyvAccountStorage.publicKeyIndexNamespaceFrom(lifecycleId);
    this.publicKeyIndexKeyv.namespace = this.publicKeyIndexNamespace;
    this.publicKeyIndexKeyv.on("error", (error) => {
      throw error;
    });
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

  async getAccountByPublicKey(
    publicKey: string,
  ): Promise<AccountLookupResult | null> {
    this.publicKeyIndexKeyv.namespace = this.publicKeyIndexNamespace;
    const storedIndex = await this.publicKeyIndexKeyv.get(publicKey);
    if (typeof storedIndex !== "string" && typeof storedIndex !== "number") {
      return null;
    }
    const normalizedIndex = String(storedIndex);
    if (!/^\d+$/.test(normalizedIndex)) {
      return null;
    }
    const index = BigInt(normalizedIndex);
    const account = await this.getAccount(index);
    if (!account) {
      return null;
    }
    return {
      index,
      account,
    };
  }

  async setAccount(index: bigint, account: Account): Promise<void> {
    const previousAccount = await this.getAccount(index);
    await this.set(index.toString(), JSON.stringify(Account.toJSON(account)));
    const publicKey = account.pk.toBase58();
    this.publicKeyIndexKeyv.namespace = this.publicKeyIndexNamespace;
    await this.publicKeyIndexKeyv.set(publicKey, index.toString());
    if (previousAccount && previousAccount.pk.toBase58() !== publicKey) {
      await this.publicKeyIndexKeyv.delete(previousAccount.pk.toBase58());
    }
  }

  async clear(): Promise<void> {
    await super.clear();
    this.publicKeyIndexKeyv.namespace = this.publicKeyIndexNamespace;
    await this.publicKeyIndexKeyv.clear();
  }

  async close(): Promise<void> {
    await Promise.all([super.close(), this.publicKeyIndexKeyv.disconnect()]);
  }
}
