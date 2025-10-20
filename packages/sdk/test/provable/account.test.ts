import { it } from "node:test";
import {
  Account,
  accountHashPrefix,
  packToFields,
  Permission,
  Permissions,
  Timing,
  Zkapp,
} from "../../src/provable/account.js";
import {
  AccountUpdate,
  Field,
  Lightnet,
  MerkleTree,
  Mina,
  Poseidon,
  PrivateKey,
  Provable,
  PublicKey,
  ReceiptChainHashBase58,
  StateHashBase58,
  TokenId,
  TokenSymbol,
  UInt32,
  UInt64,
  PrefixedMerkleTree,
  LedgerHashBase58,
} from "o1js";
import { hashWithPrefix } from "../../src/provable/hashing-helpers.js";
import { readLedger } from "../../src/read-ledger.js";

const prefixes = [
  "MinaMklTree000******",
  "MinaMklTree001******",
  "MinaMklTree002******",
  "MinaMklTree003******",
  "MinaMklTree004******",
  "MinaMklTree005******",
  "MinaMklTree006******",
  "MinaMklTree007******",
  "MinaMklTree008******",
  "MinaMklTree009******",
  "MinaMklTree010******",
  "MinaMklTree011******",
  "MinaMklTree012******",
  "MinaMklTree013******",
  "MinaMklTree014******",
  "MinaMklTree015******",
  "MinaMklTree016******",
  "MinaMklTree017******",
  "MinaMklTree018******",
  "MinaMklTree019******",
  "MinaMklTree020******",
  "MinaMklTree021******",
  "MinaMklTree022******",
  "MinaMklTree023******",
  "MinaMklTree024******",
  "MinaMklTree025******",
  "MinaMklTree026******",
  "MinaMklTree027******",
  "MinaMklTree028******",
  "MinaMklTree029******",
  "MinaMklTree030******",
  "MinaMklTree031******",
  "MinaMklTree032******",
  "MinaMklTree033******",
  "MinaMklTree034******",
];

it("should work", async () => {
  const emptyAccount = Account.empty();

  Provable.log("empty account", emptyAccount);

  const hashInput = Account.toHashInput(emptyAccount);
  const fields = packToFields(hashInput);
  Provable.log("hashInput", hashInput, hashInput.packeds.length);
  Provable.log("fields", fields);
  Provable.log("empty account hash", hashWithPrefix(accountHashPrefix, fields));
});

it("should build the tree", async () => {
  const emptyAccount = Account.empty();

  Provable.log("empty account", emptyAccount);

  const hashInput = Account.toHashInput(emptyAccount);
  const fields = packToFields(hashInput);
  const emptyAccountHash = hashWithPrefix(accountHashPrefix, fields);
  Provable.log("hashInput", hashInput, hashInput.packeds.length);
  Provable.log("fields", fields);
  Provable.log("empty account hash", emptyAccountHash);

  const tree = new PrefixedMerkleTree(36, emptyAccountHash, prefixes);
  const root = tree.getRoot();
  const accounts = await readLedger("test/provable/staking-epoch-ledger.json");

  // Provable.log("merkle path", tree.getWitness(0n));

  // Provable.log(
  //   "staking ledger hash",
  //   LedgerHashBase58.fromBase58(
  //     "jxJoqEgKwaentpB89TqDZQwp3SXt25A4hE8Z7duuS4ZdMXE5K2m"
  //   )
  // );

  console.time("build tree");
  accounts.forEach((account, index) => {
    const hashInput = Account.toHashInput(account);
    const fields = packToFields(hashInput);
    const hash = hashWithPrefix(accountHashPrefix, fields);

    tree.setLeaf(BigInt(index), hash);

    if (index === 0) {
      Provable.log("hashInput", hashInput, hashInput.packeds.length);
      Provable.log("fields", fields);
      Provable.log("hash", hash);

      Provable.log("ground zero");
      // Provable.log("account", account);
      Provable.log("account hash", hash);
      Provable.log("tree root with 1 account", tree.getRoot());
      // Provable.log("merkle path", tree.getWitness(1n));
    }
  });

  console.timeEnd("build tree");

  Provable.log("empty tree root", root);
  Provable.log("populated tree root", tree.getRoot());

  const Lightnet = Mina.Network("http://127.0.0.1:8080/graphql");
  Mina.setActiveInstance(Lightnet);

  await Mina.transaction(
    PublicKey.fromBase58(
      "B62qikT41XWwfMuoRC1SBvQxBfvHPnYfY7Hm9TUWNQXMLka5eP4xowB"
    ),
    async () => {
      const networkState = await Mina.getNetworkState();
      Provable.log("network state", networkState);
    }
  );
});
