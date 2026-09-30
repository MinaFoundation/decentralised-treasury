import { Field } from "o1js";
import { packToFields } from "./account.js";
import { hashWithPrefix } from "./hashing-helpers.js";

/** Mina hashes each byte LSB-first, followed by a terminator bit. */
export function hashLedgerZkappUri(bytes: Uint8Array): Field {
  if (!(bytes instanceof Uint8Array))
    throw new Error("zkApp URI must contain bytes");
  if (bytes.length > 255) throw new Error("zkApp URI exceeds 255 bytes");
  const packeds: Array<[Field, number]> = [];
  for (const byte of bytes) {
    for (let bit = 0; bit < 8; bit++)
      packeds.push([Field((byte >> bit) & 1), 1]);
  }
  packeds.push([Field(1), 1]);
  return hashWithPrefix(
    "MinaZkappUri********",
    packToFields({ fieldElements: [], packeds }),
  );
}
