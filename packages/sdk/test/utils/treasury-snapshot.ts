import { Field, PublicKey, UInt64 } from "o1js";
import { Account, packToFields } from "../../src/provable/account.js";
import { hashWithPrefix } from "../../src/provable/hashing-helpers.js";
import {
  PrefixedMerkleTree,
  PrefixedMerkleWitness36,
} from "../../src/provable/merkle-tree/prefixed-merkle-tree.js";
import {
  accountHashPrefix,
  accountLedgerHashPrefixes,
} from "../../src/ledgers/staking-ledger/staking-ledger.js";

export async function createTreasurySnapshot(
  publicKey: PublicKey,
  balance = UInt64.from(100_000_000_000),
) {
  const treasuryOwnerAccount = Account.empty();
  treasuryOwnerAccount.pk = publicKey;
  treasuryOwnerAccount.delegate = publicKey;
  treasuryOwnerAccount.balance = balance;
  const nodes = new Map<string, Field>();
  const tree = new PrefixedMerkleTree(
    36,
    hashWithPrefix(
      accountHashPrefix,
      packToFields(Account.toHashInput(Account.empty())),
    ),
    accountLedgerHashPrefixes,
    {
      namespace: "treasury-snapshot-test",
      getNode: async (level, index) => nodes.get(`${level}:${index}`),
      setNode: async (level, index, value) => {
        nodes.set(`${level}:${index}`, value);
      },
      clear: async () => {
        nodes.clear();
      },
      close: async () => {
        nodes.clear();
      },
    },
  );
  await tree.setLeaf(
    0n,
    hashWithPrefix(
      accountHashPrefix,
      packToFields(Account.toHashInput(treasuryOwnerAccount)),
    ),
  );
  return {
    treasuryOwnerAccount,
    treasuryOwnerAccountWitness: new PrefixedMerkleWitness36(
      await tree.getWitness(0n),
    ),
    root: await tree.getRoot(),
  };
}

export function applyTreasurySnapshot(
  local: { getNetworkState(): any; setNetworkState(state: any): void },
  snapshot: Awaited<ReturnType<typeof createTreasurySnapshot>>,
) {
  const state = local.getNetworkState();
  local.setNetworkState({
    ...state,
    stakingEpochData: {
      ...state.stakingEpochData,
      ledger: {
        ...state.stakingEpochData.ledger,
        hash: snapshot.root,
        totalCurrency: snapshot.treasuryOwnerAccount.balance,
      },
    },
  });
}
