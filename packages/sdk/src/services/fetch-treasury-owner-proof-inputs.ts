import { PublicKey, TokenId, UInt64 } from "o1js";
import { Account } from "../provable/account.js";
import { PrefixedMerkleWitness36 } from "../provable/merkle-tree/prefixed-merkle-tree.js";

/** Fetch historical inputs. The creation circuit checks their root against Mina. */
export async function fetchTreasuryOwnerProofInputs(
  apiUrl: string,
  lifecycleId: string,
  treasuryOwnerPublicKey: PublicKey,
) {
  const base = `${apiUrl.replace(/\/+$/, "")}/staking-ledger/lifecycles/${encodeURIComponent(lifecycleId)}`;
  const lookup = await fetch(
    `${base}/accounts/${treasuryOwnerPublicKey.toBase58()}?tokenId=1`,
  );
  if (!lookup.ok) {
    throw new Error(
      "The default-token Treasury Owner is not available in the staking snapshot. Wait for a usable snapshot.",
    );
  }
  const { index } = (await lookup.json()) as { index: string };
  if (typeof index !== "string" || !/^\d+$/.test(index)) {
    throw new Error("Invalid Treasury Owner staking account index.");
  }
  const response = await fetch(`${base}/witnesses/${index}`);
  if (!response.ok)
    throw new Error("The Treasury Owner staking witness is not available.");
  const payload = await response.json();
  const treasuryOwnerAccount = Account.fromJSON(payload.account);
  const treasuryOwnerAccountWitness = PrefixedMerkleWitness36.fromJSON(
    payload.witness,
  );
  treasuryOwnerAccount.pk
    .equals(treasuryOwnerPublicKey)
    .assertTrue("Treasury owner account public key does not match");
  treasuryOwnerAccount.tokenId.assertEquals(
    TokenId.default,
    "Treasury owner account token id does not match",
  );
  treasuryOwnerAccount.balance.assertGreaterThan(
    UInt64.zero,
    "Treasury owner staking snapshot balance must be positive",
  );
  return { treasuryOwnerAccount, treasuryOwnerAccountWitness };
}
