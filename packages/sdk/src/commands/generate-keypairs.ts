import { Command } from "commander";
import { PrivateKey, Provable } from "o1js";

export function warnForDevelopmentPurposesOnly() {
  Provable.log(
    "⚠️  This command is meant for development purposes only. Do not use it in production.\n"
  );
}

export default function generateKeypairsCommandFactory(program: Command) {
  program
    .command("generate-keypairs")
    .argument<number>(
      "<number-of-keypairs>",
      "Number of keypairs to generate",
      parseInt
    )
    .action(async (numberOfKeypairs) => {
      warnForDevelopmentPurposesOnly();

      const privateKeys: PrivateKey[] = [];

      for (let i = 0; i < numberOfKeypairs; i++) {
        privateKeys.push(PrivateKey.random());
      }

      privateKeys.forEach((privateKey, index) => {
        Provable.log(`Keypair #${index + 1}:`);
        Provable.log(`Private Key: ${privateKey.toBase58()}`);
        Provable.log(`Public Key: ${privateKey.toPublicKey().toBase58()}`);
        Provable.log("");
      });
    });
}
