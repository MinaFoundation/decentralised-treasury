// @vitest-environment node
import { expect, it, vi } from "vitest";
import { AccountUpdate, Mina, PrivateKey } from "o1js";
import type { Page } from "@playwright/test";
import { installAuroTestWallet } from "../../../e2e/utils/auro-test-wallet";

it("signs serialized fee payer and account updates without changing the payload", async () => {
  const local = await Mina.LocalBlockchain({ proofsEnabled: false });
  Mina.setActiveInstance(local);
  const [sender, recipient] = local.testAccounts;
  const transaction = await Mina.transaction(
    { sender, fee: 100_000_000 },
    async () => {
      AccountUpdate.createSigned(sender).send({ to: recipient, amount: 123 });
    },
  );
  const callbacks = new Map<string, (input: unknown) => Promise<unknown>>();
  const page = {
    exposeFunction: async (
      name: string,
      callback: (input: unknown) => Promise<unknown>,
    ) => {
      callbacks.set(name, callback);
    },
    addInitScript: async () => {},
  } as unknown as Page;
  const wallet = await installAuroTestWallet(page, {
    publicKey: sender.toBase58(),
    privateKey: sender.key.toBase58(),
  });
  const result = (await callbacks.get("__localAuroSign")!({
    onlySign: true,
    transaction: transaction.toJSON(),
  })) as { signedData: { zkappCommand: object } };
  expect(wallet.signedTransactions).toHaveLength(1);
  Mina.setActiveInstance(local);
  const signed = Mina.Transaction.fromJSON(
    result.signedData.zkappCommand as never,
  );
  const pending = await signed.send();
  expect(pending.status).toBe("pending");
  await pending.wait();
  expect(Mina.getAccount(sender).nonce.toString()).toBe("1");
}, 30_000);

it("delivers and removes real extension-boundary account notifications", async () => {
  const bridge: Record<string, unknown> = {};
  vi.stubGlobal("window", bridge);
  const page = {
    exposeFunction: async (name: string, callback: unknown) => {
      bridge[name] = callback;
    },
    addInitScript: async (initialize: () => void) => initialize(),
    evaluate: async (callback: (value: string) => void, value: string) =>
      callback(value),
  } as unknown as Page;
  const first = PrivateKey.fromBigInt(41n);
  const secondAddress = PrivateKey.fromBigInt(42n).toPublicKey().toBase58();
  try {
    const wallet = await installAuroTestWallet(page, {
      publicKey: first.toPublicKey().toBase58(),
      privateKey: first.toBase58(),
    });
    const provider = bridge.mina as {
      requestAccounts(): Promise<string[]>;
      on(event: string, listener: (accounts: string[]) => void): void;
      removeListener(
        event: string,
        listener: (accounts: string[]) => void,
      ): void;
    };
    const received: string[][] = [];
    const listener = (accounts: string[]) => received.push(accounts);
    provider.on("accountsChanged", listener);
    wallet.changeAccount(secondAddress);
    expect(await provider.requestAccounts()).toEqual([secondAddress]);
    expect(received).toEqual([]);
    await wallet.notifyAccountChange(secondAddress);
    expect(received).toEqual([[secondAddress]]);
    provider.removeListener("accountsChanged", listener);
    await wallet.notifyAccountChange(first.toPublicKey().toBase58());
    expect(received).toEqual([[secondAddress]]);
    expect(await provider.requestAccounts()).toEqual([
      first.toPublicKey().toBase58(),
    ]);
    expect(wallet.signedTransactions).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});
