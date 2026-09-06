import { createRequire } from "node:module";
import { MinaApp } from "@zondax/ledger-mina-js";
import { Field, PublicKey, Transaction } from "o1js";
import {
  type LedgerAccountIndices,
  signFieldWithLedgerClient,
  signTransactionWithLedgerClient,
} from "@repo/sdk/src/signing/ledger-signing.js";

type LedgerNetworkId = "mainnet" | "devnet" | "testnet";

async function withLedger<T>(
  operation: (ledger: MinaApp) => Promise<T>,
): Promise<T> {
  const require = createRequire(import.meta.url);
  const TransportNodeHid = (
    require("@ledgerhq/hw-transport-node-hid") as {
      default: typeof import("@ledgerhq/hw-transport-node-hid").default;
    }
  ).default;
  const transport = await TransportNodeHid.open(null);
  try {
    return await operation(new MinaApp(transport));
  } finally {
    await transport.close();
  }
}

/** Sign all required zkApp authorization slots with the connected Ledger. */
export async function signTxWithLedger(
  transaction: { toJSON(): string },
  accountIndices: LedgerAccountIndices,
  networkId?: LedgerNetworkId,
): Promise<ReturnType<typeof Transaction.fromJSON>> {
  return await withLedger((ledger) =>
    signTransactionWithLedgerClient(
      transaction,
      ledger,
      accountIndices,
      networkId,
    ),
  );
}

/** Sign one break-glass field with the configured Ledger public key. */
export async function signFieldWithLedger(
  field: Field,
  expectedPublicKey: PublicKey,
  accountIndex: number,
) {
  return await withLedger((ledger) =>
    signFieldWithLedgerClient(field, ledger, expectedPublicKey, accountIndex),
  );
}
