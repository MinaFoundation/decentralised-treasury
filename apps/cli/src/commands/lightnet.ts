import { Command, Option } from "commander";
import { fetchAccount, Lightnet, Mina, PublicKey } from "o1js";

interface AcquireLightnetAccountOptions {
  minaNodeUrl: string;
  lightnetAccountManagerEndpoint: string;
}

export async function acquireLightnetAccount({
  minaNodeUrl,
  lightnetAccountManagerEndpoint,
}: AcquireLightnetAccountOptions): Promise<void> {
  const keypair = await Lightnet.acquireKeyPair({
    lightnetAccountManagerEndpoint,
  });

  const publicKeyBase58 =
    typeof keypair.publicKey === "string"
      ? keypair.publicKey
      : keypair.publicKey.toBase58();

  Mina.setActiveInstance(
    Mina.Network({
      mina: minaNodeUrl,
      networkId: "devnet",
      lightnetAccountManager: lightnetAccountManagerEndpoint,
    }),
  );

  const { account, error } = await fetchAccount({
    publicKey: PublicKey.fromBase58(publicKeyBase58),
  });
  if (error) throw error;

  console.log(
    JSON.stringify({
      publicKey: publicKeyBase58,
      privateKey: keypair.privateKey.toBase58(),
      balance: account.balance.toString(),
    }),
  );
}

export default function lightnetCommandFactory(program: Command) {
  const command = program.command("lightnet");

  command
    .command("acquire-account")
    .addOption(
      new Option("--mina-node-url <mina-node-url>", "Mina GraphQL URL")
        .env("MINA_NODE_URL")
        .default("http://127.0.0.1:8080/graphql"),
    )
    .addOption(
      new Option(
        "--lightnet-account-manager-endpoint <lightnet-account-manager-endpoint>",
        "Lightnet account manager endpoint",
      )
        .env("LIGHTNET_ACCOUNT_MANAGER_ENDPOINT")
        .default("http://127.0.0.1:8181"),
    )
    .action(acquireLightnetAccount);
}
