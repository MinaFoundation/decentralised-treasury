import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import { createLocalBlockchainHttpServer } from "../src/http/local-blockchain-http-server.js";
import { AccountUpdate, Mina } from "../src/o1js.js";
import { sendZkapp } from "../../sdk/node_modules/o1js/dist/node/lib/mina/v1/fetch.js";
import { proofMode, proofsEnabled } from "./proof-mode.js";

async function availablePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

for (const transport of ["HTTP", "o1js"] as const) {
  test(
    `${transport} exposes a rejected nonce without changing chain state (PROOFS_ENABLED=${proofMode})`,
    { timeout: 30_000 },
    async (t) => {
      const port = await availablePort();
      const server = await createLocalBlockchainHttpServer({
        port,
        proofsEnabled,
      });
      await server.start();
      t.after(() => server.stop());
      assert.equal(server.runtime.proofsEnabled, proofsEnabled);
      const [sender, recipient] = server.runtime.blockchain.testAccounts;
      assert.ok(sender && recipient);
      Mina.setActiveInstance(server.runtime.blockchain);
      const transaction = await Mina.transaction(
        { sender, nonce: 1 },
        async () => {
          AccountUpdate.createSigned(sender).send({ to: recipient, amount: 1 });
        },
      );
      transaction.sign([sender.key]);
      const state = () => ({
        network: server.runtime.getNetworkStateSummary(),
        receipts: server.runtime.getReceipts(),
        sender: server.runtime.getAccount(sender.toBase58()),
        recipient: server.runtime.getAccount(recipient.toBase58()),
      });
      const before = state();
      const url = `http://127.0.0.1:${port}/graphql`;
      if (transport === "HTTP") {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query:
              "mutation Submit($input: SendZkappInput!) { sendZkapp(input: $input) { zkapp { hash } } }",
            variables: {
              input: { zkappCommand: JSON.parse(transaction.toJSON()) },
            },
          }),
        });
        const payload = (await response.json()) as {
          data?: { sendZkapp: unknown };
          errors?: { message: string }[];
        };
        assert.deepEqual(state(), before);
        assert.equal(response.status, 200);
        assert.equal(payload.data?.sendZkapp, null);
        assert.match(payload.errors?.[0]?.message ?? "", /nonce/iu);
      } else {
        const [result, error] = await sendZkapp(transaction.toJSON(), url);
        assert.deepEqual(state(), before);
        assert.equal(result, undefined);
        assert.equal(error?.statusCode, 200);
        assert.match(error?.statusText ?? "", /nonce/iu);
      }
    },
  );
}
