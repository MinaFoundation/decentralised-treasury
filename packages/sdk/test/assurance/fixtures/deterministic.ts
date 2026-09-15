import { createHash } from "node:crypto";

const HASH_DOMAIN = "decentralized-treasury:test-fixture:v1";
const MAX_COUNTER = (1n << 64n) - 1n;

function assertNonempty(name: string, value: string): void {
  if (value.length === 0) {
    throw new Error(`${name} must not be empty.`);
  }
}

function assertNonnegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative safe integer.`);
  }
}

function encodeLength(value: Uint8Array): Uint8Array {
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, value.length, false);
  return length;
}

function encodeCounter(counter: bigint): Uint8Array {
  if (counter < 0n || counter > MAX_COUNTER) {
    throw new Error("counter must fit in an unsigned 64-bit integer.");
  }

  const value = new Uint8Array(8);
  new DataView(value.buffer).setBigUint64(0, counter, false);
  return value;
}

function hashBlock(
  seedLabel: string,
  label: string,
  counter: bigint,
): Uint8Array {
  const encoder = new TextEncoder();
  const seedBytes = encoder.encode(seedLabel);
  const labelBytes = encoder.encode(label);

  return new Uint8Array(
    createHash("sha256")
      .update(HASH_DOMAIN)
      .update(encodeLength(seedBytes))
      .update(seedBytes)
      .update(encodeLength(labelBytes))
      .update(labelBytes)
      .update(encodeCounter(counter))
      .digest(),
  );
}

export class DeterministicByteGenerator {
  readonly #seedLabel: string;
  readonly #label: string;
  #counter: bigint;
  #buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  #bufferOffset = 0;
  #exhausted = false;

  public constructor(seedLabel: string, label: string, counter = 0n) {
    assertNonempty("seedLabel", seedLabel);
    assertNonempty("label", label);
    encodeCounter(counter);

    this.#seedLabel = seedLabel;
    this.#label = label;
    this.#counter = counter;
  }

  public get nextCounter(): bigint {
    return this.#counter;
  }

  public nextBytes(length: number): Uint8Array {
    assertNonnegativeInteger("length", length);

    const output = new Uint8Array(length);
    let outputOffset = 0;

    while (outputOffset < length) {
      if (this.#bufferOffset === this.#buffer.length) {
        if (this.#exhausted) {
          throw new Error("deterministic byte counter is exhausted.");
        }
        this.#buffer = hashBlock(this.#seedLabel, this.#label, this.#counter);
        this.#bufferOffset = 0;

        if (this.#counter === MAX_COUNTER) {
          this.#exhausted = true;
        } else {
          this.#counter += 1n;
        }
      }

      const available = this.#buffer.length - this.#bufferOffset;
      const requested = length - outputOffset;
      const copied = Math.min(available, requested);
      output.set(
        this.#buffer.subarray(this.#bufferOffset, this.#bufferOffset + copied),
        outputOffset,
      );
      this.#bufferOffset += copied;
      outputOffset += copied;
    }

    return output;
  }
}

export function deterministicId(
  seedLabel: string,
  label: string,
  prefix: string,
  byteLength = 16,
): string {
  assertNonempty("prefix", prefix);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(prefix)) {
    throw new Error("prefix must be one path-safe identifier segment.");
  }
  const bytes = new DeterministicByteGenerator(seedLabel, label).nextBytes(
    byteLength,
  );
  return `${prefix}-${Buffer.from(bytes).toString("hex")}`;
}

export function deterministicUInt32(seedLabel: string, label: string): number {
  const bytes = new DeterministicByteGenerator(seedLabel, label).nextBytes(4);
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(0, false);
}

export interface DeterministicClockOptions {
  readonly startMs: number;
  readonly stepMs?: number;
}

export class DeterministicClock {
  #currentMs: number;
  readonly #stepMs: number;

  public constructor(options: DeterministicClockOptions) {
    assertNonnegativeInteger("startMs", options.startMs);
    assertNonnegativeInteger("stepMs", options.stepMs ?? 1_000);
    this.#currentMs = options.startMs;
    this.#stepMs = options.stepMs ?? 1_000;
  }

  public peekMs(): number {
    return this.#currentMs;
  }

  public nowMs(): number {
    const value = this.#currentMs;
    this.advance(this.#stepMs);
    return value;
  }

  public now(): Date {
    return new Date(this.nowMs());
  }

  public advance(milliseconds: number): void {
    assertNonnegativeInteger("milliseconds", milliseconds);
    const next = this.#currentMs + milliseconds;
    if (!Number.isSafeInteger(next)) {
      throw new Error("clock value must remain a safe integer.");
    }
    this.#currentMs = next;
  }
}

export function createDeterministicClock(
  seedLabel: string,
  label: string,
  baseEpochMs: number,
  windowMs: number,
  stepMs = 1_000,
): DeterministicClock {
  assertNonnegativeInteger("baseEpochMs", baseEpochMs);
  assertNonnegativeInteger("windowMs", windowMs);
  if (windowMs === 0) {
    throw new Error("windowMs must be greater than zero.");
  }

  const offset = deterministicUInt32(seedLabel, label) % windowMs;
  return new DeterministicClock({ startMs: baseEpochMs + offset, stepMs });
}
