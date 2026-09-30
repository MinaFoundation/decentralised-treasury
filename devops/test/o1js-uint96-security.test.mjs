import assert from "node:assert/strict";
import test from "node:test";
const { Field, Provable, UInt96 } = await import(
  process.env.O1JS_TEST_MODULE ?? "o1js"
);

const B = 1n << 48n;
const MAX = (1n << 96n) - 1n;

function inputs(x, y, witnessed) {
  if (!witnessed) return [UInt96.from(x), UInt96.from(y)];
  return [
    Provable.witness(UInt96, () => UInt96.from(x)),
    Provable.witness(UInt96, () => UInt96.from(y)),
  ];
}

test("UInt96 enforces its range and checked multiplication", async () => {
  assert.equal(UInt96.from(MAX).toBigInt(), MAX);
  assert.throws(() => UInt96.from(MAX + 1n));

  for (const witnessed of [false, true]) {
    await Provable.runAndCheck(() => {
      const [x, y] = inputs(B + 1n, B - 1n, witnessed);
      x.mul(y).value.assertEquals(Field(MAX));
    });
    await assert.rejects(
      Provable.runAndCheck(() => {
        const [x, y] = inputs(B, B, witnessed);
        x.mul(y);
      }),
    );
  }
});

test("UInt96 division rejects zero and incorrect quotient witnesses", async () => {
  for (const witnessed of [false, true]) {
    await Provable.runAndCheck(() => {
      const [x, y] = inputs(MAX, B, witnessed);
      const { quotient, rest } = x.divMod(y);
      quotient.value.assertEquals(Field(MAX / B));
      rest.value.assertEquals(Field(MAX % B));
    });
    await assert.rejects(
      Provable.runAndCheck(() => {
        const [x, y] = inputs(1n, 0n, witnessed);
        x.divMod(y);
      }),
    );
  }

  let substitutions = 0;
  const check = Provable.runAndCheck(() => {
    const [x, y] = inputs(100n, 7n, true);
    const witness = Provable.witness;
    Provable.witness = function (type, compute) {
      if (type === Field && substitutions === 0) {
        substitutions++;
        return witness.call(this, type, () => Field(15));
      }
      return witness.call(this, type, compute);
    };
    try {
      x.divMod(y);
    } finally {
      Provable.witness = witness;
    }
  });
  await assert.rejects(check);
  assert.equal(substitutions, 1);
});
