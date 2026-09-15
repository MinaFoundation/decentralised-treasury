import { Command, InvalidArgumentError, Option } from "commander";
import { PrivateKey, PublicKey } from "o1js";
import {
  createInMemoryTransactionSigner,
  transactionSigningPublicKeys,
  type TransactionSigner,
} from "@repo/sdk/src/services/transaction-signing.js";
import { signTxWithLedger } from "./ledger-signing.js";
import { logTransactionForSigning } from "./signing-progress.js";

type LedgerNetworkId = "mainnet" | "devnet" | "testnet";

export type SignerMode = "in-memory" | "ledger";

export function logWaitingForSignatures(signer: SignerMode): void {
  // Keep progress messages separate from command results on stdout.
  console.error(
    signer === "ledger"
      ? "[signing] Waiting for signatures from Ledger. Review and approve each signature request on your Ledger device."
      : "[signing] Waiting for signatures from in-memory keys.",
  );
}

export type ResolvedSigningAccount = {
  label: string;
  publicKey: PublicKey;
} & (
  | { signer: "in-memory"; privateKey: PrivateKey; ledgerAccountIndex?: never }
  | { signer: "ledger"; ledgerAccountIndex: number; privateKey?: never }
);

function parsePublicKey(value: string): PublicKey {
  return PublicKey.fromBase58(value);
}

function optionName(role: string, suffix: string): string {
  return `--${role}-${suffix}`;
}

function environmentName(role: string, suffix: string): string {
  return `${role}-${suffix}`.replaceAll("-", "_").toUpperCase();
}

interface SigningRoleOptions {
  privateKey: string;
  publicKey: string;
  ledgerAccountIndex: string;
  optionalInMemory?: boolean;
  optionalLedger?: boolean;
}

export function configureSigningOptions(
  command: Command,
  roles: SigningRoleOptions[],
): void {
  const option = (name: string) =>
    command.options.find((candidate) => candidate.attributeName() === name)!;
  for (const role of roles) {
    option(role.privateKey).conflicts([
      role.publicKey,
      role.ledgerAccountIndex,
    ]);
    option(role.ledgerAccountIndex).argParser((value) => {
      const index = Number(value);
      if (
        value.trim() === "" ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index > 0xffff_ffff
      ) {
        throw new InvalidArgumentError(
          "Ledger account index must be an integer from 0 through 4294967295.",
        );
      }
      return index;
    });
  }
  command.hook("preAction", () => {
    const options = command.opts();
    for (const role of roles) {
      const ledger = options.signer === "ledger";
      const required = ledger
        ? [role.publicKey, role.ledgerAccountIndex]
        : [role.privateKey];
      const forbidden = ledger
        ? [role.privateKey]
        : [role.publicKey, role.ledgerAccountIndex];
      for (const name of forbidden) {
        if (options[name] !== undefined) {
          command.error(
            `${option(name).long} cannot be used when --signer=${options.signer}.`,
          );
        }
      }
      const optional = ledger ? role.optionalLedger : role.optionalInMemory;
      if (optional && required.every((name) => options[name] === undefined))
        continue;
      for (const name of required) {
        if (options[name] === undefined) {
          command.error(
            `${option(name).long} is required when --signer=${options.signer}.`,
          );
        }
      }
    }
  });
}

export function addTransactionSignerOptions(
  command: Command,
  roles: Array<{
    role: string;
    label: string;
    optionalInMemory?: boolean;
    optionalLedger?: boolean;
  }>,
): Command {
  command.addOption(
    new Option("--signer <signer>", "Signing implementation")
      .choices(["in-memory", "ledger"])
      .default("in-memory")
      .env("SIGNER"),
  );
  const signingRoles = roles.map(
    ({ role, label, optionalInMemory, optionalLedger }) => {
      const publicKey = new Option(
        optionName(role, "public-key") + ` <${role}-public-key>`,
        `${label} public key for Ledger signing`,
      )
        .env(environmentName(role, "public-key"))
        .argParser(parsePublicKey);
      const ledgerAccountIndex = new Option(
        optionName(role, "ledger-account-index") +
          ` <${role}-ledger-account-index>`,
        `Ledger account index for ${label.toLowerCase()}`,
      ).env(environmentName(role, "ledger-account-index"));
      command.addOption(publicKey).addOption(ledgerAccountIndex);
      const privateKey = command.options.find(
        (option) => option.long === optionName(role, "private-key"),
      )!;
      return {
        privateKey: privateKey.attributeName(),
        publicKey: publicKey.attributeName(),
        ledgerAccountIndex: ledgerAccountIndex.attributeName(),
        optionalInMemory,
        optionalLedger,
      };
    },
  );
  configureSigningOptions(command, signingRoles);
  return command;
}

// Commander validates these options before the command action runs.
export function resolveSigningAccount(options: {
  signer: SignerMode;
  label: string;
  privateKey?: PrivateKey;
  publicKey?: PublicKey;
  ledgerAccountIndex?: number;
}): ResolvedSigningAccount {
  return options.signer === "ledger"
    ? {
        signer: "ledger",
        label: options.label,
        publicKey: options.publicKey!,
        ledgerAccountIndex: options.ledgerAccountIndex!,
      }
    : {
        signer: "in-memory",
        label: options.label,
        publicKey: options.privateKey!.toPublicKey(),
        privateKey: options.privateKey!,
      };
}

export function createTransactionSigner(
  accounts: ResolvedSigningAccount[],
  networkId?: LedgerNetworkId,
  ledgerSignTransaction: typeof signTxWithLedger = signTxWithLedger,
): TransactionSigner {
  const signer = accounts[0]?.signer;
  if (!signer || accounts.some((account) => account.signer !== signer)) {
    throw new Error("All signing accounts must use the same signer.");
  }
  if (accounts.every((account) => account.signer === "in-memory")) {
    const signTransaction = createInMemoryTransactionSigner(
      accounts.map((account) => account.privateKey),
    );
    return async (transaction) => {
      await logTransactionForSigning(transaction);
      logWaitingForSignatures("in-memory");
      return signTransaction(transaction);
    };
  }
  const indices = new Map<string, number>();
  const publicKeyByIndex = new Map<number, string>();
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
    );
    await logTransactionForSigning(transaction);
    logWaitingForSignatures("ledger");
    return ledgerSignTransaction(transaction, transactionIndices, networkId);
  };
}

export function selectTransactionLedgerAccountIndices(
  transaction: { toJSON(): string },
  configuredIndices: ReadonlyMap<string, number>,
): Map<string, number> {
  const requiredPublicKeys = transactionSigningPublicKeys(transaction);
  const transactionIndices = new Map<string, number>();
  for (const publicKey of requiredPublicKeys) {
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
