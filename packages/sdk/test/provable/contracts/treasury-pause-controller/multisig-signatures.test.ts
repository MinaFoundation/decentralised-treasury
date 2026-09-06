import test from "node:test";
import assert from "node:assert/strict";
import { Field, Poseidon, PrivateKey, UInt32 } from "o1js";
import {
  MIN_VALID_MULTISIG_SIGNATURES_COUNT,
  MULTISIG_PARTICIPANTS_COUNT,
  MultisigSignature,
  MultisigSignatures,
  MultisigSignaturesErrors,
} from "../../../../src/provable/contracts/treasury-pause-controller/multisig-signatures.js";
import { createMultisigSignaturesTestContext } from "../../context/contracts/multisig-signatures-context.js";

const TEST_NONCES = [
  UInt32.from(0),
  UInt32.from(1),
  UInt32.from(2),
  UInt32.MAXINT(),
];

test("multisig signature data hashes", async (t) => {
  await t.test("pause treasury data", async (t) => {
    await t.test(
      "should be deterministic for pause treasury data",
      async () => {
        for (const nonce of TEST_NONCES) {
          const hash1 = MultisigSignature.dataPauseTreasury(nonce);
          const hash2 = MultisigSignature.dataPauseTreasury(nonce);
          assert(hash1.equals(hash2).toBoolean());
        }
      },
    );
  });

  await t.test("unpause treasury data", async (t) => {
    await t.test(
      "should produce stable hashes for unpause treasury data",
      async () => {
        for (const nonce of TEST_NONCES) {
          const hash1 = MultisigSignature.dataUnpauseTreasury(nonce);
          const hash2 = MultisigSignature.dataUnpauseTreasury(nonce);
          assert(hash1.equals(hash2).toBoolean());
        }
      },
    );
  });

  await t.test("toggle pauseproposal data", async (t) => {
    await t.test(
      "should produce stable hashes for toggle pause proposal data",
      async () => {
        for (const nonce of TEST_NONCES) {
          const proposalKey = PrivateKey.random().toPublicKey();
          const hash1 = MultisigSignature.dataTogglePauseProposal(
            proposalKey,
            nonce,
          );
          const hash2 = MultisigSignature.dataTogglePauseProposal(
            proposalKey,
            nonce,
          );
          assert(hash1.equals(hash2).toBoolean());
        }
      },
    );

    await t.test(
      "should change hash for different proposal keys with same nonce",
      async () => {
        const nonce = UInt32.from(1);
        const proposalKey = PrivateKey.random().toPublicKey();
        const otherProposalKey = PrivateKey.random().toPublicKey();
        const hash1 = MultisigSignature.dataTogglePauseProposal(
          proposalKey,
          nonce,
        );
        const hash2 = MultisigSignature.dataTogglePauseProposal(
          otherProposalKey,
          nonce,
        );
        assert(hash1.equals(hash2).not().toBoolean());
      },
    );
  });

  await t.test("rotate multisig keys data", async (t) => {
    await t.test(
      "should produce stable hashes for rotate multisig keys data",
      async () => {
        const oldCommitment = Field(1);
        const newCommitment = Field(2);
        for (const nonce of TEST_NONCES) {
          const hash1 = MultisigSignature.dataRotateMultisigKeys(
            oldCommitment,
            newCommitment,
            nonce,
          );
          const hash2 = MultisigSignature.dataRotateMultisigKeys(
            oldCommitment,
            newCommitment,
            nonce,
          );
          assert(hash1.equals(hash2).toBoolean());
        }
      },
    );

    await t.test(
      "should change hash for different commitments with same nonce",
      async () => {
        const nonce = UInt32.from(1);
        const oldCommitment = Field(1);
        const newCommitment = Field(2);
        const hash1 = MultisigSignature.dataRotateMultisigKeys(
          oldCommitment,
          newCommitment,
          nonce,
        );
        const differentCommitment = Field(3);
        const differentCommitmentHash =
          MultisigSignature.dataRotateMultisigKeys(
            oldCommitment,
            differentCommitment,
            nonce,
          );
        assert(hash1.equals(differentCommitmentHash).not().toBoolean());
      },
    );

    await t.test(
      "should change hash for different old commitments with same nonce",
      async () => {
        const nonce = UInt32.from(1);
        const oldCommitment = Field(1);
        const newCommitment = Field(2);
        const hash1 = MultisigSignature.dataRotateMultisigKeys(
          oldCommitment,
          newCommitment,
          nonce,
        );
        const differentOldCommitment = Field(3);
        const differentOldCommitmentHash =
          MultisigSignature.dataRotateMultisigKeys(
            differentOldCommitment,
            newCommitment,
            nonce,
          );
        assert(hash1.equals(differentOldCommitmentHash).not().toBoolean());
      },
    );
  });

  await t.test("cross-method collisions", async (t) => {
    await t.test(
      "should differentiate all data hashes for the same nonce",
      async () => {
        for (const nonce of TEST_NONCES) {
          const pauseHash = MultisigSignature.dataPauseTreasury(nonce);
          const unpauseHash = MultisigSignature.dataUnpauseTreasury(nonce);
          const proposalKey = PrivateKey.random().toPublicKey();
          const toggleHash = MultisigSignature.dataTogglePauseProposal(
            proposalKey,
            nonce,
          );
          const rotateHash = MultisigSignature.dataRotateMultisigKeys(
            Field(1),
            Field(2),
            nonce,
          );

          const hashes = [pauseHash, unpauseHash, toggleHash, rotateHash];
          for (let i = 0; i < hashes.length; i += 1) {
            for (let j = i + 1; j < hashes.length; j += 1) {
              assert(
                hashes[i].equals(hashes[j]).not().toBoolean(),
                `expected hash ${i} to differ from hash ${j}`,
              );
            }
          }
        }
      },
    );
  });

  await t.test("cross-nonce collisions", async (t) => {
    await t.test(
      "should vary pause treasury hashes across nonce range",
      async () => {
        const hashes = TEST_NONCES.map((nonce) =>
          MultisigSignature.dataPauseTreasury(nonce),
        );
        for (let i = 0; i < hashes.length; i += 1) {
          for (let j = i + 1; j < hashes.length; j += 1) {
            assert(hashes[i].equals(hashes[j]).not().toBoolean());
          }
        }
      },
    );

    await t.test(
      "should vary unpause treasury hashes across nonce range",
      async () => {
        const hashes = TEST_NONCES.map((nonce) =>
          MultisigSignature.dataUnpauseTreasury(nonce),
        );
        for (let i = 0; i < hashes.length; i += 1) {
          for (let j = i + 1; j < hashes.length; j += 1) {
            assert(hashes[i].equals(hashes[j]).not().toBoolean());
          }
        }
      },
    );

    await t.test(
      "should vary toggle proposal hashes across nonce range",
      async () => {
        const proposalKey = PrivateKey.random().toPublicKey();
        const hashes = TEST_NONCES.map((nonce) =>
          MultisigSignature.dataTogglePauseProposal(proposalKey, nonce),
        );
        for (let i = 0; i < hashes.length; i += 1) {
          for (let j = i + 1; j < hashes.length; j += 1) {
            assert(hashes[i].equals(hashes[j]).not().toBoolean());
          }
        }
      },
    );

    await t.test(
      "should vary rotate keys hashes across nonce range",
      async () => {
        const oldCommitment = Field(1);
        const newCommitment = Field(2);
        const hashes = TEST_NONCES.map((nonce) =>
          MultisigSignature.dataRotateMultisigKeys(
            oldCommitment,
            newCommitment,
            nonce,
          ),
        );
        for (let i = 0; i < hashes.length; i += 1) {
          for (let j = i + 1; j < hashes.length; j += 1) {
            assert(hashes[i].equals(hashes[j]).not().toBoolean());
          }
        }
      },
    );
  });
});

test("multisig signature verification", async (t) => {
  let context = createMultisigSignaturesTestContext();

  t.beforeEach(() => {
    context = createMultisigSignaturesTestContext();
    context.generateParticipants();
    context.createCommitment();
  });

  await t.test("success cases", async (t) => {
    await t.test(
      "should verify with the minimum valid signatures",
      async () => {
        const data = Field(1);
        const signatures = context.createSignatures(
          data,
          MIN_VALID_MULTISIG_SIGNATURES_COUNT,
        );

        await signatures.verify(
          data,
          context.getCommitment()!,
          context.getPublicKeys(),
        );
      },
    );

    await t.test(
      "should verify with more than the minimum valid signatures",
      async () => {
        const data = Field(10);
        const signatures = context.createSignatures(
          data,
          MIN_VALID_MULTISIG_SIGNATURES_COUNT + 1,
        );
        await signatures.verify(
          data,
          context.getCommitment()!,
          context.getPublicKeys(),
        );
      },
    );

    await t.test("should verify with all signatures valid", async () => {
      const data = Field(13);
      const signatures = context.createSignatures(
        data,
        MULTISIG_PARTICIPANTS_COUNT,
      );
      await signatures.verify(
        data,
        context.getCommitment()!,
        context.getPublicKeys(),
      );
    });

    await t.test(
      "should verify with non-contiguous valid signatures",
      async () => {
        const data = Field(14);
        const signatures = new MultisigSignatures({
          signatures: Array.from(
            { length: MULTISIG_PARTICIPANTS_COUNT },
            (_, i) => {
              const participant = context.getParticipants()[i];
              if (participant && [0, 2, 4].includes(i)) {
                return MultisigSignature.create(participant.privateKey, [data]);
              }
              return MultisigSignature.empty();
            },
          ),
        });

        await signatures.verify(
          data,
          context.getCommitment()!,
          context.getPublicKeys(),
        );
      },
    );
  });

  await t.test("signature threshold failures", async (t) => {
    await t.test(
      "should fail verification with insufficient signatures",
      async () => {
        const data = Field(2);
        const signatures = context.createSignatures(
          data,
          MIN_VALID_MULTISIG_SIGNATURES_COUNT - 1,
        );

        await assert.rejects(
          async () =>
            signatures.verify(
              data,
              context.getCommitment()!,
              context.getPublicKeys(),
            ),
          new RegExp(MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES),
        );
      },
    );

    await t.test("should fail verification with empty signatures", async () => {
      const data = Field(7);
      const signatures = new MultisigSignatures({
        signatures: Array.from({ length: MULTISIG_PARTICIPANTS_COUNT }, () =>
          MultisigSignature.empty(),
        ),
      });

      await assert.rejects(
        async () =>
          signatures.verify(
            data,
            context.getCommitment()!,
            context.getPublicKeys(),
          ),
        new RegExp(MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES),
      );
    });

    await t.test(
      "should fail verification with duplicated signatures",
      async () => {
        const data = Field(8);
        const duplicateSignature = MultisigSignature.create(
          context.getParticipants()[0].privateKey,
          [data],
        );
        const signatures = new MultisigSignatures({
          signatures: Array.from(
            { length: MULTISIG_PARTICIPANTS_COUNT },
            (_, i) => (i < 2 ? duplicateSignature : MultisigSignature.empty()),
          ),
        });

        await assert.rejects(
          async () =>
            signatures.verify(
              data,
              context.getCommitment()!,
              context.getPublicKeys(),
            ),
          new RegExp(MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES),
        );
      },
    );
  });

  await t.test("data mismatch failures", async (t) => {
    await t.test("should fail verification with mismatched data", async () => {
      const data = Field(3);
      const signatures = context.createSignatures(
        data,
        MIN_VALID_MULTISIG_SIGNATURES_COUNT,
      );

      await assert.rejects(
        async () =>
          signatures.verify(
            Field(4),
            context.getCommitment()!,
            context.getPublicKeys(),
          ),
        new RegExp(MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES),
      );
    });

    await t.test(
      "should fail verification when data prefix changes",
      async () => {
        for (const nonce of TEST_NONCES) {
          const pauseData = MultisigSignature.dataPauseTreasury(nonce);
          const unpauseData = MultisigSignature.dataUnpauseTreasury(nonce);
          const signatures = context.createSignatures(
            pauseData,
            MIN_VALID_MULTISIG_SIGNATURES_COUNT,
          );

          await assert.rejects(
            async () =>
              signatures.verify(
                unpauseData,
                context.getCommitment()!,
                context.getPublicKeys(),
              ),
            new RegExp(MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES),
          );
        }
      },
    );

    await t.test(
      "should fail verification with signatures from other participants",
      async () => {
        const data = Field(15);
        const otherContext = createMultisigSignaturesTestContext();
        otherContext.generateParticipants();
        otherContext.createCommitment();
        const signatures = otherContext.createSignatures(
          data,
          MIN_VALID_MULTISIG_SIGNATURES_COUNT,
        );

        await assert.rejects(
          async () =>
            signatures.verify(
              data,
              context.getCommitment()!,
              context.getPublicKeys(),
            ),
          new RegExp(MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES),
        );
      },
    );
  });

  await t.test("commitment and ordering failures", async (t) => {
    await t.test(
      "should fail verification with mismatched commitment",
      async () => {
        const data = Field(5);
        const signatures = context.createSignatures(
          data,
          MIN_VALID_MULTISIG_SIGNATURES_COUNT,
        );
        const otherContext = createMultisigSignaturesTestContext();
        otherContext.generateParticipants();
        otherContext.createCommitment();

        await assert.rejects(
          async () =>
            signatures.verify(
              data,
              otherContext.getCommitment()!,
              context.getPublicKeys(),
            ),
          new RegExp(MultisigSignaturesErrors.INVALID_MULTISIG_COMMITMENT),
        );
      },
    );

    await t.test(
      "should fail verification with reordered participants but original commitment",
      async () => {
        const data = Field(9);
        const signatures = context.createSignatures(
          data,
          MULTISIG_PARTICIPANTS_COUNT,
        );
        const reorderedParticipants = [...context.getParticipants()].reverse();

        await assert.rejects(
          async () =>
            signatures.verify(
              data,
              context.getCommitment()!,
              reorderedParticipants.map((participant) => participant.publicKey),
            ),
          new RegExp(MultisigSignaturesErrors.INVALID_MULTISIG_COMMITMENT),
        );
      },
    );

    await t.test(
      "should fail verification with mismatched participant order",
      async () => {
        const data = Field(6);
        const signatures = context.createSignatures(
          data,
          MULTISIG_PARTICIPANTS_COUNT,
        );
        const reorderedParticipants = [...context.getParticipants()].reverse();
        const reorderedCommitment = Poseidon.hash(
          reorderedParticipants.flatMap((participant) =>
            participant.publicKey.toFields(),
          ),
        );

        await assert.rejects(
          async () =>
            signatures.verify(
              data,
              reorderedCommitment,
              reorderedParticipants.map((participant) => participant.publicKey),
            ),
          new RegExp(MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES),
        );
      },
    );

    await t.test(
      "should fail verification when signatures are shifted by index",
      async () => {
        const data = Field(11);
        const signatures = context.createSignatures(
          data,
          MULTISIG_PARTICIPANTS_COUNT,
        );
        const shiftedPublicKeys = [
          context.getPublicKeys()[context.getPublicKeys().length - 1],
          ...context.getPublicKeys().slice(0, -1),
        ];

        await assert.rejects(
          async () =>
            signatures.verify(
              data,
              context.getCommitment()!,
              shiftedPublicKeys,
            ),
          new RegExp(MultisigSignaturesErrors.INVALID_MULTISIG_COMMITMENT),
        );
      },
    );

    await t.test(
      "should fail verification with empty participants",
      async () => {
        const emptyContext = createMultisigSignaturesTestContext();
        emptyContext.generateParticipants(0);
        emptyContext.createCommitment();
        const data = Field(12);
        const signatures = emptyContext.createSignatures(data, 0, []);

        await assert.rejects(
          async () =>
            signatures.verify(
              data,
              emptyContext.getCommitment()!,
              emptyContext.getPublicKeys(),
            ),
          new RegExp(
            `toGroup|${MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES}`,
          ),
        );
      },
    );

    await t.test(
      "should fail verification with a shortened public key list",
      async () => {
        const data = Field(16);
        const signatures = context.createSignatures(
          data,
          MIN_VALID_MULTISIG_SIGNATURES_COUNT,
        );
        const shortPublicKeys = context.getPublicKeys().slice(0, -1);

        await assert.rejects(
          async () =>
            signatures.verify(data, context.getCommitment()!, shortPublicKeys),
          new RegExp(MultisigSignaturesErrors.INVALID_MULTISIG_COMMITMENT),
        );
      },
    );
  });
});
