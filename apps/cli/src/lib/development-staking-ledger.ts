import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  LedgerHashBase58,
  PublicKey,
  ReceiptChainHashBase58,
  StateHashBase58,
  TokenId,
} from "o1js";
import { Account } from "@repo/sdk/src/provable/account.js";
import {
  computeO1jsLedgerRoot,
  type MinaTestLedgerAccount,
  type MinaTestLedgerPermissions,
} from "../commands/mina-ledger-parity.js";

const NANOMINA_PER_MINA = 1_000_000_000n;
const MIN_DEVELOPMENT_BALANCE = 100n * NANOMINA_PER_MINA;
const MAX_UINT64_NANOMINA = (1n << 64n) - 1n;

const DEFAULT_PERMISSIONS: MinaTestLedgerPermissions = {
  edit_state: "signature",
  send: "signature",
  receive: "none",
  access: "none",
  set_delegate: "signature",
  set_permissions: "signature",
  set_verification_key: { auth: "signature", txn_version: "4" },
  set_zkapp_uri: "signature",
  edit_action_state: "signature",
  set_token_symbol: "signature",
  increment_nonce: "signature",
  set_voting_for: "signature",
  set_timing: "signature",
};

function parseMinaAmount(value: string, optionName: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,9}))?$/.exec(value.trim());
  if (!match) {
    throw new Error(`${optionName} must be a non-negative MINA amount`);
  }

  const whole = BigInt(match[1]!);
  const fractional = BigInt((match[2] ?? "").padEnd(9, "0") || "0");
  const amount = whole * NANOMINA_PER_MINA + fractional;
  if (amount > MAX_UINT64_NANOMINA) {
    throw new Error(`${optionName} must fit a UInt64 nanomina amount`);
  }
  return amount;
}

function validatePublicKeys(
  treasuryOwnerPublicKey: string,
  voterPublicKeys: string[],
): void {
  const entries = [treasuryOwnerPublicKey, ...voterPublicKeys];
  for (const publicKey of entries) PublicKey.fromBase58(publicKey);

  const uniqueKeys = new Set(entries);
  if (uniqueKeys.size !== entries.length) {
    throw new Error(
      "The Treasury Owner and five voter public keys must all be different",
    );
  }
}

function createAccount(
  publicKey: string,
  balance: string,
): MinaTestLedgerAccount {
  const empty = Account.empty();
  return {
    pk: publicKey,
    balance,
    delegate: publicKey,
    token: TokenId.toBase58(TokenId.default),
    token_symbol: "",
    nonce: "0",
    receipt_chain_hash: ReceiptChainHashBase58.toBase58(empty.receiptChainHash),
    voting_for: StateHashBase58.toBase58(empty.votingFor),
    permissions: DEFAULT_PERMISSIONS,
  };
}

export interface CreateDevelopmentStakingLedgerOptions {
  outputPath: string;
  treasuryOwnerPublicKey: string;
  voter1PublicKey: string;
  voter2PublicKey: string;
  voter3PublicKey: string;
  voter4PublicKey: string;
  voter5PublicKey: string;
  treasuryOwnerBalance: string;
  voterBalance: string;
}

export interface DevelopmentStakingLedgerResult {
  outputPath: string;
  accountCount: number;
  ledgerHashBase58: string;
  stakingEpochDataLedgerHash: string;
  stakingEpochDataLedgerTotalCurrency: string;
}

export async function createDevelopmentStakingLedger(
  options: CreateDevelopmentStakingLedgerOptions,
): Promise<DevelopmentStakingLedgerResult> {
  const voterPublicKeys = [
    options.voter1PublicKey,
    options.voter2PublicKey,
    options.voter3PublicKey,
    options.voter4PublicKey,
    options.voter5PublicKey,
  ];
  validatePublicKeys(options.treasuryOwnerPublicKey, voterPublicKeys);

  const treasuryOwnerBalance = parseMinaAmount(
    options.treasuryOwnerBalance,
    "--treasury-owner-balance",
  );
  const voterBalance = parseMinaAmount(options.voterBalance, "--voter-balance");
  if (
    treasuryOwnerBalance < MIN_DEVELOPMENT_BALANCE ||
    voterBalance < MIN_DEVELOPMENT_BALANCE
  ) {
    throw new Error("Development snapshot balances must be at least 100 MINA");
  }
  const totalCurrency =
    treasuryOwnerBalance + voterBalance * BigInt(voterPublicKeys.length);
  if (totalCurrency > MAX_UINT64_NANOMINA) {
    throw new Error(
      "Development snapshot total currency must fit a UInt64 nanomina amount",
    );
  }

  const accounts = [
    // Snapshot JSON uses MINA. The ledger parser converts balances to nanomina.
    createAccount(options.treasuryOwnerPublicKey, options.treasuryOwnerBalance),
    ...voterPublicKeys.map((publicKey) =>
      createAccount(publicKey, options.voterBalance),
    ),
  ];
  const ledgerHashBase58 = await computeO1jsLedgerRoot(accounts);
  const outputPath = resolve(options.outputPath);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(accounts, null, 2)}\n`, "utf8");

  return {
    outputPath,
    accountCount: accounts.length,
    ledgerHashBase58,
    stakingEpochDataLedgerHash:
      LedgerHashBase58.fromBase58(ledgerHashBase58).toString(),
    stakingEpochDataLedgerTotalCurrency: totalCurrency.toString(),
  };
}
