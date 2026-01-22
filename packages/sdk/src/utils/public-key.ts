import { Field, Poseidon, Provable, PublicKey } from "o1js";

export function publicKeyBase58ToBigInt(publicKey: string): bigint {
  const emptyPublicKey = PublicKey.empty();
  let publicKeyFields = emptyPublicKey.toFields();

  if (publicKey !== emptyPublicKey.toBase58()) {
    publicKeyFields = PublicKey.fromBase58(publicKey).toFields();
  }
  return Poseidon.hash(publicKeyFields).toBigInt();
}
