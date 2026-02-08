import { Mina, PrivateKey, Provable, UInt64 } from "o1js";

export async function createLocalBlockchain(
  proofsEnabled = process.env.PROOFS_ENABLED === "true",
) {
  const blockchain = await Mina.LocalBlockchain({ proofsEnabled });
  Provable.log(`Proofs enabled:`, proofsEnabled);
  Mina.setActiveInstance(blockchain);
  return { proofsEnabled, blockchain, feePayer: blockchain.testAccounts[0] };
}

export async function transaction(
  feePayer: { key: PrivateKey },
  cb: () => Promise<void>,
  fee = UInt64.from(1 * 10 ** 9),
) {
  const tx = await Mina.transaction(
    { sender: feePayer.key.toPublicKey(), fee },
    cb,
  );
  await tx.prove();
  tx.sign([feePayer.key]);
  const pendingTx = await tx.send();
  await pendingTx.wait();
}
