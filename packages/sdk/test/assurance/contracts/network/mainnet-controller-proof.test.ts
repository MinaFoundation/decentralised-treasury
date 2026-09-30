import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  Bool,
  Field,
  Mina,
  PrivateKey,
  UInt32,
  UInt64,
  addCachedAccount,
  setNumberOfWorkers,
  verify,
} from "o1js";
import { TreasuryPauseControllerSmartContract } from "../../../../src/provable/contracts/treasury-pause-controller/treasury-pause-controller.js";
import { MultisigSignatures } from "../../../../src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import { configureProvingNetwork } from "../../../../src/proving/proving-network.js";

test(
  "a Mainnet Controller method proves with the Mainnet key and rejects the Devnet key",
  {
    skip: process.env.O1JS_SECURITY_PROOFS !== "true",
    timeout: 900_000,
  },
  async (t) => {
    setNumberOfWorkers(2);
    const previousDirectory = process.cwd();
    const previousNetwork = process.env.NETWORK;
    const previousNodeUrl = process.env.MINA_NODE_URL;
    const cacheRoot = await mkdtemp(join(tmpdir(), "treasury-network-proof-"));
    const minaNodeUrl = "http://127.0.0.1:65534/graphql";
    const participantKeys = Array.from({ length: 5 }, (_, index) =>
      PrivateKey.fromBigInt(BigInt(90_100 + index)),
    );
    TreasuryPauseControllerSmartContract.multisigParticipants =
      participantKeys.map((key) => key.toPublicKey());

    t.after(() => {
      process.chdir(previousDirectory);
      if (previousNetwork === undefined) delete process.env.NETWORK;
      else process.env.NETWORK = previousNetwork;
      if (previousNodeUrl === undefined) delete process.env.MINA_NODE_URL;
      else process.env.MINA_NODE_URL = previousNodeUrl;
      TreasuryPauseControllerSmartContract.multisigParticipants = [];
    });

    process.chdir(cacheRoot);
    process.env.MINA_NODE_URL = minaNodeUrl;
    process.env.NETWORK = "mainnet";
    const mainnet = configureProvingNetwork();
    assert.equal(mainnet.network, "mainnet");
    assert.equal(Mina.getNetworkId(), "mainnet");
    const { verificationKey: mainnetVerificationKey } =
      await TreasuryPauseControllerSmartContract.compile({
        cache: mainnet.cache,
      });

    const controllerKey = PrivateKey.fromBigInt(90_200n);
    const controllerAddress = controllerKey.toPublicKey();
    const commitment = MultisigSignatures.createCommitment(
      TreasuryPauseControllerSmartContract.multisigParticipants,
    );
    addCachedAccount(
      {
        publicKey: controllerAddress,
        balance: UInt64.from(10_000_000_000),
        nonce: UInt32.from(0),
        zkapp: {
          appState: [
            commitment,
            Bool(false).toField(),
            ...Array.from({ length: 6 }, () => Field(0)),
          ],
          verificationKey: mainnetVerificationKey,
        },
      },
      minaNodeUrl,
    );
    const controller = new TreasuryPauseControllerSmartContract(
      controllerAddress,
    );
    const transaction = await Mina.transaction(undefined, async () => {
      await controller.requireNotPaused();
    });
    const proved = await transaction.prove();
    const proof = proved.proofs.find((value) => value !== undefined);
    assert(proof, "the Controller method must produce one proof");
    assert.equal(await verify(proof, mainnetVerificationKey), true);

    process.env.NETWORK = "devnet";
    const devnet = configureProvingNetwork();
    assert.equal(devnet.network, "devnet");
    assert.equal(Mina.getNetworkId(), "devnet");
    const { verificationKey: devnetVerificationKey } =
      await TreasuryPauseControllerSmartContract.compile({
        cache: devnet.cache,
      });

    assert.notEqual(
      mainnetVerificationKey.hash.toString(),
      devnetVerificationKey.hash.toString(),
    );
    assert.equal(await verify(proof, devnetVerificationKey), false);
    await access(join(cacheRoot, "cache", "mainnet"));
    await access(join(cacheRoot, "cache", "devnet"));
  },
);
