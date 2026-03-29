import { Command } from "commander";
import { PrivateKey, Provable } from "o1js";

interface GeneratedKeypair {
  privateKey: string;
  publicKey: string;
}

interface GenerateKeypairsOptions {
  json?: boolean;
}

interface GenerateKeypairOptions {
  json?: boolean;
}

export function warnForDevelopmentPurposesOnly() {
  Provable.log(
    "This command is meant for development purposes only. Do not use it in production.\n"
  );
}

export default function generateKeypairsCommandFactory(program: Command) {
  program
    .command("generate-keypair")
    .description("Generate one keypair for manual env values")
    .option(
      "--json",
      "Output generated keypair as machine-readable JSON",
      false
    )
    .action(async (options: GenerateKeypairOptions) => {
      const privateKey = PrivateKey.random();
      const keypair: GeneratedKeypair = {
        privateKey: privateKey.toBase58(),
        publicKey: privateKey.toPublicKey().toBase58(),
      };

      if (options.json) {
        console.log(JSON.stringify(keypair));
        return;
      }

      warnForDevelopmentPurposesOnly();
      // Easy copy/paste into .env files.
      console.log(`PRIVATE_KEY=${keypair.privateKey}`);
      console.log(`PUBLIC_KEY=${keypair.publicKey}`);
    });

  program
    .command("generate-keypairs")
    .argument<number>(
      "<number-of-keypairs>",
      "Number of keypairs to generate",
      parseInt
    )
    .option(
      "--json",
      "Output generated keypairs as machine-readable JSON",
      false
    )
    .action(async (numberOfKeypairs: number, options: GenerateKeypairsOptions) => {
      const keypairs: GeneratedKeypair[] = Array.from(
        { length: numberOfKeypairs },
        () => {
          const privateKey = PrivateKey.random();
          return {
            privateKey: privateKey.toBase58(),
            publicKey: privateKey.toPublicKey().toBase58(),
          };
        }
      );

      if (options.json) {
        console.log(JSON.stringify({ keypairs }));
        return;
      }

      warnForDevelopmentPurposesOnly();
      keypairs.forEach((keypair, index) => {
        Provable.log(`Keypair #${index + 1}:`);
        Provable.log(`Private Key: ${keypair.privateKey}`);
        Provable.log(`Public Key: ${keypair.publicKey}`);
        Provable.log("");
      });
    });
}
