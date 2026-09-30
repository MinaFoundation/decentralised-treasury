import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountUpdate,
  Cache,
  Field,
  Mina,
  PrivateKey,
  Provable,
  SmartContract,
  declareMethods,
  setNumberOfWorkers,
} from "o1js";

// This separate lane performs real compilation, proving, verification, and inclusion.
test(
  "o1js proves valid nested calls and rejects a wrong-token prover witness",
  { skip: process.env.O1JS_SECURITY_PROOFS !== "true" },
  async () => {
    setNumberOfWorkers(2);
    const local = await Mina.LocalBlockchain({ proofsEnabled: true });
    Mina.setActiveInstance(local);
    const payer = local.testAccounts[0];
    const childKey = PrivateKey.random();
    const parentKey = PrivateKey.random();
    class Child extends SmartContract {
      async ping() {}
    }
    declareMethods(Child, { ping: [] });
    class Parent extends SmartContract {
      async callChild() {
        await new Child(childKey.toPublicKey()).ping();
      }
    }
    declareMethods(Parent, { callChild: [] });
    const cache = Cache.FileSystem("/tmp/treasury-o1js-security-proof-cache");
    await Child.compile({ cache });
    await Parent.compile({ cache });
    const child = new Child(childKey.toPublicKey());
    const parent = new Parent(parentKey.toPublicKey());
    const deploy = await Mina.transaction(payer, async () => {
      AccountUpdate.fundNewAccount(payer, 2);
      await child.deploy();
      await parent.deploy();
    });
    await deploy.prove();
    await (await deploy.sign([payer.key, childKey, parentKey]).send()).wait();
    const valid = await Mina.transaction(payer, async () => {
      await parent.callChild();
    });
    await valid.prove();
    await (await valid.sign([payer.key]).send()).wait();
    const malicious = await Mina.transaction(payer, async () => {
      await parent.callChild();
    });
    const witness = AccountUpdate.witness;
    let substitutions = 0;
    AccountUpdate.witness = function (type, compute, ...options) {
      return witness.call(
        this,
        type,
        async () => {
          const result = await compute();
          if (Provable.inProver()) {
            result.accountUpdate.body.tokenId = Field(9);
            substitutions++;
          }
          return result;
        },
        ...options,
      );
    };
    try {
      await assert.rejects(malicious.prove());
      assert.ok(
        substitutions > 0,
        "the prover must encounter the malicious callee",
      );
    } finally {
      AccountUpdate.witness = witness;
    }
  },
);
