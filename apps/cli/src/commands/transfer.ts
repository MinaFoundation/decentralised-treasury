import { Command, Option } from "commander";
import {
  AccountUpdate,
  fetchAccount,
  Mina,
  PrivateKey,
  PublicKey,
  UInt64,
} from "o1js";
import { parseBooleanOption, parseIntOption } from "./option-parsers.js";
import {
  configureMinaNetwork,
  minaNetworkIdOption,
  type MinaNetworkId,
} from "./mina-instance.js";
import { signTxWithLedger } from "../ledger/ledger-signing.js";

type SignerMode = "in-memory" | "ledger";

function parsePrivateKey(value: string): PrivateKey {
  return PrivateKey.fromBase58(value);
}

function parsePublicKey(value: string): PublicKey {
  return PublicKey.fromBase58(value);
}

interface TransferCommandOptions {
  minaNodeUrl: string;
  networkId: MinaNetworkId;
  signer: SignerMode;
  senderPrivateKey?: PrivateKey;
  senderPublicKey?: PublicKey;
  senderLedgerAccountIndex?: number;
  fundingPrivateKey?: PrivateKey;
  fundingPublicKey?: PublicKey;
  fundingLedgerAccountIndex?: number;
  recipientPublicKey: PublicKey;
  amount: UInt64;
  fee?: UInt64;
  nonce?: number;
  memo?: string;
  wait: boolean;
}

interface AccountSnapshot {
  publicKey: string;
  found: boolean;
  balance?: string;
  nonce?: string;
  error?: string;
}

async function readAccountSnapshot(
  publicKey: PublicKey,
): Promise<AccountSnapshot> {
  const { account, error } = await fetchAccount({ publicKey });
  return {
    publicKey: publicKey.toBase58(),
    found: Boolean(account),
    balance: account?.balance.toString(),
    nonce: account?.nonce.toString(),
    error: error ? String(error) : undefined,
  };
}

export async function transfer(options: TransferCommandOptions): Promise<void> {
  configureMinaNetwork(options.minaNodeUrl, options.networkId);

  const senderPublicKey =
    options.signer === "ledger"
      ? options.senderPublicKey
      : options.senderPrivateKey?.toPublicKey();
  if (!senderPublicKey) {
    throw new Error(
      options.signer === "ledger"
        ? "--sender-public-key is required when --signer=ledger."
        : "--sender-private-key is required when --signer=in-memory.",
    );
  }
  if (
    options.signer === "ledger" &&
    options.senderLedgerAccountIndex === undefined
  ) {
    throw new Error(
      "--sender-ledger-account-index is required when --signer=ledger.",
    );
  }
  const fundingPrivateKey =
    options.fundingPrivateKey ?? options.senderPrivateKey;
  const fundingPublicKey =
    options.signer === "ledger"
      ? (options.fundingPublicKey ?? senderPublicKey)
      : fundingPrivateKey?.toPublicKey();
  if (!fundingPublicKey) {
    throw new Error(
      "--funding-private-key is invalid without an in-memory sender private key.",
    );
  }
  const fundingLedgerAccountIndex = senderPublicKey
    .equals(fundingPublicKey)
    .toBoolean()
    ? options.senderLedgerAccountIndex
    : options.fundingLedgerAccountIndex;
  if (options.signer === "ledger" && fundingLedgerAccountIndex === undefined) {
    throw new Error(
      "--funding-ledger-account-index is required for a different Ledger funding account.",
    );
  }
  const [senderSnapshot, fundingSnapshot, recipientSnapshot] =
    await Promise.all([
      readAccountSnapshot(senderPublicKey),
      senderPublicKey.equals(fundingPublicKey).toBoolean()
        ? Promise.resolve<AccountSnapshot | null>(null)
        : readAccountSnapshot(fundingPublicKey),
      readAccountSnapshot(options.recipientPublicKey),
    ]);

  if (!senderSnapshot.found) {
    throw new Error(
      `Sender account ${senderSnapshot.publicKey} was not found on ${options.minaNodeUrl}.`,
    );
  }
  if (fundingSnapshot && !fundingSnapshot.found) {
    throw new Error(
      `Funding account ${fundingSnapshot.publicKey} was not found on ${options.minaNodeUrl}.`,
    );
  }

  const transaction = await Mina.transaction(
    {
      sender: senderPublicKey,
      fee: options.fee,
      nonce: options.nonce,
      memo: options.memo,
    },
    async () => {
      if (!recipientSnapshot.found) {
        AccountUpdate.fundNewAccount(senderPublicKey, 1);
      }
      const fundingAccountUpdate = AccountUpdate.createSigned(fundingPublicKey);
      fundingAccountUpdate.send({
        to: options.recipientPublicKey,
        amount: options.amount,
      });
    },
  );

  const signedTransaction =
    options.signer === "ledger"
      ? await signTxWithLedger(
          transaction,
          new Map([
            [senderPublicKey.toBase58(), options.senderLedgerAccountIndex!],
            [fundingPublicKey.toBase58(), fundingLedgerAccountIndex!],
          ]),
          options.networkId,
        )
      : transaction.sign(
          senderPublicKey.equals(fundingPublicKey).toBoolean()
            ? [options.senderPrivateKey!]
            : [options.senderPrivateKey!, fundingPrivateKey!],
        );

  let pendingTransaction;
  try {
    pendingTransaction = await signedTransaction.send();
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          minaNodeUrl: options.minaNodeUrl,
          sender: senderSnapshot,
          fundingAccount: fundingSnapshot ?? senderSnapshot,
          recipient: recipientSnapshot,
          amount: options.amount.toString(),
          fee: options.fee?.toString(),
          nonce: options.nonce,
          memo: options.memo,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    throw error;
  }
  if (options.wait && pendingTransaction.wait) {
    await pendingTransaction.wait();
  }

  console.log(
    JSON.stringify({
      sender: senderPublicKey.toBase58(),
      fundingAccount: fundingPublicKey.toBase58(),
      from: fundingPublicKey.toBase58(),
      to: options.recipientPublicKey.toBase58(),
      amount: options.amount.toString(),
      transferTxHash: pendingTransaction.hash,
    }),
  );
}

export default function transferCommandFactory(program: Command) {
  program
    .command("transfer")
    .description("Transfer MINA from a funding account to a recipient")
    .addOption(
      new Option("--signer <signer>", "Signing implementation")
        .choices(["in-memory", "ledger"])
        .default("in-memory")
        .env("SIGNER"),
    )
    .addOption(
      new Option("--mina-node-url <mina-node-url>", "Mina GraphQL URL")
        .env("MINA_NODE_URL")
        .default("http://127.0.0.1:8080/graphql"),
    )
    .addOption(minaNetworkIdOption())
    .addOption(
      new Option(
        "--sender-private-key <sender-private-key>",
        "Sender private key",
      )
        .env("SENDER_PRIVATE_KEY")
        .argParser(parsePrivateKey),
    )
    .addOption(
      new Option(
        "--sender-public-key <sender-public-key>",
        "Ledger sender public key",
      )
        .env("SENDER_PUBLIC_KEY")
        .argParser(parsePublicKey),
    )
    .addOption(
      new Option(
        "--sender-ledger-account-index <sender-ledger-account-index>",
        "Ledger account index for the fee payer",
      )
        .env("SENDER_LEDGER_ACCOUNT_INDEX")
        .argParser(parseIntOption),
    )
    .addOption(
      new Option(
        "--funding-private-key <funding-private-key>",
        "Funding account private key (defaults to sender private key)",
      )
        .env("FUNDING_PRIVATE_KEY")
        .argParser(parsePrivateKey),
    )
    .addOption(
      new Option(
        "--funding-public-key <funding-public-key>",
        "Ledger funding public key (defaults to sender public key)",
      )
        .env("FUNDING_PUBLIC_KEY")
        .argParser(parsePublicKey),
    )
    .addOption(
      new Option(
        "--funding-ledger-account-index <funding-ledger-account-index>",
        "Ledger account index for a different funding account",
      )
        .env("FUNDING_LEDGER_ACCOUNT_INDEX")
        .argParser(parseIntOption),
    )
    .addOption(
      new Option(
        "--recipient-public-key <recipient-public-key>",
        "Recipient public key",
      )
        .env("RECIPIENT_PUBLIC_KEY")
        .argParser(parsePublicKey)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--amount <amount>", "Transfer amount in nanomina")
        .env("TRANSFER_AMOUNT")
        .argParser((value) => UInt64.from(value))
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--fee <fee>", "Transaction fee in nanomina")
        .env("TX_FEE")
        .argParser((value) => UInt64.from(value))
        .default(UInt64.from(1 * 10 ** 9)),
    )
    .addOption(
      new Option("--nonce <nonce>", "Nonce to use for the transaction")
        .env("TX_NONCE")
        .argParser(parseIntOption),
    )
    .addOption(
      new Option("--memo <memo>", "Memo to use for transaction").env("TX_MEMO"),
    )
    .addOption(
      new Option("--wait <wait>", "Wait for transaction inclusion")
        .env("TX_WAIT")
        .argParser(parseBooleanOption)
        .default(true),
    )
    .action(transfer);
}
