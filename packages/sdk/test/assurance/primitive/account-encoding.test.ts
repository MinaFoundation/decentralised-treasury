import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Bool, Provable, UInt32, UInt64 } from "o1js";
import {
  Permission,
  Permissions,
  Timing,
  type RandomOracleInput,
} from "../../../src/provable/account.js";
import { deterministicUInt32 } from "../fixtures/deterministic.js";

type PackedValue = readonly [value: bigint, width: number];

function hasMessage(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof Error && error.message === expected;
}

function packedValues(
  input: RandomOracleInput<ReturnType<typeof Bool.prototype.toField>>,
): PackedValue[] {
  return input.packeds.map(([value, width]) => [value.toBigInt(), width]);
}

function permissionFromBits(bits: number): Permission {
  return new Permission({
    constant: Bool((bits & 4) !== 0),
    signatureNecessary: Bool((bits & 2) !== 0),
    signatureSufficient: Bool((bits & 1) !== 0),
  });
}

const permissionCases = [
  {
    name: "impossible",
    value: Permission.impossible(),
    expected: [1n, 1n, 0n],
  },
  { name: "none", value: Permission.none(), expected: [1n, 0n, 1n] },
  { name: "proof", value: Permission.proof(), expected: [0n, 0n, 0n] },
  { name: "signature", value: Permission.signature(), expected: [0n, 1n, 1n] },
  { name: "either", value: Permission.either(), expected: [0n, 0n, 1n] },
] as const;

describe("proof-off primitive account encodings", () => {
  it("PRIM-ACCOUNT-006 packs timed and untimed accounts", async () => {
    const cliffTime = deterministicUInt32("primitive-account", "cliff-time");
    const vestingPeriod =
      deterministicUInt32("primitive-account", "vesting-period") || 1;
    const timed = new Timing({
      isTimed: Bool(true),
      initialMinimumBalance: UInt64.from(8_000_000_001n),
      cliffTime: UInt32.from(cliffTime),
      cliffAmount: UInt64.from(2_000_000_003n),
      vestingPeriod: UInt32.from(vestingPeriod),
      vestingIncrement: UInt64.from(500_000_007n),
    });
    const cases = [
      {
        name: "untimed",
        value: Timing.empty(),
        expected: [
          [0n, 1],
          [0n, 64],
          [0n, 32],
          [0n, 64],
          [1n, 32],
          [0n, 64],
        ] satisfies PackedValue[],
      },
      {
        name: "timed",
        value: timed,
        expected: [
          [1n, 1],
          [8_000_000_001n, 64],
          [BigInt(cliffTime), 32],
          [2_000_000_003n, 64],
          [BigInt(vestingPeriod), 32],
          [500_000_007n, 64],
        ] satisfies PackedValue[],
      },
    ] as const;

    for (const testCase of cases) {
      assert.deepEqual(
        packedValues(Timing.toHashInput(testCase.value)),
        testCase.expected,
        testCase.name,
      );
    }

    await Provable.runAndCheck(() => {
      for (const testCase of cases) {
        const actual = Timing.toHashInput(testCase.value).packeds;
        for (let index = 0; index < actual.length; index += 1) {
          actual[index]![0].assertEquals(testCase.expected[index]![0]);
        }
      }
    });
  });

  it("PRIM-ACCOUNT-007 encodes every named permission", async () => {
    for (const testCase of permissionCases) {
      assert.deepEqual(
        packedValues(Permission.toHashInput(testCase.value)),
        testCase.expected.map((value) => [value, 1]),
        testCase.name,
      );
      assert.deepEqual(
        packedValues(
          Permission.toHashInput(Permission.fromString(testCase.name)),
        ),
        testCase.expected.map((value) => [value, 1]),
        `${testCase.name} parser`,
      );
    }

    await Provable.runAndCheck(() => {
      for (const testCase of permissionCases) {
        const actual = Permission.toHashInput(testCase.value).packeds;
        for (let index = 0; index < actual.length; index += 1) {
          actual[index]![0].assertEquals(testCase.expected[index]!);
        }
      }
    });
  });

  it("PRIM-ACCOUNT-008 preserves permission field order and version width", async () => {
    const version = deterministicUInt32(
      "primitive-account",
      "verification-key-version",
    );
    const permissionBits = [0, 1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5] as const;
    const permissions = new Permissions({
      editState: permissionFromBits(permissionBits[0]),
      access: permissionFromBits(permissionBits[1]),
      send: permissionFromBits(permissionBits[2]),
      receive: permissionFromBits(permissionBits[3]),
      setDelegate: permissionFromBits(permissionBits[4]),
      setPermissions: permissionFromBits(permissionBits[5]),
      setVerificationKey: [
        permissionFromBits(permissionBits[6]),
        UInt32.from(version),
      ],
      setZkappUri: permissionFromBits(permissionBits[7]),
      editActionState: permissionFromBits(permissionBits[8]),
      setTokenSymbol: permissionFromBits(permissionBits[9]),
      incrementNonce: permissionFromBits(permissionBits[10]),
      setVotingFor: permissionFromBits(permissionBits[11]),
      setTiming: permissionFromBits(permissionBits[12]),
    });
    const expected = permissionBits.flatMap((bits, index) => {
      const encoded: PackedValue[] = [
        [BigInt((bits >> 2) & 1), 1],
        [BigInt((bits >> 1) & 1), 1],
        [BigInt(bits & 1), 1],
      ];
      return index === 6
        ? [...encoded, [BigInt(version), 32] as const]
        : encoded;
    });

    assert.deepEqual(
      packedValues(Permissions.toHashInput(permissions)),
      expected,
    );

    await Provable.runAndCheck(() => {
      const actual = Permissions.toHashInput(permissions).packeds;
      for (let index = 0; index < actual.length; index += 1) {
        actual[index]![0].assertEquals(expected[index]![0]);
      }
    });
  });

  it("PRIM-ACCOUNT-014 rejects unknown permission text", () => {
    const invalidNames = [
      "",
      "Proof",
      "proof-or-signature",
      "unknown",
    ] as const;

    for (const name of invalidNames) {
      assert.throws(
        () => Permission.fromString(name),
        hasMessage(`Invalid permission string: ${name}`),
      );
    }
  });
});
