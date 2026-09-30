import { PublicKey, TokenId } from "o1js";
import type { Account } from "../provable/account.js";

export function findDefaultTokenAccountIndex(
  accounts: readonly Account[],
  publicKey: PublicKey,
): number {
  return accounts.findIndex((account) =>
    account.pk
      .equals(publicKey)
      .and(account.tokenId.equals(TokenId.default))
      .toBoolean(),
  );
}
