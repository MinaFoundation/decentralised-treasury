import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(root, "apps/backoffice/package.json"));
const { chromium } = require("@playwright/test");
const web = resolve(root, "node_modules/o1js/dist/web");
const server = createServer(async (req, res) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  if (req.url === "/")
    return res.end("<!doctype html><title>o1js security regression</title>");
  const file = resolve(web, "." + req.url);
  if (!file.startsWith(web + "/")) {
    res.statusCode = 403;
    return res.end();
  }
  try {
    res.setHeader(
      "Content-Type",
      extname(file) === ".wasm" ? "application/wasm" : "text/javascript",
    );
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error(e));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const results = await page.evaluate(async () => {
    const o = await import("/index.js");
    o.setNumberOfWorkers(1);
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
    } = o;
    const check = (condition, label) => {
      if (!condition) throw Error(label);
    };
    const rejects = async (callback, label) => {
      let rejected = false;
      try {
        await callback();
      } catch {
        rejected = true;
      }
      check(rejected, label);
    };
    await rejects(
      () =>
        Provable.runAndCheck(async () => {
          await AccountUpdate.witness(
            Empty,
            async () => {
              const accountUpdate = AccountUpdate.default(
                PrivateKey.random().toPublicKey(),
              );
              accountUpdate.body.incrementNonce = Bool.Unsafe.fromField(
                Field(2),
              );
              return { accountUpdate, result: undefined };
            },
            { skipCheck: true },
          );
        }),
      "malformed Boolean witness accepted",
    );
    const local = await Mina.LocalBlockchain({ proofsEnabled: false });
    Mina.setActiveInstance(local);
    const tx = await Mina.transaction(local.testAccounts[0], async () => {
      AccountUpdate.create(PublicKey.empty()).account.nonce.requireEquals(
        UInt32.from(9),
      );
    });
    check(
      tx.transaction.accountUpdates.length === 1,
      "mandatory empty-key update omitted",
    );
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
    const witness = AccountUpdate.witness;
    let substitutions = 0;
    AccountUpdate.witness = function (type, compute, ...options) {
      return witness.call(
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
      await rejects(
        () =>
          Mina.transaction(local.testAccounts[0], async () => {
            await parent.callChild();
          }),
        "wrong-token child accepted",
      );
      check(substitutions > 0, "callee not replaced");
    } finally {
      AccountUpdate.witness = witness;
    }
    check(
      o.UInt128.from(1n << 100n).toBigInt() === 1n << 100n,
      "UInt128 missing",
    );
    check(typeof o.VerificationKey.fromData === "function", "fromData missing");
    check(
      typeof local.setNetworkState === "function",
      "setNetworkState missing",
    );
    const { UInt96, UInt128 } = o;
    await Provable.runAndCheck(() => {
      const x = Provable.witness(UInt96, () => UInt96.from((1n << 64n) - 1n));
      const scaled = x.mul(10_000);
      scaled.div(10_000).value.assertEquals(x.value);
    });
    await rejects(
      () =>
        Provable.runAndCheck(() => {
          const x = Provable.witness(UInt96, () => UInt96.from(1n << 48n));
          x.mul(x);
        }),
      "UInt96 multiplication overflow accepted",
    );
    const limit = 1n << 64n;
    await Provable.runAndCheck(() => {
      const x = Provable.witness(UInt128, () => UInt128.from(limit + 1n));
      const y = Provable.witness(UInt128, () => UInt128.from(limit - 1n));
      x.mul(y).value.assertEquals(Field((1n << 128n) - 1n));
      const { quotient, rest } = x.divMod(y);
      quotient.value.assertEquals(Field(1));
      rest.value.assertEquals(Field(2));
    });
    await rejects(
      () =>
        Provable.runAndCheck(() => {
          const x = Provable.witness(UInt128, () => UInt128.from(1n << 127n));
          const y = Provable.witness(UInt128, () =>
            UInt128.from((1n << 127n) + 1n),
          );
          x.mul(y);
        }),
      "UInt128 wrapped multiplication accepted",
    );
    let quotientSubstitutions = 0;
    await rejects(
      () =>
        Provable.runAndCheck(() => {
          const x = Provable.witness(UInt128, () => UInt128.zero);
          const y = Provable.witness(UInt128, () =>
            UInt128.from((1n << 127n) + 1n),
          );
          const witness = Provable.witness;
          Provable.witness = function (type, compute) {
            if (type === Field && quotientSubstitutions === 0) {
              quotientSubstitutions++;
              return witness.call(this, type, () => Field((1n << 127n) - 1n));
            }
            return witness.call(this, type, compute);
          };
          try {
            x.divMod(y);
          } finally {
            Provable.witness = witness;
          }
        }),
      "UInt128 malicious quotient accepted",
    );
    check(quotientSubstitutions === 1, "UInt128 quotient not replaced");
    return {
      isolated: crossOriginIsolated,
      malformedWitnessRejected: true,
      mandatoryUpdateRetained: true,
      wrongTokenRejected: true,
      forkApisPresent: true,
      uint96CheckedArithmetic: true,
      uint128ValidArithmetic: true,
      uint128AuditAttacksRejected: true,
    };
  });
  console.log(JSON.stringify(results));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
