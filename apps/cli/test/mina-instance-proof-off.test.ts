import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";
import {
  AccountUpdate,
  declareMethods,
  fetchAccount,
  Mina,
  Permissions,
  PrivateKey,
  SmartContract,
  VerificationKey,
} from "o1js";
import { configureMinaNetwork } from "../src/commands/mina-instance.js";

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

const updatedUri = "https://example.com/proof-off-adapter";

class ProofOffContract extends SmartContract {
  async changeUri() {
    this.account.zkappUri.set(updatedUri);
  }
}
declareMethods(ProofOffContract, { changeUri: [] });

test(
  "proof-off CLI transactions preserve signatures and submit dummy proofs over HTTP",
  {
    timeout: 60_000,
  },
  async () => {
    const nodePort = await availablePort();
    const archivePort = await availablePort();
    const server = spawn(
      process.execPath,
      ["--loader", "../sdk/node_modules/ts-node/esm.mjs", "src/server.ts"],
      {
        cwd: new URL("../../../packages/local-blockchain/", import.meta.url),
        env: {
          ...process.env,
          PROOFS_ENABLED: "false",
          NODE_NO_WARNINGS: "1",
          MINA_NODE_PORT: String(nodePort),
          MINA_ARCHIVE_PORT: String(archivePort),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let serverOutput = "";
    server.stdout.on("data", (chunk) => (serverOutput += chunk.toString()));
    server.stderr.on("data", (chunk) => (serverOutput += chunk.toString()));
    const exited = new Promise<void>((resolve) =>
      server.once("close", () => resolve()),
    );
    const previousProofsEnabled = process.env.PROOFS_ENABLED;
    const baseUrl = `http://127.0.0.1:${nodePort}`;

    try {
      let ready = false;
      for (let attempt = 0; attempt < 120; attempt++) {
        try {
          ready = (await fetch(`${baseUrl}/healthz`)).ok;
        } catch {}
        if (ready || server.exitCode !== null) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert(ready, `Local blockchain did not start: ${serverOutput}`);
      const state = (await (await fetch(`${baseUrl}/admin/state`)).json()) as {
        testAccounts: { privateKey: string }[];
      };
      const senderKey = PrivateKey.fromBase58(
        state.testAccounts[0]!.privateKey,
      );
      const sender = senderKey.toPublicKey();
      const contractKey = PrivateKey.random();
      const contract = new ProofOffContract(contractKey.toPublicKey());
      process.env.PROOFS_ENABLED = "false";
      configureMinaNetwork(`${baseUrl}/graphql`, "testnet");

      // No contract compilation occurs. Both deployment signatures must survive
      // the adapter, or the simulator rejects this transaction.
      const deployment = await Mina.transaction(
        { sender, fee: 100_000_000 },
        async () => {
          AccountUpdate.fundNewAccount(sender);
          await contract.deploy({
            verificationKey: VerificationKey.dummySync(),
          });
          contract.account.permissions.set({
            ...Permissions.default(),
            setZkappUri: Permissions.proof(),
          });
        },
      )
        .sign([senderKey, contractKey])
        .send()
        .wait();
      assert.equal(deployment.status, "included");

      const updatePromise = Mina.transaction(
        { sender, fee: 100_000_000 },
        async () => {
          await contract.changeUri();
        },
      );
      const update = await updatePromise;
      assert(
        update.transaction.accountUpdates.some(
          (accountUpdate) =>
            accountUpdate.lazyAuthorization?.kind === "lazy-proof",
        ),
      );

      // Keep the chained promise API as well as the awaited transaction API.
      const provedPromise = updatePromise.prove();
      const proofs = await provedPromise.proofs();
      assert(proofs.every((proof) => proof === undefined));
      const proved = await provedPromise;
      const proofUpdates = proved.transaction.accountUpdates.filter(
        (accountUpdate) => accountUpdate.authorization.proof,
      );
      assert.equal(proofUpdates.length, 1);
      assert(proofUpdates[0]!.authorization.proof!.length > 0);
      const pending = await provedPromise.sign([senderKey]).send();
      const submitted = await pending.safeWait();
      assert.equal(submitted.status, "included");

      const { account, error } = await fetchAccount({
        publicKey: contract.address,
      });
      assert.ifError(error);
      assert.equal(account?.zkapp?.zkappUri, updatedUri);
    } finally {
      if (previousProofsEnabled === undefined)
        delete process.env.PROOFS_ENABLED;
      else process.env.PROOFS_ENABLED = previousProofsEnabled;
      server.kill("SIGTERM");
      await exited;
    }
  },
);
