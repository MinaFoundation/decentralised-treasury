import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
const { Cache, Field, Provable, UInt128, ZkProgram, setNumberOfWorkers } =
  await import(process.env.O1JS_TEST_MODULE ?? "o1js");

test(
  "UInt128 real proofs accept full-range arithmetic and reject both audit attacks",
  {
    skip: process.env.O1JS_SECURITY_PROOFS !== "true",
  },
  async () => {
    setNumberOfWorkers(2);
    const Arithmetic = ZkProgram({
      name: "TreasuryUInt128Audit09",
      publicOutput: Provable.Array(UInt128, 2),
      methods: {
        multiply: {
          privateInputs: [UInt128, UInt128],
          async method(x, y) {
            return { publicOutput: [x.mul(y), UInt128.zero] };
          },
        },
        divide: {
          privateInputs: [UInt128, UInt128],
          async method(x, y) {
            const { quotient, rest } = x.divMod(y);
            return { publicOutput: [quotient, rest] };
          },
        },
      },
    });
    await Arithmetic.compile({
      cache: Cache.FileSystem(join(tmpdir(), "treasury-uint128-proof-cache")),
    });
    const B = 1n << 64n;
    const MAX = (1n << 128n) - 1n;
    const { proof: product } = await Arithmetic.multiply(
      UInt128.from(B + 1n),
      UInt128.from(B - 1n),
    );
    assert.equal(product.publicOutput[0].toBigInt(), MAX);
    assert.equal(await Arithmetic.verify(product), true);
    const { proof: division } = await Arithmetic.divide(
      UInt128.from(MAX),
      UInt128.from(B),
    );
    assert.deepEqual(
      division.publicOutput.map((x) => x.toBigInt()),
      [B - 1n, B - 1n],
    );
    assert.equal(await Arithmetic.verify(division), true);
    await assert.rejects(
      Arithmetic.multiply(
        UInt128.from(1n << 127n),
        UInt128.from((1n << 127n) + 1n),
      ),
    );
    await assert.rejects(
      Arithmetic.multiply(UInt128.from(MAX), UInt128.from(2)),
    );
    await assert.rejects(Arithmetic.divide(UInt128.one, UInt128.zero));

    const witness = Provable.witness;
    let substitutions = 0;
    Provable.witness = function (type, compute) {
      if (Provable.inProver() && type === Field && substitutions === 0) {
        substitutions++;
        return witness.call(this, type, () => Field((1n << 127n) - 1n));
      }
      return witness.call(this, type, compute);
    };
    try {
      await assert.rejects(
        Arithmetic.divide(UInt128.zero, UInt128.from((1n << 127n) + 1n)),
      );
      assert.equal(
        substitutions,
        1,
        "the proof attempt must replace the quotient witness",
      );
    } finally {
      Provable.witness = witness;
    }

    // divMod64 uses custom range-check gates, which runAndCheck does not validate.
    // Keep the limb reconstruction equal to x while violating the 64-bit limb bound.
    let limbSubstitutions = 0;
    Provable.witness = function (type, compute) {
      return witness.call(this, type, () => {
        const value = compute();
        if (
          Provable.inProver() &&
          limbSubstitutions === 0 &&
          Array.isArray(value) &&
          value.length === 2 &&
          value.every((x) => typeof x === "bigint")
        ) {
          limbSubstitutions++;
          return [0n, 1n << 127n];
        }
        return value;
      });
    };
    try {
      await assert.rejects(
        Arithmetic.multiply(UInt128.from(1n << 127n), UInt128.one),
      );
      assert.equal(
        limbSubstitutions,
        1,
        "the proof attempt must replace the limb witness",
      );
    } finally {
      Provable.witness = witness;
    }
  },
);
