import { createReadStream, statSync } from "fs";
import streamJson from "stream-json";
import StreamArray from "stream-json/streamers/StreamArray.js";
import {
  Account,
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
  ReceiptChainHashBase58,
  UInt32,
  Bool,
  ZkappUri,
  VerificationKey,
} from "o1js";
import {
  PrefixedMerkleTree,
  PrefixedMerkleWitness36,
} from "../../provable/merkle-tree/prefixed-merkle-tree.js";
import { hashWithPrefix } from "../../provable/hashing-helpers.js";
import { MerkleTreeStorage } from "../../storage/merkle-tree-storage.js";
import { logger } from "../../logging/logger.js";

const NANOMINA_PER_MINA = 1_000_000_000n;
const MINA_DECIMAL_PLACES = 9;

// Mina ledger exports represent amounts as whole-or-fractional MINA strings
// (e.g. "1550" or "0.000000028" for dust balances), not nanomina integers.
// Parsing the fractional part as a string (rather than via Number) avoids
// float rounding errors at nanomina precision.
function parseMinaAmountToNanomina(value: string | number): bigint {
  const raw = String(value).trim();
  const [wholePart, fractionalPart = ""] = raw.split(".");
  if (fractionalPart.length > MINA_DECIMAL_PLACES) {
    throw new Error(
      `Mina amount "${value}" has more than ${MINA_DECIMAL_PLACES} decimal places, which exceeds nanomina precision`,
    );
  }
  const paddedFractionalPart = fractionalPart.padEnd(MINA_DECIMAL_PLACES, "0");
  return (
    BigInt(wholePart || "0") * NANOMINA_PER_MINA +
    BigInt(paddedFractionalPart || "0")
  );
}

export interface StakingLedger {
  getAllAccounts(): Promise<Account[]>;
  accountCount(): Promise<number>;
  getAccount(index: bigint): Promise<Account>;
  setAccount(index: bigint, account: Account): Promise<void>;
  getWitness(index: bigint): Promise<PrefixedMerkleWitness36>;
  setLeaf(index: bigint, leaf: Account): Promise<void>;
  getRoot(): Promise<Field>;
  close(): Promise<void>;
}

export const accountHashPrefix = "MinaAccount*********";

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

export abstract class BaseStakingLedger implements StakingLedger {
  public merkleTree: PrefixedMerkleTree;

  public constructor(public merkleTreeStorage: MerkleTreeStorage) {
    const emptyAccount = Account.empty();
    const hashInput = Account.toHashInput(emptyAccount);
    const fields = packToFields(hashInput);
    const emptyAccountHash = hashWithPrefix(accountHashPrefix, fields);

    this.merkleTree = new PrefixedMerkleTree(
      36,
      emptyAccountHash,
      accountLedgerHashPrefixes,
      this.merkleTreeStorage,
    );
  }

  public abstract getAllAccounts(): Promise<Account[]>;
  public abstract accountCount(): Promise<number>;
  public abstract getAccount(index: bigint): Promise<Account>;
  public abstract setAccount(index: bigint, account: Account): Promise<void>;
  public abstract close(): Promise<void>;

  public async getWitness(index: bigint): Promise<PrefixedMerkleWitness36> {
    return new PrefixedMerkleWitness36(await this.merkleTree.getWitness(index));
  }

  public async setLeaf(index: bigint, leaf: Account): Promise<void> {
    await this.merkleTree.setLeaf(
      index,
      hashWithPrefix(
        accountHashPrefix,
        packToFields(Account.toHashInput(leaf)),
      ),
    );
  }

  public async getRoot(): Promise<Field> {
    return await this.merkleTree.getRoot();
  }

  public async hydrateAccounts(
    accounts: Account[],
    startIndex = 0,
    endIndex?: number,
    onHydrateAccountComplete?: (index: bigint, account: Account) => void,
  ): Promise<void> {
    endIndex = endIndex ?? accounts.length;
    logger.info("hydrating accounts", startIndex, endIndex, accounts.length);

    if (endIndex > accounts.length) {
      throw new Error("End index is greater than the number of accounts");
    }

    const accountsToHydrate = accounts.slice(startIndex, endIndex + 1);
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

  public async hydrateMerkleTree(
    accounts: Account[],
    startIndex = 0,
    endIndex?: number,
    onHydrateLeafComplete?: (index: bigint, leaf: Account) => void,
  ): Promise<void> {
    endIndex = endIndex ?? accounts.length - 1;

    if (endIndex > accounts.length) {
      throw new Error("End index is greater than the number of accounts");
    }

    const accountsToHydrate = accounts.slice(startIndex, endIndex + 1);
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

  public async readStakingLedger(
    stakingLedgerPath: string,
    onAccountReadComplete?: (bytesRead: number, totalBytes: number) => void,
  ): Promise<Account[]> {
    const { parser } = streamJson;
    const { streamArray } = StreamArray;

    let accountCount = 0;
    const accounts: Record<number, Account> = {};

    return new Promise(async (resolve, reject) => {
      const { size: totalSize } = statSync(stakingLedgerPath);
      const readStream = createReadStream(stakingLedgerPath);
      let parseQueue = Promise.resolve();

      readStream
        .pipe(parser())
        .pipe(streamArray())
        .on("data", ({ value }) => {
          accountCount++;
          const index = accountCount;

          parseQueue = parseQueue.then(async () => {
            const account = await this.parseStakingLedgerAccount(value);
            accounts[index] = account;
            onAccountReadComplete?.(readStream.bytesRead, totalSize);
          });
        })
        .on("end", async () => {
          try {
            await parseQueue;
            const accountsArray = Object.entries(accounts)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([, account]) => account);
            resolve(accountsArray);
            onAccountReadComplete?.(readStream.bytesRead, totalSize);
          } catch (error) {
            reject(error);
          }
        })
        .on("error", (error) => {
          logger.error("Error reading staking ledger", error);
          reject(error);
        });
    });
  }

  // TODO: should be typed to match the JSON schema
  public async parseStakingLedgerAccount(value: any): Promise<Account> {
    return new Account({
      pk: PublicKey.fromBase58(value.pk),
      tokenId: TokenId.fromBase58(value.token),
      tokenSymbol: TokenSymbol.from(value.token_symbol),
      nonce: UInt32.from(value.nonce ?? 0),

      receiptChainHash: ReceiptChainHashBase58.fromBase58(
        value.receipt_chain_hash,
      ),

      votingFor: StateHashBase58.fromBase58(value.voting_for),
      timing: value.timing
        ? new Timing({
            isTimed: Bool(true),
            initialMinimumBalance: UInt64.from(
              parseMinaAmountToNanomina(value.timing.initial_minimum_balance),
            ),
            cliffTime: UInt32.from(value.timing.cliff_time),
            cliffAmount: UInt64.from(
              parseMinaAmountToNanomina(value.timing.cliff_amount),
            ),
            vestingPeriod: UInt32.from(value.timing.vesting_period),
            vestingIncrement: UInt64.from(
              parseMinaAmountToNanomina(value.timing.vesting_increment),
            ),
          })
        : Timing.empty(),
      permissions: new Permissions({
        editState: Permission.fromString(value.permissions.edit_state),
        send: Permission.fromString(value.permissions.send),
        receive: Permission.fromString(value.permissions.receive),
        access: Permission.fromString(value.permissions.access),
        setDelegate: Permission.fromString(value.permissions.set_delegate),
        setPermissions: Permission.fromString(
          value.permissions.set_permissions,
        ),
        setVerificationKey: [
          Permission.fromString(value.permissions.set_verification_key.auth),
          UInt32.from(value.permissions.set_verification_key.txn_version),
        ],
        setZkappUri: Permission.fromString(value.permissions.set_zkapp_uri),
        editActionState: Permission.fromString(
          value.permissions.edit_action_state,
        ),
        setTokenSymbol: Permission.fromString(
          value.permissions.set_token_symbol,
        ),
        incrementNonce: Permission.fromString(
          value.permissions.increment_nonce,
        ),
        setVotingFor: Permission.fromString(value.permissions.set_voting_for),
        setTiming: Permission.fromString(value.permissions.set_timing),
      }),
      zkapp: value.zkapp
        ? new Zkapp({
            appState: value.zkapp.app_state.map((state) => Field(state)),
            verificationKey: value.zkapp.verification_key
              ? await VerificationKey.fromData(value.zkapp.verification_key)
              : VerificationKey.dummySync(),
            zkappVersion: Field(value.zkapp.zkapp_version),
            actionState: value.zkapp.action_state.map((action) =>
              Field(action),
            ),
            lastActionSlot: Field(value.zkapp.last_action_slot),
            provedState: Bool(value.zkapp.proved_state),
            zkappUri:
              value.zkapp.zkapp_uri === ""
                ? Zkapp.empty().zkappUri
                : ZkappUri.from(value.zkapp.zkapp_uri).hash,
          })
        : Zkapp.empty(),

      balance: UInt64.from(parseMinaAmountToNanomina(value.balance)),
      delegate: value.delegate
        ? PublicKey.fromBase58(value.delegate)
        : PublicKey.empty(),
    });
  }
}
