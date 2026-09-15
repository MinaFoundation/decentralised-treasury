import type { Page } from "@playwright/test";
import type { LocalAccount } from "../../../web/e2e/utils/local-treasury-stack";
import { installAuroTestWallet } from "../../../web/e2e/utils/auro-test-wallet";

/** Delay one wallet request. Never change its transaction or submit it here. */
export function createSigningGate() {
  let pending:
    | { enter(value: unknown): void; released: Promise<void> }
    | undefined;
  return {
    hold() {
      if (pending) throw new Error("A wallet request is already held.");
      let enter!: (value: unknown) => void;
      let release!: () => void;
      let reject!: (error: Error) => void;
      const entered = new Promise<unknown>((resolve) => {
        enter = resolve;
      });
      const released = new Promise<void>((resolve, fail) => {
        release = resolve;
        reject = fail;
      });
      void released.catch(() => undefined);
      const held = { enter, released };
      pending = held;
      return {
        entered,
        release() {
          if (pending === held) pending = undefined;
          release();
        },
        cancel() {
          if (pending === held) pending = undefined;
          reject(new Error("The held wallet request was cancelled."));
        },
      };
    },
    async intercept(value: unknown) {
      const held = pending;
      if (!held) return;
      held.enter(value);
      await held.released;
    },
  };
}

export async function installHeldAuroWallet(page: Page, account: LocalAccount) {
  const wallet = await installAuroTestWallet(page, account);
  const gate = createSigningGate();
  await page.exposeFunction("__backofficeWalletGate", (request: unknown) =>
    gate.intercept(request),
  );
  return {
    ...wallet,
    async holdNextSignature() {
      // Install after navigation, when the normal wallet adapter is present.
      await page.evaluate(() => {
        const scope = window as unknown as {
          mina: {
            sendTransaction(request: unknown): Promise<unknown>;
            __gateInstalled?: boolean;
          };
          __backofficeWalletGate(request: unknown): Promise<void>;
        };
        if (scope.mina.__gateInstalled) return;
        const send = scope.mina.sendTransaction.bind(scope.mina);
        scope.mina.sendTransaction = async (request) => {
          await scope.__backofficeWalletGate(request);
          return send(request);
        };
        scope.mina.__gateInstalled = true;
      });
      return gate.hold();
    },
  };
}
