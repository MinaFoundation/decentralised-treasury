import { Field, TokenSymbol } from "o1js";

/** TokenSymbol's provable layout, with the committed field stored in JSON. */
export class LedgerTokenSymbol extends TokenSymbol {
  static fromBytes(bytes: Uint8Array): TokenSymbol {
    if (!(bytes instanceof Uint8Array))
      throw new Error("Token symbol must contain bytes");
    if (bytes.length > 6) throw new Error("Token symbol exceeds six bytes");
    let value = 0n;
    for (let i = bytes.length - 1; i >= 0; i--)
      value = (value << 8n) | BigInt(bytes[i]!);
    return new TokenSymbol({
      field: Field(value),
      symbol: new TextDecoder().decode(bytes),
    });
  }

  static toJSON({ field }: TokenSymbol): string {
    return `field:${field.toString()}`;
  }

  static fromJSON(json: string): TokenSymbol {
    if (typeof json !== "string")
      throw new Error("Invalid stored token symbol");
    // Read legacy string records. New records never recompute the field from text.
    if (!json.startsWith("field:") || json === "field:")
      return this.fromBytes(new TextEncoder().encode(json));
    const value = json.slice(6);
    if (!/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) >= 1n << 48n) {
      throw new Error("Invalid stored token symbol field");
    }
    const field = Field(value);
    const bytes: number[] = [];
    for (let remaining = BigInt(value); remaining > 0n; remaining >>= 8n)
      bytes.push(Number(remaining & 255n));
    return new TokenSymbol({
      field,
      symbol: new TextDecoder().decode(new Uint8Array(bytes)),
    });
  }
}
