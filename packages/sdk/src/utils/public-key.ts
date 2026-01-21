import { Poseidon, PublicKey } from "o1js";

export function publicKeyBase58ToBigInt(publicKey: string): bigint {
  const publicKeyObj = PublicKey.fromBase58(publicKey);
  return Poseidon.hash(publicKeyObj.toFields()).toBigInt();
}
