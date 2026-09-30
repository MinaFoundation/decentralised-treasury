import { Poseidon, PublicKey } from "o1js";

/** Decode Mina's compressed ledger keys without requiring a curve point. */
export function ledgerPublicKeyFromBase58(encoded: string): PublicKey {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  if (typeof encoded !== "string" || encoded.length !== 55) {
    throw new Error("Invalid ledger public key encoding");
  }
  let value = 0n;
  for (const char of encoded) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error("Invalid ledger public key character");
    value = value * 58n + BigInt(digit);
  }
  const bytes = new Uint8Array(40);
  for (let i = bytes.length - 1; i >= 0; i--) {
    bytes[i] = Number(value & 255n);
    value >>= 8n;
  }
  if (
    value !== 0n ||
    bytes[0] !== 203 ||
    bytes[1] !== 1 ||
    bytes[2] !== 1 ||
    bytes[35]! > 1
  ) {
    throw new Error("Invalid ledger public key version or parity");
  }
  let x = 0n;
  for (let i = 34; i >= 3; i--) x = (x << 8n) | BigInt(bytes[i]!);
  const key = PublicKey.from({ x, isOdd: bytes[35] === 1 });
  // The canonical encoder verifies the checksum and rejects reduced x values.
  if (key.toBase58() !== encoded)
    throw new Error("Invalid ledger public key checksum or coordinate");
  return key;
}

/** Keep the PublicKey provable layout and use the ledger JSON decoder. */
export class LedgerPublicKey extends PublicKey {
  static fromJSON<T extends new (...args: any[]) => any>(
    this: T,
    value: string,
  ): InstanceType<T> {
    return ledgerPublicKeyFromBase58(value) as InstanceType<T>;
  }
}

export function publicKeyBase58ToBigInt(publicKey: string): bigint {
  return Poseidon.hash(
    ledgerPublicKeyFromBase58(publicKey).toFields(),
  ).toBigInt();
}
