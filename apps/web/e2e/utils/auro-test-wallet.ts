import { createHash } from "node:crypto";
import { Mina, PrivateKey } from "o1js";
import type { Page } from "@playwright/test";
import type { LocalAccount } from "./local-treasury-stack";

type SigningRequest = {
  onlySign?: boolean;
  transaction: string | object;
  feePayer?: { fee?: number; memo?: string };
  nonce?: number;
};

/** The adapter replaces only window.mina. The application submits the signed command. */
export async function installAuroTestWallet(page: Page, account: LocalAccount) {
  let rejection: string | undefined;
  let selectedAccount = account.publicKey;
  const signedTransactions: Array<{ digest: string; command: unknown }> = [];
  await page.exposeFunction("__localAuroAccounts", () => [selectedAccount]);
  await page.exposeFunction(
    "__localAuroSign",
    async (input: SigningRequest) => {
      if (rejection) return { code: 1002, message: rejection };
      if (input.onlySign !== true)
        throw new Error("The app must submit its own transaction.");
      const json =
        typeof input.transaction === "string"
          ? input.transaction
          : JSON.stringify(input.transaction);
      const command = JSON.parse(json);
      if (command.feePayer?.body?.publicKey !== account.publicKey) {
        throw new Error(
          "The app-built fee payer does not match the funded test wallet.",
        );
      }
      // Sign the exact app command. Do not build, prove, change fees, or submit here.
      Mina.setActiveInstance(
        Mina.Network({
          mina: "http://127.0.0.1:1/graphql",
          networkId: "devnet",
        }),
      );
      const transaction = Mina.Transaction.fromJSON(json);
      transaction.transaction.feePayer.lazyAuthorization = {
        kind: "lazy-signature",
      };
      for (const update of transaction.transaction.accountUpdates) {
        if (
          update.body.publicKey.toBase58() === account.publicKey &&
          update.body.authorizationKind.isSigned.toBoolean()
        ) {
          update.lazyAuthorization = { kind: "lazy-signature" };
        }
      }
      transaction.sign([PrivateKey.fromBase58(account.privateKey)]);
      const signed = JSON.parse(transaction.toJSON());
      if (
        JSON.stringify(
          signed.accountUpdates.map((update: { body: unknown }) => update.body),
        ) !==
          JSON.stringify(
            command.accountUpdates.map(
              (update: { body: unknown }) => update.body,
            ),
          ) ||
        JSON.stringify(signed.feePayer.body) !==
          JSON.stringify(command.feePayer.body) ||
        signed.memo !== command.memo
      ) {
        throw new Error("Wallet signing changed the app transaction payload.");
      }
      signedTransactions.push({
        digest: createHash("sha256").update(json).digest("hex"),
        command: signed,
      });
      return { signedData: { zkappCommand: signed } };
    },
  );
  await page.addInitScript(() => {
    const listeners = new Map<string, Set<(accounts: string[]) => void>>();
    const bridge = window as unknown as {
      mina: unknown;
      __localAuroAccounts(): Promise<string[]>;
      __localAuroSign(input: unknown): Promise<unknown>;
      __localAuroEmitAccounts(accounts: string[]): void;
    };
    bridge.__localAuroEmitAccounts = (accounts) => {
      for (const listener of listeners.get("accountsChanged") ?? [])
        listener(accounts);
    };
    bridge.mina = {
      requestAccounts: () => bridge.__localAuroAccounts(),
      sendTransaction: (input: unknown) => bridge.__localAuroSign(input),
      on(event: string, listener: (accounts: string[]) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(listener);
      },
      removeListener(event: string, listener: (accounts: string[]) => void) {
        listeners.get(event)?.delete(listener);
      },
    };
  });
  return {
    signedTransactions,
    rejectSigning(message = "The user rejected the transaction.") {
      rejection = message;
    },
    allowSigning() {
      rejection = undefined;
    },
    changeAccount(publicKey: string) {
      selectedAccount = publicKey;
    },
    async notifyAccountChange(publicKey: string) {
      selectedAccount = publicKey;
      await page.evaluate((address) => {
        (
          window as unknown as {
            __localAuroEmitAccounts(accounts: string[]): void;
          }
        ).__localAuroEmitAccounts([address]);
      }, publicKey);
    },
  };
}
