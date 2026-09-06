import {
  Account,
  packToFields,
} from "@repo/sdk/src/provable/account.js";
import { hashWithPrefix } from "@repo/sdk/src/provable/hashing-helpers.js";
import {
  accountHashPrefix,
  accountLedgerHashPrefixes,
} from "@repo/sdk/src/ledgers/staking-ledger/staking-ledger.js";
import type { StakingLedgerService } from "@repo/sdk/src/services/staking-ledger-service.js";
import { Field, PublicKey, TokenId } from "o1js";

function isExpectedDefaultTokenAccount(
  account: Account,
  expectedPublicKey: PublicKey,
): boolean {
  return (
    account.pk.equals(expectedPublicKey).toBoolean() &&
    account.tokenId.equals(TokenId.default).toBoolean()
  );
}

/**
 * Select the same default-token treasury account that tallyVotes() proves.
 * The legacy public-key index is not sufficient because Mina accounts are
 * identified by both public key and token ID.
 */
export async function getDefaultTokenTreasuryAccount(
  stakingLedger: StakingLedgerService,
  treasuryOwnerPublicKey: string,
  lifecycleId: number,
  expectedStakingLedgerRoot: string,
): Promise<Account> {
  const expectedPublicKey = PublicKey.fromBase58(treasuryOwnerPublicKey);
  const indexedAccount = await stakingLedger.getAccountByPublicKey(
    treasuryOwnerPublicKey,
  );
  let selectedAccount: { index: bigint; account: Account } | null = null;
  if (
    indexedAccount &&
    isExpectedDefaultTokenAccount(indexedAccount.account, expectedPublicKey)
  ) {
    selectedAccount = indexedAccount;
  }

  if (!selectedAccount) {
    // Existing lifecycle stores index public keys without the token ID. Scan
    // only when that legacy index selects a custom-token account or misses.
    const matchingAccounts = (await stakingLedger.getAllAccounts())
      .map((account, index) => ({ index: BigInt(index), account }))
      .filter(({ account }) =>
        isExpectedDefaultTokenAccount(account, expectedPublicKey),
      );
    if (matchingAccounts.length !== 1) {
      throw new Error(
        `[proposal-processor] expected exactly one default-token treasury account in staking ledger for lifecycleId=${lifecycleId} publicKey=${treasuryOwnerPublicKey}; found=${matchingAccounts.length}`,
      );
    }
    selectedAccount = matchingAccounts[0]!;
  }

  const witness = await stakingLedger.getWitness(selectedAccount.index);
  const accountLeaf = hashWithPrefix(
    accountHashPrefix,
    packToFields(Account.toHashInput(selectedAccount.account)),
  );
  const calculatedRoot = witness.calculateRoot(
    accountLeaf,
    accountLedgerHashPrefixes,
  );
  if (!calculatedRoot.equals(Field(expectedStakingLedgerRoot)).toBoolean()) {
    throw new Error(
      `[proposal-processor] default-token treasury account witness does not match staking ledger root for lifecycleId=${lifecycleId} publicKey=${treasuryOwnerPublicKey}`,
    );
  }
  return selectedAccount.account;
}
