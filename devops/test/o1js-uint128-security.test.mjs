import assert from "node:assert/strict";
import test from "node:test";
const { Field, Provable, UInt128 } = await import(
  process.env.O1JS_TEST_MODULE ?? "o1js"
);

const B = 1n << 64n;
const MAX = (1n << 128n) - 1n;
const modes = ["constant", "witness", "left-witness", "right-witness"];
function inputs(x, y, mode) {
  const input = (n, variable) =>
    variable
      ? Provable.witness(UInt128, () => UInt128.from(n))
      : UInt128.from(n);
  return [
    input(x, mode === "witness" || mode === "left-witness"),
    input(y, mode === "witness" || mode === "right-witness"),
  ];
}

test("UInt128 multiplication preserves full-range valid products", async () => {
  const pairs = [
    [0n, MAX],
    [MAX, 0n],
    [1n, MAX],
    [MAX, 1n],
    [B - 1n, B - 1n],
    [B + 1n, B - 1n],
    [B - 1n, B + 1n],
    [B, B - 1n],
    [B - 1n, B],
    [1n << 127n, 1n],
    [123456789n, 10000n],
  ];
  for (const mode of modes) {
    for (const [x, y] of pairs) {
      await Provable.runAndCheck(() => {
        const [a, b] = inputs(x, y, mode);
        a.mul(b).value.assertEquals(Field(x * y));
      });
    }
  }
});

test("UInt128 multiplication rejects ordinary and field-wrapped overflow", async () => {
  const pairs = [
    [B, B],
    [MAX, 2n],
    [B + 1n, B],
    [B, B + 1n],
    [1n << 127n, (1n << 127n) + 1n],
    [MAX, MAX],
  ];
  for (const mode of modes) {
    for (const [x, y] of pairs) {
      await assert.rejects(
        Provable.runAndCheck(() => {
          const [a, b] = inputs(x, y, mode);
          a.mul(b);
        }),
        `${mode}: ${x} * ${y}`,
      );
    }
  }
});

test("UInt128 divMod, div, and mod agree with integer arithmetic across limb boundaries", async () => {
  const values = [0n, 1n, 2n, B - 1n, B, B + 1n, 1n << 127n, MAX];
  for (const mode of modes) {
    for (const x of values) {
      for (const y of values.slice(1)) {
        await Provable.runAndCheck(() => {
          const [a, b] = inputs(x, y, mode);
          const result = a.divMod(b);
          result.quotient.value.assertEquals(Field(x / y));
          result.rest.value.assertEquals(Field(x % y));
          a.div(b).value.assertEquals(Field(x / y));
          a.mod(b).value.assertEquals(Field(x % y));
        });
      }
    }
  }
});

test("UInt128 rejects division by zero for constants and witnessed inputs", async () => {
  for (const mode of modes) {
    for (const x of [0n, 1n, MAX]) {
      await assert.rejects(
        Provable.runAndCheck(() => {
          const [a, b] = inputs(x, 0n, mode);
          a.divMod(b);
        }),
      );
    }
  }
});

function withQuotient(x, y, q) {
  let substitutions = 0;
  const check = Provable.runAndCheck(() => {
    const [a, b] = inputs(x, y, "witness");
    const witness = Provable.witness;
    Provable.witness = function (type, compute) {
      // divMod's first scalar Field witness is the quotient, not a limb tuple.
      if (type === Field && substitutions === 0) {
        substitutions++;
        return witness.call(this, type, () => Field(q));
      }
      return witness.call(this, type, compute);
    };
    try {
      a.divMod(b);
    } finally {
      Provable.witness = witness;
    }
  });
  return { check, substitutions: () => substitutions };
}

test("UInt128 rejects the audit quotient and other malicious quotient witnesses", async () => {
  for (const [x, y, q] of [
    [0n, (1n << 127n) + 1n, (1n << 127n) - 1n],
    [100n, 7n, 13n],
    [100n, 7n, 15n],
    [MAX, 1n, MAX - 1n],
    [1n, MAX, 1n],
    [0n, 0n, 0n],
    [1n, 0n, 0n],
  ]) {
    const attempt = withQuotient(x, y, q);
    await assert.rejects(attempt.check);
    assert.equal(
      attempt.substitutions(),
      1,
      "the test must replace the quotient witness",
    );
  }
});

test("UInt128 checks deterministic full-width samples against BigInt", async () => {
  let seed = 0x123456789abcdef123456789abcdefn;
  const next = () =>
    (seed = (seed * 6364136223846793005n + 1442695040888963407n) & MAX);
  for (let i = 0; i < 48; i++) {
    const x = next();
    const y = next() || 1n;
    const safeY = MAX / (x || 1n);
    await Provable.runAndCheck(() => {
      const [a, b] = inputs(x, y, "witness");
      const { quotient, rest } = a.divMod(b);
      quotient.value.assertEquals(Field(x / y));
      rest.value.assertEquals(Field(x % y));
      a.mul(
        Provable.witness(UInt128, () => UInt128.from(safeY)),
      ).value.assertEquals(Field(x * safeY));
    });
    await assert.rejects(
      Provable.runAndCheck(() => {
        const [a, b] = inputs(x, safeY + 1n, "witness");
        a.mul(b);
      }),
    );
  }
});
