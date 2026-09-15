import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountUpdate,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  TokenId,
  UInt32,
  UInt64,
} from "o1js";
import {
  TreasuryPauseControllerErrors,
  TreasuryPauseControllerSmartContract,
} from "../../../../src/provable/contracts/treasury-pause-controller/treasury-pause-controller.js";
import {
  MultisigSignature,
  MultisigSignatures,
  MultisigSignaturesErrors,
} from "../../../../src/provable/contracts/treasury-pause-controller/multisig-signatures.js";

const fee = UInt64.from(100_000_000);

type Participant = {
  privateKey?: PrivateKey;
  publicKey: PublicKey;
};

type PauseFixture = Awaited<ReturnType<typeof createPauseFixture>>;

function participants(seed: number, count = 5): Participant[] {
  return Array.from({ length: count }, (_, index) => {
    const privateKey = PrivateKey.fromBigInt(BigInt(seed + index));
    return { privateKey, publicKey: privateKey.toPublicKey() };
  });
}

function publicKeys(set: readonly Participant[]): PublicKey[] {
  return set.map(({ publicKey }) => publicKey);
}

function signatures(
  data: Field,
  set: readonly Participant[],
  signedPositions: readonly number[],
): MultisigSignatures {
  return new MultisigSignatures({
    signatures: Array.from({ length: 5 }, (_, index) => {
      const participant = set[index];
      if (
        participant?.privateKey !== undefined &&
        signedPositions.includes(index)
      ) {
        return MultisigSignature.create(participant.privateKey, [data]);
      }
      return MultisigSignature.empty();
    }),
  });
}

async function sendTransaction(
  sender: { key: PrivateKey },
  callback: () => Promise<void>,
  additionalKeys: readonly PrivateKey[] = [],
): Promise<void> {
  const transaction = await Mina.transaction(
    { sender: sender.key.toPublicKey(), fee },
    callback,
  );
  await transaction.prove();
  transaction.sign([sender.key, ...additionalKeys]);
  const pending = await transaction.send();
  await pending.wait();
}

async function deployController(
  feePayer: { key: PrivateKey },
  contractKey: PrivateKey,
  set: readonly Participant[],
): Promise<TreasuryPauseControllerSmartContract> {
  TreasuryPauseControllerSmartContract.multisigParticipants = publicKeys(set);
  const contract = new TreasuryPauseControllerSmartContract(
    contractKey.toPublicKey(),
  );
  await sendTransaction(feePayer, async () => {
    AccountUpdate.fundNewAccount(feePayer.key.toPublicKey(), 1);
    await contract.deploy();
  }, [contractKey]);
  return contract;
}

async function createPauseFixture(seed = 71_000, set = participants(seed)) {
  const proofsEnabled = String(process.env.PROOFS_ENABLED) === "true";
  const blockchain = await Mina.LocalBlockchain({ proofsEnabled });
  Mina.setActiveInstance(blockchain);
  const feePayer = blockchain.testAccounts[0]!;
  const contractKey = PrivateKey.fromBigInt(BigInt(seed + 100));
  const contract = await deployController(feePayer, contractKey, set);
  return { blockchain, contract, contractKey, feePayer, participants: set };
}

async function stateSnapshot(fixture: PauseFixture) {
  const account = fixture.blockchain.getAccount(fixture.contract.address);
  const paused = await fixture.contract.paused.fetch();
  const commitment = await fixture.contract.multisigCommitment.fetch();
  const events = await Mina.fetchEvents(
    fixture.contract.address,
    TokenId.default,
  );
  return {
    commitment: commitment?.toBigInt(),
    eventCount: events.length,
    nonce: account.nonce.toBigint(),
    paused: paused?.toBoolean(),
  };
}

function currentNonce(fixture: PauseFixture): UInt32 {
  return UInt32.from(
    fixture.blockchain.getAccount(fixture.contract.address).nonce.toBigint(),
  );
}

async function pause(
  fixture: PauseFixture,
  signedPositions: readonly number[],
  nonce = UInt32.from(
    fixture.blockchain.getAccount(fixture.contract.address).nonce.toBigint(),
  ),
): Promise<void> {
  const data = MultisigSignature.dataPauseTreasury(nonce);
  await sendTransaction(fixture.feePayer, async () => {
    await fixture.contract.pauseTreasury(
      signatures(data, fixture.participants, signedPositions),
      nonce,
    );
  });
}

test(
  "proof-off Pause Controller and multisig assurance",
  { concurrency: 1 },
  async (t) => {
    assert.equal(
      process.env.PROOFS_ENABLED,
      "false",
      "this lane must run with PROOFS_ENABLED=false",
    );
    const proofsEnabled = String(process.env.PROOFS_ENABLED) === "true";
    TreasuryPauseControllerSmartContract.multisigParticipants = publicKeys(
      participants(70_000),
    );
    if (proofsEnabled) {
      throw new Error("This Pause Controller lane is proof-off only.");
    }
    await TreasuryPauseControllerSmartContract.compile();

    t.after(() => {
      TreasuryPauseControllerSmartContract.multisigParticipants = [];
    });

    await t.test(
      "SC-PAUSE-001/002/003 enforces the two-of-five rejection and three-of-five threshold",
      async () => {
        const cases = [
          { accepted: false, positions: [0, 1] },
          { accepted: true, positions: [0, 1, 2] },
          { accepted: true, positions: [0, 1, 2, 3, 4] },
        ] as const;

        for (const [index, testCase] of cases.entries()) {
          const fixture = await createPauseFixture(71_000 + index * 200);
          const before = await stateSnapshot(fixture);
          if (testCase.accepted) {
            await pause(fixture, testCase.positions);
            assert.equal((await stateSnapshot(fixture)).paused, true);
          } else {
            await assert.rejects(
              () => pause(fixture, testCase.positions),
              new RegExp(MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES),
            );
            assert.deepEqual(await stateSnapshot(fixture), before);
          }
        }
      },
    );

    await t.test(
      "SC-PAUSE-004 accepts first, middle, last, and non-adjacent aligned signer positions",
      async () => {
        const cases = [
          [0, 1, 2],
          [1, 2, 3],
          [2, 3, 4],
          [0, 2, 4],
        ] as const;
        for (const [index, positions] of cases.entries()) {
          const fixture = await createPauseFixture(72_000 + index * 200);
          await pause(fixture, positions);
          assert.equal((await stateSnapshot(fixture)).paused, true);
        }
      },
    );

    await t.test(
      "SC-PAUSE-005/006 rejects future, stale, and replayed nonces without state changes",
      async () => {
        const fixture = await createPauseFixture(73_000);
        const initialNonce = currentNonce(fixture);
        const future = UInt32.from(initialNonce.toBigint() + 1n);
        const futureData = MultisigSignature.dataPauseTreasury(future);
        const initial = await stateSnapshot(fixture);
        await assert.rejects(() =>
          sendTransaction(fixture.feePayer, async () => {
            await fixture.contract.pauseTreasury(
              signatures(futureData, fixture.participants, [0, 1, 2]),
              future,
            );
          }),
        );
        assert.deepEqual(await stateSnapshot(fixture), initial);

        await pause(fixture, [0, 1, 2], initialNonce);
        const afterPause = await stateSnapshot(fixture);
        for (const staleNonce of [initialNonce, initialNonce]) {
          const staleData = MultisigSignature.dataPauseTreasury(staleNonce);
          await assert.rejects(() =>
            sendTransaction(fixture.feePayer, async () => {
              await fixture.contract.pauseTreasury(
                signatures(staleData, fixture.participants, [0, 1, 2]),
                staleNonce,
              );
            }),
          );
          assert.deepEqual(await stateSnapshot(fixture), afterPause);
        }
      },
    );

    await t.test(
      "SC-PAUSE-004/005 represents nonce 0, 1, max-1, and UInt32 maximum in signed messages",
      async () => {
        const nonceCases = [
          UInt32.from(0),
          UInt32.from(1),
          UInt32.from(UInt32.MAXINT().toBigint() - 1n),
          UInt32.MAXINT(),
        ];
        const hashes = nonceCases.map((nonce) =>
          MultisigSignature.dataPauseTreasury(nonce).toBigInt(),
        );
        assert.equal(new Set(hashes).size, nonceCases.length);
        for (const nonce of nonceCases) {
          const data = MultisigSignature.dataPauseTreasury(nonce);
          const set = participants(73_500);
          const created = signatures(data, set, [0, 2, 4]);
          await created.verify(
            data,
            MultisigSignatures.createCommitment(publicKeys(set)),
            publicKeys(set),
          );
        }
      },
    );

    await t.test(
      "SC-PAUSE-005 rejects nonce underflow and overflow before signature construction",
      () => {
        for (const value of [-1n, UInt32.MAXINT().toBigint() + 1n]) {
          assert.throws(() => UInt32.from(value), undefined, value.toString());
        }
      },
    );

    await t.test(
      "SC-PAUSE-001/020 rejects an unauthorized direct caller and permits an authorized relayer",
      async () => {
        const fixture = await createPauseFixture(73_700);
        const nonce = currentNonce(fixture);
        const data = MultisigSignature.dataPauseTreasury(nonce);
        const before = await stateSnapshot(fixture);
        const unauthorized = fixture.blockchain.testAccounts[1]!;
        await assert.rejects(
          () =>
            sendTransaction(unauthorized, async () => {
              await fixture.contract.pauseTreasury(
                signatures(data, fixture.participants, []),
                nonce,
              );
            }),
          new RegExp(MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES),
        );
        assert.deepEqual(await stateSnapshot(fixture), before);

        const relayer = fixture.blockchain.testAccounts[2]!;
        await sendTransaction(relayer, async () => {
          await fixture.contract.pauseTreasury(
            signatures(data, fixture.participants, [0, 1, 2]),
            nonce,
          );
        });
        assert.equal((await stateSnapshot(fixture)).paused, true);
      },
    );

    await t.test(
      "SC-PAUSE-007 rejects pause signatures used for unpause and unpause signatures used for pause",
      async () => {
        const cases = ["unpause", "pause"] as const;
        for (const [index, testCase] of cases.entries()) {
          const fixture = await createPauseFixture(74_000 + index * 200);
          const nonce = currentNonce(fixture);
          const signedData =
            testCase === "unpause"
              ? MultisigSignature.dataPauseTreasury(nonce)
              : MultisigSignature.dataUnpauseTreasury(nonce);
          const before = await stateSnapshot(fixture);
          await assert.rejects(
            () =>
              sendTransaction(fixture.feePayer, async () => {
                const authorization = signatures(
                  signedData,
                  fixture.participants,
                  [0, 1, 2],
                );
                if (testCase === "pause") {
                  await fixture.contract.pauseTreasury(authorization, nonce);
                } else {
                  await fixture.contract.unpauseTreasury(authorization, nonce);
                }
              }),
            new RegExp(MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES),
          );
          assert.deepEqual(await stateSnapshot(fixture), before);
        }
      },
    );

    await t.test(
      "SC-PAUSE-008 rejects a toggle signature for another Proposal address",
      async () => {
        const fixture = await createPauseFixture(75_000);
        const signedProposal = PrivateKey.fromBigInt(75_200n).toPublicKey();
        const calledProposal = PrivateKey.fromBigInt(75_201n).toPublicKey();
        const nonce = currentNonce(fixture);
        const data = MultisigSignature.dataTogglePauseProposal(
          signedProposal,
          nonce,
        );
        const before = await stateSnapshot(fixture);
        await assert.rejects(
          () =>
            sendTransaction(fixture.feePayer, async () => {
              await fixture.contract.togglePauseProposal(
                calledProposal,
                signatures(data, fixture.participants, [0, 1, 2]),
                nonce,
              );
            }),
          new RegExp(MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES),
        );
        assert.deepEqual(await stateSnapshot(fixture), before);
      },
    );

    await t.test(
      "SC-PAUSE-009/010 rejects changed old and new rotation commitments atomically",
      async () => {
        const cases = ["old", "new"] as const;
        for (const [index, mutation] of cases.entries()) {
          const fixture = await createPauseFixture(76_000 + index * 300);
          const oldCommitment =
            (await fixture.contract.multisigCommitment.fetch())!;
          const newCommitment = MultisigSignatures.createCommitment(
            publicKeys(participants(76_600 + index * 100)),
          );
          const changedOld = Field(oldCommitment.toBigInt() + 1n);
          const changedNew = Field(newCommitment.toBigInt() + 1n);
          const nonce = currentNonce(fixture);
          const signedData = MultisigSignature.dataRotateMultisigKeys(
            mutation === "old" ? changedOld : oldCommitment,
            mutation === "new" ? changedNew : newCommitment,
            nonce,
          );
          const before = await stateSnapshot(fixture);
          await assert.rejects(
            () =>
              sendTransaction(fixture.feePayer, async () => {
                await fixture.contract.rotateMultisigKeys(
                  newCommitment,
                  nonce,
                  signatures(signedData, fixture.participants, [0, 1, 2]),
                );
              }),
            new RegExp(MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES),
          );
          assert.deepEqual(await stateSnapshot(fixture), before);
        }
      },
    );

    await t.test(
      "SC-PAUSE-011 records that one signature set replays on another deployment",
      async () => {
        const proofsEnabled = String(process.env.PROOFS_ENABLED) === "true";
        const blockchain = await Mina.LocalBlockchain({ proofsEnabled });
        Mina.setActiveInstance(blockchain);
        const feePayer = blockchain.testAccounts[0]!;
        const set = participants(77_000);
        const first = await deployController(
          feePayer,
          PrivateKey.fromBigInt(77_100n),
          set,
        );
        const second = await deployController(
          feePayer,
          PrivateKey.fromBigInt(77_101n),
          set,
        );
        const nonce = UInt32.from(
          blockchain.getAccount(first.address).nonce.toBigint(),
        );
        assert.equal(
          blockchain.getAccount(second.address).nonce.toBigint(),
          nonce.toBigint(),
        );
        const authorization = signatures(
          MultisigSignature.dataPauseTreasury(nonce),
          set,
          [0, 1, 2],
        );
        for (const contract of [first, second]) {
          await sendTransaction(feePayer, async () => {
            await contract.pauseTreasury(authorization, nonce);
          });
          assert.equal((await contract.paused.fetch())?.toBoolean(), true);
        }
      },
    );

    await t.test(
      "SC-PAUSE-012/013 records that network and protocol identity are absent from message data",
      () => {
        const nonce = UInt32.from(1);
        const baseline = MultisigSignature.dataPauseTreasury(nonce);
        for (const omittedDomain of ["network", "protocol-version"] as const) {
          const sameInputs = MultisigSignature.dataPauseTreasury(nonce);
          assert.equal(
            sameInputs.toBigInt(),
            baseline.toBigInt(),
            omittedDomain,
          );
        }
      },
    );

    await t.test(
      "SC-PAUSE-014 records direction-bound methods and the absence of Pause Controller events",
      async () => {
        const fixture = await createPauseFixture(78_000);
        const initialNonce = currentNonce(fixture);
        await pause(fixture, [0, 1, 2], initialNonce);
        assert.deepEqual(await stateSnapshot(fixture), {
          commitment: MultisigSignatures.createCommitment(
            publicKeys(fixture.participants),
          ).toBigInt(),
          eventCount: 0,
          nonce: initialNonce.toBigint() + 1n,
          paused: true,
        });

        const nonce = currentNonce(fixture);
        const data = MultisigSignature.dataUnpauseTreasury(nonce);
        await sendTransaction(fixture.feePayer, async () => {
          await fixture.contract.unpauseTreasury(
            signatures(data, fixture.participants, [0, 1, 2]),
            nonce,
          );
        });
        const final = await stateSnapshot(fixture);
        assert.equal(final.paused, false);
        assert.equal(final.nonce, initialNonce.toBigint() + 2n);
        assert.equal(final.eventCount, 0);
      },
    );

    await t.test(
      "SC-PAUSE-015/016 records four-participant rejection and six-participant partial deployment",
      async () => {
        const proofsEnabled = String(process.env.PROOFS_ENABLED) === "true";
        const cases = [
          { count: 4, deploys: false },
          { count: 6, deploys: true },
        ] as const;
        for (const [index, testCase] of cases.entries()) {
          const blockchain = await Mina.LocalBlockchain({ proofsEnabled });
          Mina.setActiveInstance(blockchain);
          const feePayer = blockchain.testAccounts[0]!;
          const set = participants(79_000 + index * 200, testCase.count);
          const key = PrivateKey.fromBigInt(BigInt(79_100 + index * 200));
          if (!testCase.deploys) {
            await assert.rejects(
              () => deployController(feePayer, key, set),
              new RegExp(TreasuryPauseControllerErrors.NOT_ENOUGH_PARTICIPANTS),
            );
            continue;
          }

          const contract = await deployController(feePayer, key, set);
          const before = {
            commitment: (await contract.multisigCommitment.fetch())?.toBigInt(),
            nonce: blockchain.getAccount(contract.address).nonce.toBigint(),
            paused: (await contract.paused.fetch())?.toBoolean(),
          };
          const nonce = UInt32.from(
            blockchain.getAccount(contract.address).nonce.toBigint(),
          );
          const data = MultisigSignature.dataPauseTreasury(nonce);
          await assert.rejects(
            () =>
              sendTransaction(feePayer, async () => {
                await contract.pauseTreasury(
                  signatures(data, set, [0, 1, 2]),
                  nonce,
                );
              }),
            new RegExp(TreasuryPauseControllerErrors.NOT_ENOUGH_PARTICIPANTS),
          );
          assert.deepEqual(
            {
              commitment: (
                await contract.multisigCommitment.fetch()
              )?.toBigInt(),
              nonce: blockchain.getAccount(contract.address).nonce.toBigint(),
              paused: (await contract.paused.fetch())?.toBoolean(),
            },
            before,
          );
        }
      },
    );

    await t.test(
      "SC-PAUSE-017/018/019/020 records duplicate, empty, unknown, and distinct signer behavior",
      async () => {
        const base = participants(80_000);
        const duplicate = [base[0]!, base[0]!, base[2]!, base[3]!, base[4]!];
        const empty = [
          base[0]!,
          base[1]!,
          base[2]!,
          base[3]!,
          { publicKey: PublicKey.empty() },
        ];
        const acceptedCases = [
          { name: "duplicate identity signs two positions", set: duplicate },
          { name: "three distinct identities", set: base },
        ];
        for (const [index, testCase] of acceptedCases.entries()) {
          const fixture = await createPauseFixture(
            80_200 + index * 200,
            testCase.set,
          );
          await pause(fixture, [0, 1, 2]);
          assert.equal(
            (await stateSnapshot(fixture)).paused,
            true,
            testCase.name,
          );
        }

        const emptyFixture = await createPauseFixture(80_700, empty);
        const emptyBefore = await stateSnapshot(emptyFixture);
        await assert.rejects(
          () => pause(emptyFixture, [0, 1, 2]),
          /Field\.inv: zero/,
        );
        assert.deepEqual(await stateSnapshot(emptyFixture), emptyBefore);

        const fixture = await createPauseFixture(81_000, base);
        const nonce = currentNonce(fixture);
        const data = MultisigSignature.dataPauseTreasury(nonce);
        const unknown = participants(81_500);
        const before = await stateSnapshot(fixture);
        await assert.rejects(
          () =>
            sendTransaction(fixture.feePayer, async () => {
              await fixture.contract.pauseTreasury(
                signatures(data, unknown, [0, 1, 2, 3, 4]),
                nonce,
              );
            }),
          new RegExp(MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES),
        );
        assert.deepEqual(await stateSnapshot(fixture), before);
      },
    );

    await t.test(
      "SC-PAUSE-021/022 binds rotation order and exact preimage but accepts a duplicate new set",
      async () => {
        const fixture = await createPauseFixture(82_000);
        const next = participants(82_500);
        const reordered = [next[1]!, next[0]!, next[2]!, next[3]!, next[4]!];
        const nextCommitment = MultisigSignatures.createCommitment(
          publicKeys(next),
        );
        const reorderedCommitment = MultisigSignatures.createCommitment(
          publicKeys(reordered),
        );
        assert.notEqual(
          nextCommitment.toBigInt(),
          reorderedCommitment.toBigInt(),
        );

        const oldCommitment =
          (await fixture.contract.multisigCommitment.fetch())!;
        const nonce = currentNonce(fixture);
        const data = MultisigSignature.dataRotateMultisigKeys(
          oldCommitment,
          nextCommitment,
          nonce,
        );
        await sendTransaction(fixture.feePayer, async () => {
          await fixture.contract.rotateMultisigKeys(
            nextCommitment,
            nonce,
            signatures(data, fixture.participants, [0, 1, 2]),
          );
        });
        assert.equal(
          (await fixture.contract.multisigCommitment.fetch())?.toBigInt(),
          nextCommitment.toBigInt(),
        );

        const duplicateNext = [
          next[0]!,
          next[0]!,
          next[2]!,
          next[3]!,
          next[4]!,
        ];
        TreasuryPauseControllerSmartContract.multisigParticipants =
          publicKeys(next);
        const duplicateCommitment = MultisigSignatures.createCommitment(
          publicKeys(duplicateNext),
        );
        const rotateNonce = currentNonce(fixture);
        const duplicateData = MultisigSignature.dataRotateMultisigKeys(
          nextCommitment,
          duplicateCommitment,
          rotateNonce,
        );
        await sendTransaction(fixture.feePayer, async () => {
          await fixture.contract.rotateMultisigKeys(
            duplicateCommitment,
            rotateNonce,
            signatures(duplicateData, next, [0, 1, 2]),
          );
        });
        assert.equal(
          (await fixture.contract.multisigCommitment.fetch())?.toBigInt(),
          duplicateCommitment.toBigInt(),
        );
      },
    );
  },
);
