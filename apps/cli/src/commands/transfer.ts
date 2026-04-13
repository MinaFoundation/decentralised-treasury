import { Command, Option } from "commander";
import { AccountUpdate, fetchAccount, Mina, PrivateKey, PublicKey, UInt64 } from "o1js";
import { parseBooleanOption, parseIntOption } from "./option-parsers.js";
import { configureMinaNetwork } from "./mina-instance.js";

function parsePrivateKey(value: string): PrivateKey {
  return PrivateKey.fromBase58(value);
}

function parsePublicKey(value: string): PublicKey {
  return PublicKey.fromBase58(value);
}

interface TransferCommandOptions {
  minaNodeUrl: string;
  senderPrivateKey: PrivateKey;
  fundingPrivateKey?: PrivateKey;
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

async function readAccountSnapshot(publicKey: PublicKey): Promise<AccountSnapshot> {
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
  configureMinaNetwork(options.minaNodeUrl);

  const senderPublicKey = options.senderPrivateKey.toPublicKey();
  const fundingPrivateKey = options.fundingPrivateKey ?? options.senderPrivateKey;
  const fundingPublicKey = fundingPrivateKey.toPublicKey();
  const [senderSnapshot, fundingSnapshot, recipientSnapshot] = await Promise.all([
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

  const signers = [options.senderPrivateKey];
  if (!senderPublicKey.equals(fundingPublicKey).toBoolean()) {
    signers.push(fundingPrivateKey);
  }

  transaction.sign(signers);

  let pendingTransaction;
  try {
    pendingTransaction = await transaction.send();
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
      new Option("--mina-node-url <mina-node-url>", "Mina GraphQL URL")
        .env("MINA_NODE_URL")
        .default("http://127.0.0.1:8080/graphql"),
    )
    .addOption(
      new Option("--sender-private-key <sender-private-key>", "Sender private key")
        .env("SENDER_PRIVATE_KEY")
        .argParser(parsePrivateKey)
        .makeOptionMandatory(),
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
