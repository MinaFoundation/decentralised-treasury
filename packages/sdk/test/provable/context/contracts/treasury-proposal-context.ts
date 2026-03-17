import { AccountUpdate, Mina, PrivateKey, Provable, UInt64 } from "o1js";
import { TreasuryProposalSmartContract } from "../../../../src/provable/contracts/treasury-proposal/treasury-proposal.js";

export function createTreasuryProposalTestContext() {
  const privateKey = PrivateKey.random();
  const publicKey = privateKey.toPublicKey();
  const contract = new TreasuryProposalSmartContract(publicKey);

  const compile = async (
    options?: Parameters<typeof TreasuryProposalSmartContract.compile>[0],
  ) => {
    return await TreasuryProposalSmartContract.compile(options);
  };

  const deploy = async (
    feePayer: { key: PrivateKey },
    fee = UInt64.from(1 * 10 ** 9),
    init: () => Promise<void> = async () => {},
  ) => {
    const tx = await Mina.transaction(
      { sender: feePayer.key.toPublicKey(), fee },
      async () => {
        AccountUpdate.fundNewAccount(feePayer.key.toPublicKey(), 1);
        await contract.deploy();
        await init();
      },
    );

    Provable.log("tx", tx.toPretty());

    tx.sign([feePayer.key, privateKey]);
    await tx.prove();
    const pendingTx = await tx.send();
    await pendingTx.wait();

    return { privateKey, publicKey, contract };
  };

  return {
    deploy,
    compile,
    privateKey,
    publicKey,
    contract,
  };
}
