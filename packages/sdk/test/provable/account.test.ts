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
} from "o1js";
import { hashWithPrefix } from "../../src/provable/hashing-helpers.js";

it("should work", async () => {
  const emptyAccount = new Account({
    pk: PublicKey.empty(),
    tokenId: TokenId.fromBase58(
      "wSHV2S4qX9jFsLjQo8r1BsMLH2ZRKsZx6EJd1sbozGPieEC4Jf"
    ),
    tokenSymbol: TokenSymbol.empty(),
    balance: UInt64.from(0),
    nonce: UInt32.from(0),
    receiptChainHash: ReceiptChainHashBase58.fromBase58(
      "2mzbV7WevxLuchs2dAMY4vQBS6XttnCUF8Hvks4XNBQ5qiSGGBQe"
    ),
    delegate: PublicKey.empty(),
    votingFor: StateHashBase58.fromBase58(
      "3NK2tkzqqK5spR2sZ7tujjqPksL45M3UUrcA4WhCkeiPtnugyE2x"
    ),
    timing: Timing.empty(),
    permissions: new Permissions({
      editState: Permission.signature(),
      access: Permission.none(),
      send: Permission.signature(),
      receive: Permission.none(),
      setDelegate: Permission.signature(),
      setPermissions: Permission.signature(),
      setVerificationKey: [Permission.signature(), UInt32.from(3)],
      setZkappUri: Permission.signature(),
      editActionState: Permission.signature(),
      setTokenSymbol: Permission.signature(),
      incrementNonce: Permission.signature(),
      setVotingFor: Permission.signature(),
      setTiming: Permission.signature(),
    }),
    zkapp: Zkapp.empty(),
  });

  Provable.log("empty account", emptyAccount);

  const hashInput = Account.toHashInput(emptyAccount);
  const fields = packToFields(hashInput);
  Provable.log("fields", fields);
  Provable.log("empty account hash", hashWithPrefix(accountHashPrefix, fields));
});
