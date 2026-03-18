import test from "node:test";
import assert from "node:assert/strict";
import { Field, PrivateKey, UInt32 } from "o1js";
import { createPauseControllerTestContext } from "../../context/contracts/treasury-pause-controller-context.js";
import {
  createLocalBlockchain,
  transaction,
} from "../../context/contracts/mina-local.js";
import {
  TreasuryPauseControllerSmartContract,
  TreasuryPauseControllerErrors,
} from "../../../../src/provable/contracts/treasury-pause-controller/treasury-pause-controller.js";
import {
  MIN_VALID_MULTISIG_SIGNATURES_COUNT,
  MultisigSignatures,
  MultisigSignaturesErrors,
} from "../../../../src/provable/contracts/treasury-pause-controller/multisig-signatures.js";

const { feePayer, blockchain } = await createLocalBlockchain();

test("compile", async (t) => {
  let context = createPauseControllerTestContext();

  t.beforeEach(() => {
    context = createPauseControllerTestContext();
  });

  await t.test("should compile", async () => {
    await context.compile({ forceRecompile: true });
  });

  await t.test(
    "should compile to the same verification key even if multisig participants are added",
    async () => {
      const artifacts1 = await context.compile();
      TreasuryPauseControllerSmartContract.multisigParticipants = context
        .generateMultisigParticipants()
        .map(({ publicKey }) => publicKey);
      const artifacts2 = await context.compile();

      assert(
        artifacts1.verificationKey.hash.toString() ==
          artifacts2.verificationKey.hash.toString(),
        "Verification key mismatch",
      );
    },
  );

  t.afterEach(() => {
    TreasuryPauseControllerSmartContract.multisigParticipants = [];
  });
});

test("deploy", async (t) => {
  let context = createPauseControllerTestContext();

  t.beforeEach(() => {
    context = createPauseControllerTestContext();
    TreasuryPauseControllerSmartContract.multisigParticipants = [];
  });

  await t.test(
    "should not deploy if not enough multisig participants",
    async () => {
      await assert.rejects(
        async () => context.deploy(feePayer),
        new RegExp(TreasuryPauseControllerErrors.NOT_ENOUGH_PARTICIPANTS),
      );
    },
  );

  await t.test("should deploy if enough multisig participants", async () => {
    context.generateMultisigParticipants();
    TreasuryPauseControllerSmartContract.multisigParticipants =
      context.getMultisigParticipants().publicKeys;
    await context.deploy(feePayer);

    const multisigCommitment =
      await context.contract.multisigCommitment.fetch();
    const paused = await context.getPaused();

    const expectedMultisigCommitment = MultisigSignatures.createCommitment(
      context.getMultisigParticipants().publicKeys,
    );

    const permissions = blockchain.getAccount(context.publicKey).permissions;

    assert(
      multisigCommitment.toBigInt() === expectedMultisigCommitment.toBigInt(),
      "Multisig commitment mismatch",
    );
    assert(paused?.toBoolean() === false, "Treasury should start unpaused");

    Object.entries(TreasuryPauseControllerSmartContract.permissions).forEach(
      ([key, value]) => {
        assert(
          permissions[key as keyof Permissions].toString() === value.toString(),
          `Permission ${key} mismatch`,
        );
      },
    );
  });
});

test("pause treasury", async (t) => {
  let context = createPauseControllerTestContext();

  t.beforeEach(async () => {
    context = createPauseControllerTestContext();
    context.generateMultisigParticipants();
    TreasuryPauseControllerSmartContract.multisigParticipants =
      context.getMultisigParticipants().publicKeys;
    await context.deploy(feePayer);
  });

  t.afterEach(() => {
    TreasuryPauseControllerSmartContract.multisigParticipants = [];
  });

  await t.test("should pause treasury with valid signatures", async () => {
    const initialNonce = context.getNonce(blockchain);
    const nonce = UInt32.from(initialNonce.toBigint());
    const signatures = context.createPauseTreasurySignatures(nonce);

    await transaction(feePayer, async () => {
      await context.contract.pauseTreasury(signatures, nonce);
    });

    const paused = await context.getPaused();
    assert(paused?.toBoolean() === true, "Treasury should be paused");

    const updatedNonce = context.getNonce(blockchain);
    assert(
      updatedNonce.toBigint() === initialNonce.toBigint() + 1n,
      "Nonce should increment after pause",
    );
  });

  await t.test(
    "should reject pause treasury with incorrect nonce",
    async () => {
      const initialNonce = context.getNonce(blockchain);
      const wrongNonce = UInt32.from(initialNonce.toBigint() + 1n);
      const signatures = context.createPauseTreasurySignatures(wrongNonce);

      await assert.rejects(async () => {
        await transaction(feePayer, async () => {
          await context.contract.pauseTreasury(signatures, wrongNonce);
        });
      });

      const paused = await context.getPaused();
      assert(paused?.toBoolean() === false, "Treasury should not be paused");

      const updatedNonce = context.getNonce(blockchain);
      assert(
        updatedNonce.toBigint() === initialNonce.toBigint(),
        "Nonce should not change on failure",
      );
    },
  );

  await t.test(
    "should reject pause treasury with insufficient signatures",
    async () => {
      const initialNonce = context.getNonce(blockchain);
      const nonce = UInt32.from(initialNonce.toBigint());
      const signatures = context.createPauseTreasurySignatures(
        nonce,
        MIN_VALID_MULTISIG_SIGNATURES_COUNT - 1,
      );

      await assert.rejects(async () => {
        await transaction(feePayer, async () => {
          await context.contract.pauseTreasury(signatures, nonce);
        });
      }, new RegExp(MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES));

      const paused = await context.getPaused();
      assert(paused?.toBoolean() === false, "Treasury should not be paused");

      const updatedNonce = context.getNonce(blockchain);
      assert(
        updatedNonce.toBigint() === initialNonce.toBigint(),
        "Nonce should not change on failure",
      );
    },
  );
});

test("unpause treasury", async (t) => {
  let context = createPauseControllerTestContext();

  t.beforeEach(async () => {
    context = createPauseControllerTestContext();
    context.generateMultisigParticipants();
    TreasuryPauseControllerSmartContract.multisigParticipants =
      context.getMultisigParticipants().publicKeys;
    await context.deploy(feePayer);

    const pauseNonce = UInt32.from(context.getNonce(blockchain).toBigint());
    const pauseSignatures = context.createPauseTreasurySignatures(pauseNonce);
    await transaction(feePayer, async () => {
      await context.contract.pauseTreasury(pauseSignatures, pauseNonce);
    });
  });

  t.afterEach(() => {
    TreasuryPauseControllerSmartContract.multisigParticipants = [];
  });

  await t.test("should unpause treasury with valid signatures", async () => {
    const initialNonce = context.getNonce(blockchain);
    const nonce = UInt32.from(initialNonce.toBigint());
    const signatures = context.createUnpauseTreasurySignatures(nonce);

    await transaction(feePayer, async () => {
      await context.contract.unpauseTreasury(signatures, nonce);
    });

    const paused = await context.getPaused();
    assert(paused?.toBoolean() === false, "Treasury should be unpaused");

    const updatedNonce = context.getNonce(blockchain);
    assert(
      updatedNonce.toBigint() === initialNonce.toBigint() + 1n,
      "Nonce should increment after unpause",
    );
  });

  await t.test(
    "should reject unpause treasury with incorrect nonce",
    async () => {
      const initialNonce = context.getNonce(blockchain);
      const wrongNonce = UInt32.from(initialNonce.toBigint() + 1n);
      const signatures = context.createUnpauseTreasurySignatures(wrongNonce);

      await assert.rejects(async () => {
        await transaction(feePayer, async () => {
          await context.contract.unpauseTreasury(signatures, wrongNonce);
        });
      });

      const paused = await context.getPaused();
      assert(paused?.toBoolean() === true, "Treasury should remain paused");

      const updatedNonce = context.getNonce(blockchain);
      assert(
        updatedNonce.toBigint() === initialNonce.toBigint(),
        "Nonce should not change on failure",
      );
    },
  );

  await t.test(
    "should reject unpause treasury with insufficient signatures",
    async () => {
      const initialNonce = context.getNonce(blockchain);
      const nonce = UInt32.from(initialNonce.toBigint());
      const signatures = context.createUnpauseTreasurySignatures(
        nonce,
        MIN_VALID_MULTISIG_SIGNATURES_COUNT - 1,
      );

      await assert.rejects(async () => {
        await transaction(feePayer, async () => {
          await context.contract.unpauseTreasury(signatures, nonce);
        });
      }, new RegExp(MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES));

      const paused = await context.getPaused();
      assert(paused?.toBoolean() === true, "Treasury should remain paused");

      const updatedNonce = context.getNonce(blockchain);
      assert(
        updatedNonce.toBigint() === initialNonce.toBigint(),
        "Nonce should not change on failure",
      );
    },
  );
});

test("toggle pause proposal", async (t) => {
  let context = createPauseControllerTestContext();

  t.beforeEach(async () => {
    context = createPauseControllerTestContext();
    context.generateMultisigParticipants();
    TreasuryPauseControllerSmartContract.multisigParticipants =
      context.getMultisigParticipants().publicKeys;
    await context.deploy(feePayer);
  });

  t.afterEach(() => {
    TreasuryPauseControllerSmartContract.multisigParticipants = [];
  });

  await t.test(
    "should toggle pause proposal with valid signatures",
    async () => {
      const initialNonce = context.getNonce(blockchain);
      const nonce = UInt32.from(initialNonce.toBigint());
      const proposalPublicKey = PrivateKey.random().toPublicKey();
      const signatures = context.createTogglePauseProposalSignatures(
        proposalPublicKey,
        nonce,
      );

      await transaction(feePayer, async () => {
        await context.contract.togglePauseProposal(
          proposalPublicKey,
          signatures,
          nonce,
        );
      });

      const updatedNonce = context.getNonce(blockchain);
      assert(
        updatedNonce.toBigint() === initialNonce.toBigint() + 1n,
        "Nonce should increment after toggle pause proposal",
      );
    },
  );

  await t.test(
    "should reject toggle pause proposal with incorrect nonce",
    async () => {
      const initialNonce = context.getNonce(blockchain);
      const wrongNonce = UInt32.from(initialNonce.toBigint() + 1n);
      const proposalPublicKey = PrivateKey.random().toPublicKey();
      const signatures = context.createTogglePauseProposalSignatures(
        proposalPublicKey,
        wrongNonce,
      );

      await assert.rejects(async () => {
        await transaction(feePayer, async () => {
          await context.contract.togglePauseProposal(
            proposalPublicKey,
            signatures,
            wrongNonce,
          );
        });
      });

      const updatedNonce = context.getNonce(blockchain);
      assert(
        updatedNonce.toBigint() === initialNonce.toBigint(),
        "Nonce should not change on failure",
      );
    },
  );

  await t.test(
    "should reject toggle pause proposal with insufficient signatures",
    async () => {
      const initialNonce = context.getNonce(blockchain);
      const nonce = UInt32.from(initialNonce.toBigint());
      const proposalPublicKey = PrivateKey.random().toPublicKey();
      const signatures = context.createTogglePauseProposalSignatures(
        proposalPublicKey,
        nonce,
        MIN_VALID_MULTISIG_SIGNATURES_COUNT - 1,
      );

      await assert.rejects(async () => {
        await transaction(feePayer, async () => {
          await context.contract.togglePauseProposal(
            proposalPublicKey,
            signatures,
            nonce,
          );
        });
      }, new RegExp(MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES));

      const updatedNonce = context.getNonce(blockchain);
      assert(
        updatedNonce.toBigint() === initialNonce.toBigint(),
        "Nonce should not change on failure",
      );
    },
  );
});

test("rotate multisig keys", async (t) => {
  let context = createPauseControllerTestContext();

  t.beforeEach(async () => {
    context = createPauseControllerTestContext();
    context.generateMultisigParticipants();
    TreasuryPauseControllerSmartContract.multisigParticipants =
      context.getMultisigParticipants().publicKeys;
    await context.deploy(feePayer);
  });

  t.afterEach(() => {
    TreasuryPauseControllerSmartContract.multisigParticipants = [];
  });

  await t.test(
    "should rotate multisig keys with valid signatures",
    async () => {
      const initialNonce = context.getNonce(blockchain);
      const nonce = UInt32.from(initialNonce.toBigint());
      const oldCommitment = await context.contract.multisigCommitment.fetch();
      const newCommitment = MultisigSignatures.createCommitment(
        createPauseControllerTestContext()
          .generateMultisigParticipants()
          .map(({ publicKey }) => publicKey),
      );
      const signatures = context.createRotateMultisigKeysSignatures(
        oldCommitment ?? Field(0),
        newCommitment,
        nonce,
      );

      await transaction(feePayer, async () => {
        await context.contract.rotateMultisigKeys(
          newCommitment,
          nonce,
          signatures,
        );
      });

      const updatedNonce = context.getNonce(blockchain);
      assert(
        updatedNonce.toBigint() === initialNonce.toBigint() + 1n,
        "Nonce should increment after rotate multisig keys",
      );

      const updatedCommitment =
        await context.contract.multisigCommitment.fetch();
      assert(
        updatedCommitment?.toBigInt() === newCommitment.toBigInt(),
        "Multisig commitment should update after rotate",
      );
    },
  );

  await t.test(
    "should reject rotate multisig keys with incorrect nonce",
    async () => {
      const initialNonce = context.getNonce(blockchain);
      const wrongNonce = UInt32.from(initialNonce.toBigint() + 1n);
      const oldCommitment = await context.contract.multisigCommitment.fetch();
      const newCommitment = MultisigSignatures.createCommitment(
        createPauseControllerTestContext()
          .generateMultisigParticipants()
          .map(({ publicKey }) => publicKey),
      );
      const signatures = context.createRotateMultisigKeysSignatures(
        oldCommitment ?? Field(0),
        newCommitment,
        wrongNonce,
      );

      await assert.rejects(async () => {
        await transaction(feePayer, async () => {
          await context.contract.rotateMultisigKeys(
            newCommitment,
            wrongNonce,
            signatures,
          );
        });
      });

      const updatedNonce = context.getNonce(blockchain);
      assert(
        updatedNonce.toBigint() === initialNonce.toBigint(),
        "Nonce should not change on failure",
      );

      const updatedCommitment =
        await context.contract.multisigCommitment.fetch();
      assert(
        updatedCommitment?.toBigInt() === oldCommitment?.toBigInt(),
        "Multisig commitment should not change on failure",
      );
    },
  );

  await t.test(
    "should reject rotate multisig keys with mismatched current commitment",
    async () => {
      const initialNonce = context.getNonce(blockchain);
      const nonce = UInt32.from(initialNonce.toBigint());
      const oldCommitment = await context.contract.multisigCommitment.fetch();
      const newCommitment = MultisigSignatures.createCommitment(
        createPauseControllerTestContext()
          .generateMultisigParticipants()
          .map(({ publicKey }) => publicKey),
      );
      const wrongOldCommitment = Field(0);
      const signatures = context.createRotateMultisigKeysSignatures(
        wrongOldCommitment,
        newCommitment,
        nonce,
      );

      await assert.rejects(async () => {
        await transaction(feePayer, async () => {
          await context.contract.rotateMultisigKeys(
            newCommitment,
            nonce,
            signatures,
          );
        });
      }, new RegExp(MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES));

      const updatedNonce = context.getNonce(blockchain);
      assert(
        updatedNonce.toBigint() === initialNonce.toBigint(),
        "Nonce should not change on failure",
      );

      const updatedCommitment =
        await context.contract.multisigCommitment.fetch();
      assert(
        updatedCommitment?.toBigInt() === oldCommitment?.toBigInt(),
        "Multisig commitment should not change on failure",
      );
    },
  );

  await t.test(
    "should reject rotate multisig keys with insufficient signatures",
    async () => {
      const initialNonce = context.getNonce(blockchain);
      const nonce = UInt32.from(initialNonce.toBigint());
      const oldCommitment = await context.contract.multisigCommitment.fetch();
      const newCommitment = MultisigSignatures.createCommitment(
        createPauseControllerTestContext()
          .generateMultisigParticipants()
          .map(({ publicKey }) => publicKey),
      );
      const signatures = context.createRotateMultisigKeysSignatures(
        oldCommitment ?? Field(0),
        newCommitment,
        nonce,
        MIN_VALID_MULTISIG_SIGNATURES_COUNT - 1,
      );

      await assert.rejects(async () => {
        await transaction(feePayer, async () => {
          await context.contract.rotateMultisigKeys(
            newCommitment,
            nonce,
            signatures,
          );
        });
      }, new RegExp(MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES));

      const updatedNonce = context.getNonce(blockchain);
      assert(
        updatedNonce.toBigint() === initialNonce.toBigint(),
        "Nonce should not change on failure",
      );

      const updatedCommitment =
        await context.contract.multisigCommitment.fetch();
      assert(
        updatedCommitment?.toBigInt() === oldCommitment?.toBigInt(),
        "Multisig commitment should not change on failure",
      );
    },
  );

  await t.test(
    "should reject old keys after rotation and accept new keys",
    async () => {
      const initialNonce = context.getNonce(blockchain);
      const nonce = UInt32.from(initialNonce.toBigint());
      const oldCommitment = await context.contract.multisigCommitment.fetch();
      const nextContext = createPauseControllerTestContext();
      const newParticipants = nextContext.generateMultisigParticipants();
      const newPublicKeys = newParticipants.map(({ publicKey }) => publicKey);
      const newCommitment = MultisigSignatures.createCommitment(newPublicKeys);
      const rotateSignatures = context.createRotateMultisigKeysSignatures(
        oldCommitment ?? Field(0),
        newCommitment,
        nonce,
      );

      await transaction(feePayer, async () => {
        await context.contract.rotateMultisigKeys(
          newCommitment,
          nonce,
          rotateSignatures,
        );
      });

      TreasuryPauseControllerSmartContract.multisigParticipants = newPublicKeys;

      const oldKeysNonce = UInt32.from(context.getNonce(blockchain).toBigint());
      const oldKeysSignatures =
        context.createPauseTreasurySignatures(oldKeysNonce);

      await assert.rejects(async () => {
        await transaction(feePayer, async () => {
          await context.contract.pauseTreasury(oldKeysSignatures, oldKeysNonce);
        });
      }, new RegExp(MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES));

      const successInitialNonce = context.getNonce(blockchain);
      const newKeysNonce = UInt32.from(successInitialNonce.toBigint());
      const newKeysSignatures =
        nextContext.createPauseTreasurySignatures(newKeysNonce);

      await transaction(feePayer, async () => {
        await context.contract.pauseTreasury(newKeysSignatures, newKeysNonce);
      });

      const paused = await context.getPaused();
      assert(paused?.toBoolean() === true, "Treasury should be paused");

      const successUpdatedNonce = context.getNonce(blockchain);
      assert(
        successUpdatedNonce.toBigint() === successInitialNonce.toBigint() + 1n,
        "Nonce should increment after pause with new keys",
      );
    },
  );
});

test("require not paused", async (t) => {
  let context = createPauseControllerTestContext();

  t.beforeEach(async () => {
    context = createPauseControllerTestContext();
    context.generateMultisigParticipants();
    TreasuryPauseControllerSmartContract.multisigParticipants =
      context.getMultisigParticipants().publicKeys;
    await context.deploy(feePayer);
  });

  t.afterEach(() => {
    TreasuryPauseControllerSmartContract.multisigParticipants = [];
  });

  await t.test("should allow when treasury is not paused", async () => {
    await transaction(feePayer, async () => {
      await context.contract.requireNotPaused();
    });
  });

  await t.test("should reject when treasury is paused", async () => {
    const pauseNonce = UInt32.from(context.getNonce(blockchain).toBigint());
    const pauseSignatures = context.createPauseTreasurySignatures(pauseNonce);
    await transaction(feePayer, async () => {
      await context.contract.pauseTreasury(pauseSignatures, pauseNonce);
    });

    await assert.rejects(async () => {
      await transaction(feePayer, async () => {
        await context.contract.requireNotPaused();
      });
    }, new RegExp(TreasuryPauseControllerErrors.TREASURY_PAUSED));
  });
});
