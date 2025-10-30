import { Command } from "commander";
import {
  AccountUpdate,
  Mina,
  PrivateKey,
  Provable,
  PublicKey,
  UInt64,
} from "o1js";

export default function transferCommandFactory(program: Command) {
  program
    .command("transfer")
    .requiredOption("--amount <amount>", "Amount to transfer", (value) =>
      UInt64.from(value)
    )
    .requiredOption(
      "--sender-private-key <sender-private-key >",
      "Sender of the transfer",
      (value) => PrivateKey.fromBase58(value)
    )
    .requiredOption(
      "--recipient-public-key <recipient-public-key>",
      "Recipient of the transfer",
      (value) => PublicKey.fromBase58(value)
    )
    .requiredOption(
      "--mina-node-url <mina-node-url>",
      "URL of the Mina node to use"
    )
    .option(
      "--fee <fee>",
      "Fee to use for the transaction",
      (value) => UInt64.from(value),
      UInt64.from(1 * 10 ** 9) // 1 MINA TODO: figure out what is the default fee
    )
    .option("--nonce <nonce>", "Nonce to use for the transaction", parseInt)
    .option("--memo <memo>", "Memo to use for the transaction")
    .action(
      async ({
        amount,
        senderPrivateKey,
        recipientPublicKey,
        minaNodeUrl,
        fee,
        nonce,
        memo,
      }: {
        amount: UInt64;
        senderPrivateKey: PrivateKey;
        recipientPublicKey: PublicKey;
        minaNodeUrl: string;
        fee: UInt64;
        nonce: number;
        memo: string;
      }) => {
        Provable.log(
          "Transferring",
          amount.toString(),
          "from",
          senderPrivateKey.toPublicKey().toBase58(),
          "to",
          recipientPublicKey.toBase58(),
          "additional options",
          { fee: fee.toString(), nonce, memo }
        );
        Mina.setActiveInstance(
          Mina.Network({
            mina: minaNodeUrl,
          })
        );
        const tx = await Mina.transaction(
          {
            sender: senderPrivateKey.toPublicKey(),
            fee,
            nonce,
            memo,
          },
          async () => {
            const senderAccountUpdate = AccountUpdate.createSigned(
              senderPrivateKey.toPublicKey()
            );
            senderAccountUpdate.balance.subInPlace(amount);

            const recipientAccountUpdate =
              AccountUpdate.create(recipientPublicKey);
            recipientAccountUpdate.balance.addInPlace(amount);

            senderAccountUpdate.approve(recipientAccountUpdate);
          }
        );

        tx.sign([senderPrivateKey]);

        console.log("sending transaction");
        const pendingTx = await tx.send();
        console.log("waiting for transaction to be included", pendingTx.hash);
        const includedTx = await pendingTx.wait();
        Provable.log("transfer successful", includedTx);
      }
    );
}
