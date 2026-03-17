import { PrivateKey } from "o1js";
import { Account } from "../src/provable/account.js";
// TODO: we should NOT always use a new random account dataset for testing
export async function createTestAccounts(numberOfAccounts: number) {
  const accounts: Account[] = [];

  for (let i = 0; i < numberOfAccounts; i++) {
    const account = Account.empty();
    account.pk = PrivateKey.random().toPublicKey();
    account.delegate = PrivateKey.random().toPublicKey();
    account.balance = account.balance.add(
      Math.floor(Math.random() * 1_000_000) * 1_000_000_000,
    );
    accounts.push(account);

    const interval =
      numberOfAccounts >= 100000
        ? 10000
        : numberOfAccounts >= 10000
          ? 1000
          : numberOfAccounts >= 1000
            ? 100
            : 10;

    if (i % interval === 0 && i > 0) {
      console.log(`Created ${i} accounts...`);
    }
  }

  return accounts;
}
