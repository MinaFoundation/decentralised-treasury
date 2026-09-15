import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDeterministicClock,
  DeterministicByteGenerator,
  DeterministicClock,
  deterministicId,
  deterministicUInt32,
} from "./deterministic.js";

describe("deterministic assurance fixtures", () => {
  it("returns the same bytes for the same namespace", () => {
    const first = new DeterministicByteGenerator("seed-001", "account");
    const second = new DeterministicByteGenerator("seed-001", "account");

    assert.deepEqual(first.nextBytes(80), second.nextBytes(80));
    assert.equal(first.nextCounter, 3n);
  });

  it("does not depend on requested chunk sizes", () => {
    const whole = new DeterministicByteGenerator("seed-001", "merkle");
    const chunks = new DeterministicByteGenerator("seed-001", "merkle");

    const expected = whole.nextBytes(65);
    const actual = new Uint8Array(65);
    actual.set(chunks.nextBytes(1), 0);
    actual.set(chunks.nextBytes(31), 1);
    actual.set(chunks.nextBytes(33), 32);

    assert.deepEqual(actual, expected);
  });

  it("separates seed and purpose labels", () => {
    const baseline = new DeterministicByteGenerator("seed-001", "account");
    const otherSeed = new DeterministicByteGenerator("seed-002", "account");
    const otherLabel = new DeterministicByteGenerator("seed-001", "merkle");

    assert.notDeepEqual(baseline.nextBytes(32), otherSeed.nextBytes(32));
    assert.notDeepEqual(
      new DeterministicByteGenerator("seed-001", "account").nextBytes(32),
      otherLabel.nextBytes(32),
    );
  });

  it("creates stable IDs and unsigned 32-bit values", () => {
    assert.equal(
      deterministicId("seed-001", "queue", "assurance", 8),
      "assurance-77bdd8f63a0c1510",
    );
    assert.match(
      deterministicId("seed-001", "queue", "assurance", 8),
      /^assurance-[0-9a-f]{16}$/,
    );

    assert.equal(deterministicUInt32("seed-001", "lifecycle"), 3_326_697_018);
  });

  it("advances a clock by its fixed step", () => {
    const clock = new DeterministicClock({
      startMs: 1_700_000_000_000,
      stepMs: 250,
    });

    assert.equal(clock.nowMs(), 1_700_000_000_000);
    assert.equal(clock.now().getTime(), 1_700_000_000_250);
    assert.equal(clock.peekMs(), 1_700_000_000_500);
    clock.advance(500);
    assert.equal(clock.peekMs(), 1_700_000_001_000);
  });

  it("derives a stable clock start inside the requested window", () => {
    const first = createDeterministicClock(
      "seed-001",
      "restart-clock",
      1_700_000_000_000,
      60_000,
    );
    const second = createDeterministicClock(
      "seed-001",
      "restart-clock",
      1_700_000_000_000,
      60_000,
    );

    assert.equal(first.peekMs(), second.peekMs());
    assert.ok(first.peekMs() >= 1_700_000_000_000);
    assert.ok(first.peekMs() < 1_700_000_060_000);
  });

  it("rejects invalid lengths and clock ranges", () => {
    const generator = new DeterministicByteGenerator("seed-001", "account");

    assert.throws(() => generator.nextBytes(-1), /nonnegative safe integer/);
    assert.throws(
      () => deterministicId("seed-001", "queue", "../unsafe"),
      /path-safe identifier/,
    );
    assert.throws(
      () => createDeterministicClock("seed-001", "clock", 0, 0),
      /greater than zero/,
    );
  });
});
