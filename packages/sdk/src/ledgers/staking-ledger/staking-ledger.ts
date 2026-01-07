import { createReadStream, statSync } from "fs";
import streamJson from "stream-json";
import StreamArray from "stream-json/streamers/StreamArray.js";
import {
  Account,
  accountHashPrefix,
  packToFields,
  Permission,
  Permissions,
  Timing,
  Zkapp,
} from "../../provable/account.js";
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
  Bool,
  Provable,
} from "o1js";
import {
  PrefixedMerkleTree,
  PrefixedMerkleWitness36,
} from "../../provable/merkle-tree/prefixed-merkle-tree.js";
import { MerkleTreeStorage } from "../../storage/merkle-tree-storage.js";
import { AccountStorage } from "../../storage/account-storage.js";
import { hashWithPrefix } from "../../provable/hashing-helpers.js";
import { prettyPrintProgress } from "../../pretty-print-progress.js";

export interface StakingLedger {
  getAllAccounts(): Promise<Account[]>;
  getAccount(index: bigint): Promise<Account>;
  setAccount(index: bigint, account: Account): Promise<void>;
  getWitness(index: bigint): Promise<PrefixedMerkleWitness36>;
  setLeaf(index: bigint, leaf: Account): Promise<void>;
  getRoot(): Promise<Field>;
  close(): Promise<void>;
}

export const accountLedgerHashPrefixes = [
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

const emptyAccount = Account.empty();
const hashInput = Account.toHashInput(emptyAccount);
const fields = packToFields(hashInput);
const emptyAccountHash = hashWithPrefix(accountHashPrefix, fields);

export class BaseStakingLedger implements StakingLedger {
  public merkleTree: PrefixedMerkleTree;

  public constructor(
    public accountStorage: AccountStorage,
    public merkleTreeStorage: MerkleTreeStorage
  ) {
    this.accountStorage = accountStorage;
    this.merkleTreeStorage = merkleTreeStorage;
    this.merkleTree = new PrefixedMerkleTree(
      36,
      emptyAccountHash,
      accountLedgerHashPrefixes,
      this.merkleTreeStorage
    );
  }

  public async close(): Promise<void> {
    await this.accountStorage.close();
    await this.merkleTreeStorage.close();
  }

  public async getAllAccounts(): Promise<Account[]> {
    return await this.accountStorage.getAllAccounts();
  }

  public async getAccount(index: bigint): Promise<Account> {
    return (await this.accountStorage.getAccount(index)) ?? Account.empty();
  }

  public async setAccount(index: bigint, account: Account): Promise<void> {
    await this.accountStorage.setAccount(index, account);
  }

  public async getWitness(index: bigint): Promise<PrefixedMerkleWitness36> {
    return new PrefixedMerkleWitness36(await this.merkleTree.getWitness(index));
  }

  public async setLeaf(index: bigint, leaf: Account): Promise<void> {
    await this.merkleTree.setLeaf(
      index,
      hashWithPrefix(accountHashPrefix, packToFields(Account.toHashInput(leaf)))
    );
  }

  public async getRoot(): Promise<Field> {
    return await this.merkleTree.getRoot();
  }

  async readStakingLedger(
    stakingLedgerPath: string,
    onAccountReadComplete?: (bytesRead: number, totalBytes: number) => void
  ): Promise<Account[]> {
    const { parser } = streamJson;
    const { streamArray } = StreamArray;

    let accountCount = 0;
    let accounts: Account[] = [];

    return new Promise(async (resolve, reject) => {
      const { size: totalSize } = statSync(stakingLedgerPath);

      const readStream = createReadStream(stakingLedgerPath);

      readStream
        .pipe(parser())
        .pipe(streamArray())
        .on("data", ({ value }) => {
          accountCount++;
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
                  isTimed: Bool(true),
                  initialMinimumBalance: UInt64.from(
                    value.timing.initial_minimum_balance
                  ).mul(1_000_000_000),
                  cliffTime: UInt32.from(value.timing.cliff_time),
                  cliffAmount: UInt64.from(value.timing.cliff_amount).mul(
                    1_000_000_000
                  ),
                  vestingPeriod: UInt32.from(value.timing.vesting_period),
                  vestingIncrement: UInt64.from(
                    value.timing.vesting_increment
                  ).mul(1_000_000_000),
                })
              : Timing.empty(),
            permissions: new Permissions({
              editState: Permission.fromString(value.permissions.edit_state),
              send: Permission.fromString(value.permissions.send),
              receive: Permission.fromString(value.permissions.receive),
              access: Permission.fromString(value.permissions.access),
              setDelegate: Permission.fromString(
                value.permissions.set_delegate
              ),
              setPermissions: Permission.fromString(
                value.permissions.set_permissions
              ),
              setVerificationKey: [
                Permission.fromString(
                  value.permissions.set_verification_key.auth
                ),
                UInt32.from(value.permissions.set_verification_key.txn_version),
              ],
              setZkappUri: Permission.fromString(
                value.permissions.set_zkapp_uri
              ),
              editActionState: Permission.fromString(
                value.permissions.edit_action_state
              ),
              setTokenSymbol: Permission.fromString(
                value.permissions.set_token_symbol
              ),
              incrementNonce: Permission.fromString(
                value.permissions.increment_nonce
              ),
              setVotingFor: Permission.fromString(
                value.permissions.set_voting_for
              ),
              setTiming: Permission.fromString(value.permissions.set_timing),
            }),
            // TODO: implement zk app support
            zkapp: Zkapp.empty(),

            balance: UInt64.from(value.balance).mul(1_000_000_000),
            delegate: PublicKey.fromBase58(value.delegate),
          });

          accounts.push(account);
          onAccountReadComplete?.(readStream.bytesRead, totalSize);
        })
        .on("end", () => {
          resolve(accounts);
          onAccountReadComplete?.(readStream.bytesRead, totalSize);
        })
        .on("error", (error) => {
          console.error("Error reading staking ledger", error);
          reject(error);
        });
    });
  }

  async hydrateAccountStorage(
    accounts: Account[],
    startIndex = 0,
    endIndex?: number,
    onHydrateAccountComplete?: (index: bigint, account: Account) => void
  ): Promise<void> {
    endIndex = endIndex ? endIndex + 1 : accounts.length;

    if (endIndex > accounts.length) {
      throw new Error("End index is greater than the number of accounts");
    }

    const accountsToHydrate = accounts.slice(startIndex, endIndex);
    if (accountsToHydrate.length === 0) {
      throw new Error("No accounts to hydrate");
    }

    for (let i = 0; i < accountsToHydrate.length; i++) {
      const account = accountsToHydrate[i];
      const index = BigInt(i + startIndex);
      await this.setAccount(index, account);
      onHydrateAccountComplete?.(index, account);
    }
  }

  async hydrateMerkleTreeStorage(
    accounts: Account[],
    startIndex = 0,
    endIndex?: number,
    onHydrateLeafComplete?: (index: bigint, leaf: Account) => void
  ): Promise<void> {
    endIndex = endIndex ? endIndex + 1 : accounts.length;

    if (endIndex > accounts.length) {
      throw new Error("End index is greater than the number of accounts");
    }

    const accountsToHydrate = accounts.slice(startIndex, endIndex);

    if (accountsToHydrate.length === 0) {
      throw new Error("No accounts to hydrate");
    }

    for (let i = 0; i < accountsToHydrate.length; i++) {
      const account = accountsToHydrate[i];
      const treeIndex = BigInt(i + startIndex);
      await this.setLeaf(treeIndex, account);
      onHydrateLeafComplete?.(treeIndex, account);
    }
  }
}
