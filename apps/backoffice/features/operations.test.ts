import { describe, expect, it } from "vitest";
import {
  assertOperationPackage,
  assertPureSigningOperation,
  countSignatures,
  createSigningOperation,
  inspectParticipantRotation,
  mergeOperationSignatures,
  parseParticipantConfig,
  validateParticipantRotation,
  type OperationPackage,
} from "./operations";

const currentParticipants = [
  "B62qoHG98jwMiTUbLTRa3swKX37aLHx1BH1jCUwQGjDvwEwFi7Fn3gF",
  "B62qoTUUNCsnPot29XdX2XdfaC4e53XYtBbR8UVAhJK2XDBgLM319Lo",
  "B62qjwzzRidkxK3zjTvnGN1YcfqxH1XE3ChhQWiMLcpWCsnfoSHeMoe",
  "B62qmxH7JivC96aiWEiKh61JzCJ7xFi2ejMke1raAfP1NkW35rYGRHh",
  "B62qowrYiozjPB2gY6Hz6bgHCNZwhgyrPTfa5Y48oWcErq9qLU6w2ae",
];

const nextParticipants = [
  "B62qmGpTuGnsV4fRsfRkWH5sNtoCL8ePscVncyr8mWPHBFsXgTuEAXb",
  "B62qoQuQpnAcPkyzhPNhxmAsYJ3BnsCsxBm8mUQ4WHVeVzrQxH9eLLQ",
  "B62qn2UXbMr9AumgBnamnxnR1itBUGP3xUeMLavDqTvsxapqKXgTRYk",
  "B62qnwuwmwHGqM7R72759ojs6XAc4LYw6Jr844nzUYUeJLchRuK5RTs",
  "B62qqSa9oeMjR5pzsULXddHtLpChV772MU5GKS5rTsdnRJEWm5MT3zm",
];

const emptyPublicKey =
  "B62qiTKpEPjGTSHZrtM8uXiKgn8So916pLmNJKDhKeyBQL9TDb3nvBG";

function operation(): OperationPackage {
  return {
    schemaVersion: 2,
    kind: "pauseTreasury",
    networkId: "devnet",
    treasuryOwnerAddress: "owner",
    pauseControllerAddress: "controller",
    controllerNonce: "4",
    multisigCommitment: "10",
    participants: ["one", "two", "three", "four", "five"],
    messageHash: "11",
    signatures: ["a", null, "c", null, "e"],
    createdAt: "2026-08-20T00:00:00.000Z",
  };
}

describe("operation packages", () => {
  it("parses the configured ordered participant list", () => {
    expect(parseParticipantConfig(" one, two ,three,four,five ")).toEqual([
      "one",
      "two",
      "three",
      "four",
      "five",
    ]);
  });

  it("counts collected signatures", () => {
    expect(countSignatures(operation())).toBe(3);
  });

  it("creates a pure signing operation", () => {
    const source = operation();
    const signingOperation = createSigningOperation(source);

    expect(signingOperation.signatures).toEqual([null, null, null, null, null]);
    expect(source.signatures).toEqual(["a", null, "c", null, "e"]);
    expect(assertPureSigningOperation(signingOperation)).toBe(signingOperation);
  });

  it("rejects a signer operation that contains signatures", () => {
    expect(() => assertPureSigningOperation(operation())).toThrow(
      /must not contain participant signatures/,
    );
  });

  it("accepts the current schema", () => {
    expect(assertOperationPackage(operation())).toEqual(operation());
  });

  it("rejects schema 1 and requires new signatures", () => {
    expect(() =>
      assertOperationPackage({ ...operation(), schemaVersion: 1 }),
    ).toThrow(/collect new signatures/);
  });

  it("rejects packages with fewer than five slots", () => {
    const value = operation();
    value.signatures = ["a"];
    expect(() => assertOperationPackage(value)).toThrow(/incomplete/);
  });

  it.each([
    { networkId: { name: "testnet" } },
    { treasuryOwnerAddress: 1 },
    { participants: [null, "two", "three", "four", "five"] },
    { signatures: [false, null, null, null, null] },
    { kind: "toggleProposal", proposalAddress: { address: "proposal" } },
    {
      kind: "rotateMultisig",
      nextParticipants: [1, 2, 3, 4, 5],
      nextMultisigCommitment: "12",
    },
    { kind: "unknown" },
  ])("rejects malformed review fields: %j", (changes) => {
    expect(() =>
      assertOperationPackage({ ...operation(), ...changes }),
    ).toThrow();
  });

  it("merges signatures from independent participant packages", () => {
    const current = operation();
    current.signatures = ["a", null, null, null, null];
    const incoming = operation();
    incoming.signatures = [null, "b", null, null, null];

    expect(mergeOperationSignatures(current, incoming).signatures).toEqual([
      "a",
      "b",
      null,
      null,
      null,
    ]);
  });

  it("rejects signatures for a different operation", () => {
    const incoming = operation();
    incoming.controllerNonce = "5";

    expect(() => mergeOperationSignatures(operation(), incoming)).toThrow(
      /different operation data in controllerNonce/,
    );
  });

  it("rejects conflicting signatures in one participant slot", () => {
    const current = operation();
    current.signatures = ["first", null, null, null, null];
    const incoming = operation();
    incoming.signatures = ["second", null, null, null, null];

    expect(() => mergeOperationSignatures(current, incoming)).toThrow(
      /conflicts with participant 1/,
    );
  });

  it("accepts five new, distinct, non-empty participant keys", async () => {
    const review = await validateParticipantRotation(
      currentParticipants,
      nextParticipants,
    );

    expect(review.canBuild).toBe(true);
    expect(review.newCount).toBe(5);
    expect(review.retainedCount).toBe(0);
  });

  it("reports existing, duplicate, invalid, and empty keys", async () => {
    const review = await inspectParticipantRotation(currentParticipants, [
      currentParticipants[0]!,
      nextParticipants[0]!,
      nextParticipants[0]!,
      "not-a-public-key",
      emptyPublicKey,
    ]);

    expect(review.retainedCount).toBe(1);
    expect(review.duplicateCount).toBe(2);
    expect(review.invalidCount).toBe(1);
    expect(review.emptyCount).toBe(1);
    expect(review.canBuild).toBe(false);
  });

  it("rejects PublicKey.empty and the unchanged participant set", async () => {
    await expect(
      validateParticipantRotation(currentParticipants, [
        emptyPublicKey,
        ...nextParticipants.slice(1),
      ]),
    ).rejects.toThrow(/PublicKey\.empty/);
    await expect(
      validateParticipantRotation(currentParticipants, currentParticipants),
    ).rejects.toThrow(/current ordered key set/);
  });
});
