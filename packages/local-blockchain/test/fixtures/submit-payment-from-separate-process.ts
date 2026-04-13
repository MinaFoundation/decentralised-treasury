import assert from "node:assert/strict";
import { AccountUpdate, Mina, PrivateKey, PublicKey, UInt64 } from "../../src/o1js.js";

interface AdminStateResponse {
  ok: boolean;
  currentSlot: number;
  testAccounts: Array<{
    publicKey: string;
    privateKey: string;
    balance: string;
  }>;
}

const baseUrl = process.argv[2];
if (!baseUrl) {
  throw new Error("Expected the local blockchain base URL as the first argument");
}

const stateResponse = await fetch(`${baseUrl}/admin/state`);
assert.equal(stateResponse.status, 200);
const state = (await stateResponse.json()) as AdminStateResponse;

const sender = state.testAccounts[0];
const recipient = state.testAccounts[1];
assert(sender, "missing sender test account");
assert(recipient, "missing recipient test account");

const local = await Mina.LocalBlockchain({ proofsEnabled: false });
Mina.setActiveInstance(local);

const senderPublicKey = PublicKey.fromBase58(sender.publicKey);
const senderPrivateKey = PrivateKey.fromBase58(sender.privateKey);
const recipientPublicKey = PublicKey.fromBase58(recipient.publicKey);
local.addAccount(senderPublicKey, sender.balance);
const fee = UInt64.from(1_000_000_000);
const amount = UInt64.from(1_000_000_000);

const transaction = await Mina.transaction({ sender: senderPublicKey, fee }, async () => {
  const senderUpdate = AccountUpdate.createSigned(senderPublicKey);
  senderUpdate.send({ to: recipientPublicKey, amount });
});

transaction.sign([senderPrivateKey]);

const graphqlMutation = `mutation {
  sendZkapp(input: {
    zkappCommand: ${JSON.stringify(JSON.parse(transaction.toJSON()), null, 2).replace(
      /\"(\S+)\"\s*:/gm,
      "$1:",
    )}
  }) {
    zkapp {
      hash
      id
      failureReason {
        failures
        index
      }
    }
  }
}`;

const submitResponse = await fetch(`${baseUrl}/graphql`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
  },
  body: JSON.stringify({
    query: graphqlMutation,
  }),
});

if (!submitResponse.ok) {
  throw new Error(await submitResponse.text());
}

const payload = await submitResponse.json();
console.log(
  `SUBMIT_TRANSACTION_RESULT:${JSON.stringify({
    slotBefore: state.currentSlot,
    sendZkapp: payload.data?.sendZkapp?.zkapp ?? null,
  })}`,
);
