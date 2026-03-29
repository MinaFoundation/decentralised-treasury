import { Command } from "commander";
import { fetchAccount, Lightnet, Mina, Provable } from "o1js";

export default function lightnetAcquireKeyPairCommandFactory(program: Command) {
  program
    .command("lightnet-acquire-key-pair")
    .requiredOption("--mina-node-url <mina-node-url>", "Mina node URL")
    .requiredOption(
      "--lightnet-account-manager-endpoint <lightnet-account-manager-endpoint>",
      "Lightnet account manager endpoint"
    )
    .action(
      async ({
        minaNodeUrl,
        lightnetAccountManagerEndpoint,
      }: {
        minaNodeUrl: string;
        lightnetAccountManagerEndpoint: string;
      }) => {
        const keypair = await Lightnet.acquireKeyPair({
          lightnetAccountManagerEndpoint,
        });

        Provable.log({
          publicKey: keypair.publicKey,
          privateKey: keypair.privateKey.toBase58(),
        });

        Mina.setActiveInstance(
          Mina.Network({
            mina: minaNodeUrl,
            lightnetAccountManager: lightnetAccountManagerEndpoint,
          })
        );

        const { account, error } = await fetchAccount({
          publicKey: keypair.publicKey,
        });

        if (error) throw error;
        Provable.log("balance:", account.balance.div(10 ** 9), "$MINA");
      }
    );
}
