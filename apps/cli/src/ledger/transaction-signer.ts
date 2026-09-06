import { Command, Option } from "commander";
import { PrivateKey, PublicKey } from "o1js";
import type { TransactionSigner } from "@repo/sdk/src/services/transaction-signing.js";
import { parseIntOption } from "../commands/option-parsers.js";
import { signTxWithLedger } from "./ledger-signing.js";

type LedgerNetworkId = "mainnet" | "devnet" | "testnet";

export type SignerMode = "in-memory" | "ledger";

export interface ResolvedSigningAccount {
  label: string;
  publicKey: PublicKey;
  privateKey?: PrivateKey;
  ledgerAccountIndex?: number;
}

function parsePublicKey(value: string): PublicKey {
  return PublicKey.fromBase58(value);
}

function optionName(role: string, suffix: string): string {
  return `--${role}-${suffix}`;
}

function environmentName(role: string, suffix: string): string {
  return `${role}-${suffix}`.replaceAll("-", "_").toUpperCase();
}

export function addTransactionSignerOptions(
  command: Command,
  roles: Array<{ role: string; label: string }>,
): Command {
  command.addOption(
    new Option("--signer <signer>", "Signing implementation")
      .choices(["in-memory", "ledger"])
      .default("in-memory")
      .env("SIGNER"),
  );
  for (const { role, label } of roles) {
    command
      .addOption(
        new Option(
          optionName(role, "public-key") + ` <${role}-public-key>`,
          `${label} public key for Ledger signing`,
        )
          .env(environmentName(role, "public-key"))
          .argParser(parsePublicKey),
      )
      .addOption(
        new Option(
          optionName(role, "ledger-account-index") +
            ` <${role}-ledger-account-index>`,
          `Ledger account index for ${label.toLowerCase()}`,
        )
          .env(environmentName(role, "ledger-account-index"))
          .argParser(parseIntOption),
      );
  }
  return command;
}

export function resolveSigningAccount(options: {
  signer: SignerMode;
  label: string;
  privateKey?: PrivateKey;
  publicKey?: PublicKey;
  ledgerAccountIndex?: number;
}): ResolvedSigningAccount {
  if (options.signer === "ledger") {
    if (!options.publicKey) {
      throw new Error(
        `${options.label} public key is required when --signer=ledger.`,
      );
    }
    if (options.ledgerAccountIndex === undefined) {
      throw new Error(
        `${options.label} Ledger account index is required when --signer=ledger.`,
      );
    }
    if (
      !Number.isSafeInteger(options.ledgerAccountIndex) ||
      options.ledgerAccountIndex < 0 ||
      options.ledgerAccountIndex > 0xffff_ffff
    ) {
      throw new Error(
        `${options.label} Ledger account index must be an integer from 0 through 4294967295.`,
      );
    }
    return {
      label: options.label,
      publicKey: options.publicKey,
      ledgerAccountIndex: options.ledgerAccountIndex,
    };
  }
  if (!options.privateKey) {
    throw new Error(
      `${options.label} private key is required when --signer=in-memory.`,
    );
  }
  return {
    label: options.label,
    publicKey: options.privateKey.toPublicKey(),
    privateKey: options.privateKey,
  };
}

export function createLedgerTransactionSigner(
  signer: SignerMode,
  accounts: ResolvedSigningAccount[],
  networkId?: LedgerNetworkId,
  ledgerSignTransaction: typeof signTxWithLedger = signTxWithLedger,
  additionalPrivateKeys: PrivateKey[] = [],
): TransactionSigner | undefined {
  if (signer !== "ledger") return undefined;
  const indices = new Map<string, number>();
  const publicKeyByIndex = new Map<number, string>();
  const inMemoryPublicKeys = new Set(
    additionalPrivateKeys.map((privateKey) =>
      privateKey.toPublicKey().toBase58(),
    ),
  );
  for (const account of accounts) {
    const publicKey = account.publicKey.toBase58();
    const accountIndex = account.ledgerAccountIndex;
    if (accountIndex === undefined) {
      throw new Error(
        `${account.label} Ledger account index is required when --signer=ledger.`,
      );
    }
    const priorPublicKey = publicKeyByIndex.get(accountIndex);
    if (priorPublicKey && priorPublicKey !== publicKey) {
      throw new Error(
        `Ledger account index ${accountIndex} cannot identify both ${priorPublicKey} and ${publicKey}.`,
      );
    }
    const priorIndex = indices.get(publicKey);
    if (priorIndex !== undefined && priorIndex !== accountIndex) {
      throw new Error(
        `Ledger public key ${publicKey} cannot use both account indices ${priorIndex} and ${accountIndex}.`,
      );
    }
    publicKeyByIndex.set(accountIndex, publicKey);
    indices.set(publicKey, accountIndex);
  }
  return async (transaction) => {
    const transactionIndices = selectTransactionLedgerAccountIndices(
      transaction,
      indices,
      inMemoryPublicKeys,
    );
    const signedTransaction = await ledgerSignTransaction(
      transaction,
      transactionIndices,
      networkId,
    );
    return additionalPrivateKeys.length > 0
      ? signedTransaction.sign(additionalPrivateKeys)
      : signedTransaction;
  };
}

export function selectTransactionLedgerAccountIndices(
  transaction: { toJSON(): string },
  configuredIndices: ReadonlyMap<string, number>,
  inMemoryPublicKeys: ReadonlySet<string> = new Set(),
): Map<string, number> {
  const command = JSON.parse(transaction.toJSON()) as {
    feePayer: { body: { publicKey: string } };
    accountUpdates: Array<{
      body: {
        publicKey: string;
        authorizationKind: { isSigned: boolean };
      };
    }>;
  };
  const requiredPublicKeys = new Set<string>([
    command.feePayer.body.publicKey,
    ...command.accountUpdates
      .filter((update) => update.body.authorizationKind.isSigned)
      .map((update) => update.body.publicKey),
  ]);
  const transactionIndices = new Map<string, number>();
  for (const publicKey of requiredPublicKeys) {
    if (inMemoryPublicKeys.has(publicKey)) continue;
    const accountIndex = configuredIndices.get(publicKey);
    if (accountIndex === undefined) {
      throw new Error(
        `Ledger account index is required for transaction signer ${publicKey}.`,
      );
    }
    transactionIndices.set(publicKey, accountIndex);
  }
  return transactionIndices;
}
