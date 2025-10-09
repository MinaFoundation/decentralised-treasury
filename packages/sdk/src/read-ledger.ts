import { createReadStream } from "fs";
import streamJson from "stream-json";
import StreamArray from "stream-json/streamers/StreamArray.js";
import {
  Account,
  Permission,
  Permissions,
  Timing,
  Zkapp,
} from "./provable/account.js";
import {
  Field,
  PublicKey,
  TokenId,
  TokenSymbol,
  UInt64,
  StateHashBase58,
  TokenIdBase58,
  ReceiptChainHashBase58,
  UInt32,
} from "o1js";

export async function readLedger(
  stakingLedgerPath: string
): Promise<Account[]> {
  const { parser } = streamJson;
  const { streamArray } = StreamArray;

  let accountCount = 0;
  let accounts: Account[] = [];

  return new Promise((resolve, reject) => {
    createReadStream(stakingLedgerPath)
      .pipe(parser())
      .pipe(streamArray())
      .on("data", ({ value }) => {
        accountCount++;

        if (accountCount % 1000 === 0) {
          console.log(`Processed ${accountCount} accounts...`);
        }

        const account = new Account({
          pk: PublicKey.fromBase58(value.pk),
          tokenId: TokenId.fromBase58(value.token),
          tokenSymbol: TokenSymbol.from(value.token_symbol),
          nonce: UInt32.from(value.nonce ?? 0),

          receiptChainHash: ReceiptChainHashBase58.fromBase58(
            value.receipt_chain_hash
          ),

          votingFor: StateHashBase58.fromBase58(value.voting_for),
          timing: value.timing
            ? new Timing({
                initialMinimumBalance: UInt64.from(
                  value.timing.initial_minimum_balance
                ),
                cliffTime: UInt64.from(value.timing.cliff_time),
                cliffAmount: UInt64.from(value.timing.cliff_amount),
                vestingPeriod: UInt64.from(value.timing.vesting_period),
                vestingIncrement: UInt64.from(value.timing.vesting_increment),
              })
            : Timing.empty(),
          permissions: new Permissions({
            editState: Permission.fromString(value.permissions.edit_state),
            send: Permission.fromString(value.permissions.send),
            receive: Permission.fromString(value.permissions.receive),
            access: Permission.fromString(value.permissions.access),
            setDelegate: Permission.fromString(value.permissions.set_delegate),
            setPermissions: Permission.fromString(
              value.permissions.set_permissions
            ),
          }),
          // TODO: implement zk app support
          zkapp: Zkapp.empty(),

          balance: UInt64.from(value.balance),
          delegate: PublicKey.fromBase58(value.delegate),
        });

        accounts.push(account);
      })
      .on("end", () => {
        console.log(`Total accounts processed: ${accountCount}`);
        resolve(accounts);
      })
      .on("error", reject);
  });
}
