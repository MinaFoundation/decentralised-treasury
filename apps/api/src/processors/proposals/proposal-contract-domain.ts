import { Bool, Field, PublicKey } from "o1js";

export const MAX_UINT32 = 4_294_967_295n;
export const MAX_UINT64 = 18_446_744_073_709_551_615n;
export const MAX_UINT128 = 340_282_366_920_938_463_463_374_607_431_768_211_455n;

const UNSIGNED_DECIMAL_PATTERN = /^(0|[1-9]\d*)$/;

function parseUnsignedDecimal(value: unknown): bigint | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  if (typeof value !== "string" || !UNSIGNED_DECIMAL_PATTERN.test(value)) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

export function parseContractUInt32(value: unknown): number | null {
  const parsed = parseUnsignedDecimal(value);
  if (parsed === null || parsed > MAX_UINT32) {
    return null;
  }
  return Number(parsed);
}

export function parseContractUInt64(value: unknown): string | null {
  const parsed = parseUnsignedDecimal(value);
  if (parsed === null || parsed > MAX_UINT64) {
    return null;
  }
  return parsed.toString();
}

export function parseContractUInt128(value: unknown): string | null {
  const parsed = parseUnsignedDecimal(value);
  if (parsed === null || parsed > MAX_UINT128) {
    return null;
  }
  return parsed.toString();
}

export function requireContractUInt64(value: bigint, label: string): bigint {
  if (value < 0n || value > MAX_UINT64) {
    throw new Error(
      `[proposal-processor] ${label} must be in the UInt64 range`,
    );
  }
  return value;
}

export function requireContractUInt128(value: bigint, label: string): bigint {
  if (value < 0n || value > MAX_UINT128) {
    throw new Error(
      `[proposal-processor] ${label} must be in the UInt128 range`,
    );
  }
  return value;
}

export function parseContractPublicKey(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  try {
    const publicKey = PublicKey.fromBase58(value);
    // Apply the same PublicKey type check that the contract applies in-circuit.
    PublicKey.check(publicKey);
    const canonical = publicKey.toBase58();
    return canonical === value ? canonical : null;
  } catch {
    return null;
  }
}

export function parseContractField(value: unknown): string | null {
  const parsed = parseUnsignedDecimal(value);
  if (parsed === null) {
    return null;
  }
  try {
    const canonical = Field(parsed).toString();
    return canonical === parsed.toString() ? canonical : null;
  } catch {
    return null;
  }
}

export function parseContractBool(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return Bool(value).toBoolean();
  }
  if (value === "true") {
    return Bool(true).toBoolean();
  }
  if (value === "false") {
    return Bool(false).toBoolean();
  }
  return null;
}

export function parseContractFieldArray(values: string[]): string[] | null {
  const parsed = values.map((value) => parseContractField(value));
  return parsed.some((value) => value === null) ? null : (parsed as string[]);
}

const EMPTY_PUBLIC_KEY = PublicKey.empty().toBase58();

export function isExactVoteReducerPadding(
  vote: string,
  voterPublicKey: string,
): boolean {
  return vote === "dummy" && voterPublicKey === EMPTY_PUBLIC_KEY;
}
