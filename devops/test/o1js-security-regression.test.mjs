import assert from "node:assert/strict";
import test from "node:test";
const {
  AccountUpdate,
  Bool,
  Empty,
  Field,
  Mina,
  PrivateKey,
  Provable,
  PublicKey,
  SmartContract,
  UInt32,
  declareMethods,
} = await import(process.env.O1JS_TEST_MODULE ?? "o1js");

// These tests exercise the installed dependency, including its packaged output.
test("o1js rejects malformed account updates even with the former skipCheck option", async () => {
  const key = PrivateKey.random().toPublicKey();
  for (const malformed of [
    (update) => {
      update.body.incrementNonce = Bool.Unsafe.fromField(Field(2));
    },
    (update) => {
      update.body.preconditions.account.nonce.value.upper =
        UInt32.Unsafe.fromField(Field(1n << 32n));
    },
  ]) {
    await assert.rejects(
      Provable.runAndCheck(async () => {
        await AccountUpdate.witness(
          Empty,
          async () => {
            const accountUpdate = AccountUpdate.default(key);
            malformed(accountUpdate);
            return { accountUpdate, result: undefined };
          },
          { skipCheck: true },
        );
      }),
    );
  }
});

test("o1js retains mandatory empty-key updates instead of silently dropping them", async () => {
  const local = await Mina.LocalBlockchain({ proofsEnabled: false });
  Mina.setActiveInstance(local);
  const tx = await Mina.transaction(local.testAccounts[0], async () => {
    AccountUpdate.create(PublicKey.empty()).account.nonce.requireEquals(
      UInt32.from(9),
    );
  });
  assert.equal(tx.transaction.accountUpdates.length, 1);
  assert.equal(
    tx.transaction.accountUpdates[0].body.preconditions.account.nonce.value.lower.toBigint(),
    9n,
  );
});

test("o1js binds nested calls to the callee token ID", async () => {
  const local = await Mina.LocalBlockchain({ proofsEnabled: false });
  Mina.setActiveInstance(local);
  const childKey = PrivateKey.random().toPublicKey();
  class Child extends SmartContract {
    async ping() {}
  }
  declareMethods(Child, { ping: [] });
  class Parent extends SmartContract {
    async callChild() {
      await new Child(childKey).ping();
    }
  }
  declareMethods(Parent, { callChild: [] });
  const parent = new Parent(PrivateKey.random().toPublicKey());
  const originalWitness = AccountUpdate.witness;
  let substitutions = 0;
  AccountUpdate.witness = function (type, compute, ...options) {
    return originalWitness.call(
      this,
      type,
      async () => {
        const result = await compute();
        result.accountUpdate.body.tokenId = Field(9);
        substitutions++;
        return result;
      },
      ...options,
    );
  };
  try {
    await assert.rejects(
      Mina.transaction(local.testAccounts[0], async () => {
        await parent.callChild();
      }),
    );
    assert.ok(substitutions > 0, "the test must replace a witnessed callee");
  } finally {
    AccountUpdate.witness = originalWitness;
  }
});

test("o1js preserves explicit conditional account updates", async () => {
  const local = await Mina.LocalBlockchain({ proofsEnabled: false });
  Mina.setActiveInstance(local);
  for (const included of [false, true]) {
    const tx = await Mina.transaction(local.testAccounts[0], async () => {
      const update = AccountUpdate.createIf(
        Bool(included),
        local.testAccounts[1],
      );
      update.value.account.nonce.requireEquals(UInt32.from(0));
    });
    assert.equal(tx.transaction.accountUpdates.length, included ? 1 : 0);
  }
});
