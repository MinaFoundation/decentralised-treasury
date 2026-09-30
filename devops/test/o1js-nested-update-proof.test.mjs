import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AccountUpdate,
  Cache,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  Reducer,
  SmartContract,
  declareMethods,
  setNumberOfWorkers,
} from "o1js";

test(
  "nested self updates retain one checked identity during compilation and proving",
  {
    skip: process.env.O1JS_SECURITY_PROOFS !== "true",
  },
  async () => {
    setNumberOfWorkers(2);
    const local = await Mina.LocalBlockchain({ proofsEnabled: true });
    Mina.setActiveInstance(local);
    const payer = local.testAccounts[0];
    const voter = local.testAccounts[1];
    const childKey = PrivateKey.random();
    const parentKey = PrivateKey.random();
    class Child extends SmartContract {
      constructor(...args) {
        super(...args);
        this.reducer = Reducer({ actionType: Field });
      }
      async read() {
        this.account.balance.getAndRequireEquals();
      }
      async vote(value) {
        this.reducer.dispatch(value);
      }
    }
    declareMethods(Child, { read: [], vote: [Field] });
    class Parent extends SmartContract {
      async vote(address, voter, value) {
        this.sender.getAndRequireSignature();
        const child = new Child(address);
        await child.read();
        await child.vote(value);
        AccountUpdate.createSigned(voter);
        this.approve(child.self);
      }
    }
    declareMethods(Parent, { vote: [PublicKey, PublicKey, Field] });
    const cache = Cache.FileSystem(
      join(tmpdir(), "treasury-nested-update-proof-cache"),
    );
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
    const vote = await Mina.transaction(payer, async () => {
      await parent.vote(child.address, voter, Field(1));
    });
    const children = vote.transaction.accountUpdates.filter((update) =>
      update.body.publicKey.equals(child.address).toBoolean(),
    );
    assert.equal(children.length, 2);
    assert.ok(
      children.every((update) =>
        update.body.authorizationKind.isProved.toBoolean(),
      ),
    );
    await vote.prove();
    await (await vote.sign([payer.key, voter.key]).send()).wait();
    assert.equal((await Mina.getActions(child.address)).length, 1);
  },
);
