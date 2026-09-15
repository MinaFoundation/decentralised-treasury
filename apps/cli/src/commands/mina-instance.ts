import { Option } from "commander";
import {
  Mina,
  type PendingTransaction,
  type PrivateKey,
  type Transaction,
  type TransactionPromise,
} from "o1js";

export type MinaNetworkId = "mainnet" | "devnet" | "testnet";

// o1js retains these methods at runtime after signing and proving.
type RuntimeTransaction = Transaction<false, false> & Transaction<true, true>;

function withTransactionMethods<Proven extends boolean, Signed extends boolean>(
  pending: Promise<Transaction<Proven, Signed>>,
): TransactionPromise<Proven, Signed> {
  const runtime = pending as unknown as Promise<RuntimeTransaction>;
  return Object.assign(pending, {
    sign: (keys: PrivateKey[]) =>
      withTransactionMethods(
        runtime.then((transaction) => transaction.sign(keys)),
      ),
    prove: () =>
      withTransactionMethods(
        runtime.then((transaction) => transaction.prove()),
      ),
    proofs: () => runtime.then((transaction) => transaction.proofs),
    send: () => {
      const sent = runtime.then((transaction) => transaction.send());
      return Object.assign(sent, {
        wait: (options?: Parameters<PendingTransaction["wait"]>[0]) =>
          sent.then((transaction) => transaction.wait(options)),
      });
    },
  }) as unknown as TransactionPromise<Proven, Signed>;
}

export function minaNetworkIdOption(): Option {
  return new Option("--network-id <network-id>", "Mina signature network")
    .choices(["mainnet", "devnet", "testnet"])
    .argParser((value) => value.toLowerCase())
    .env("MINA_NETWORK_ID")
    .default("devnet");
}

export function configureMinaNetwork(
  minaNodeUrl: string,
  networkId: MinaNetworkId,
): void {
  const network = Mina.Network({ mina: minaNodeUrl, networkId });
  if (process.env.PROOFS_ENABLED === "false") {
    network.proofsEnabled = false;
    const createTransaction = network.transaction.bind(network);
    network.transaction = (sender, callback) =>
      withTransactionMethods(
        createTransaction(sender, callback).then((original) => {
          // Mina.Network ignores proofsEnabled when it creates a transaction.
          // fromJSON reads the active instance's flag. Restore authorization
          // metadata because JSON does not retain pending proofs or signatures.
          const transaction = Mina.Transaction.fromJSON(original.toJSON());
          transaction.transaction.feePayer.lazyAuthorization =
            original.transaction.feePayer.lazyAuthorization;
          original.transaction.accountUpdates.forEach((update, index) => {
            transaction.transaction.accountUpdates[index]!.lazyAuthorization =
              update.lazyAuthorization;
          });
          return transaction;
        }),
      );
  }
  Mina.setActiveInstance(network);
}
