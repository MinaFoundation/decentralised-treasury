import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Bool,
  Field,
  Poseidon,
  TokenId,
  TokenSymbol,
  UInt32,
  UInt64,
} from "o1js";
import {
  Account,
  packToFields,
  Permission,
  Timing,
  Zkapp,
  zkappAccountHashPrefix,
} from "../../../src/provable/account.js";
import { accountHashPrefix } from "../../../src/ledgers/staking-ledger/staking-ledger.js";
import { DeterministicByteGenerator } from "../fixtures/deterministic.js";
import { deterministicAccount } from "../fixtures/ledgers/strict-ledgers.js";

type PackedBigint = readonly [value: bigint, width: number];
type ModelInput = {
  readonly fields: readonly bigint[];
  readonly packed: readonly PackedBigint[];
};

const EMPTY_ZKAPP_HASH =
  "14236052639648199902645613896213351175778418919021873691617321938265513486187";
const EMPTY_ACCOUNT_HASH =
  "28328037583256331742860088544984623105766605252477591487013162091232255973154";

function appendModel(...inputs: readonly ModelInput[]): ModelInput {
  return {
    fields: inputs.flatMap((input) => input.fields),
    packed: inputs.flatMap((input) => input.packed),
  };
}

function fieldModel(value: Field): ModelInput {
  return { fields: [value.toBigInt()], packed: [] };
}

function packedModel(value: bigint, width: number): ModelInput {
  return { fields: [], packed: [[value, width]] };
}

function packModel(input: ModelInput): Field[] {
  const packedFields: bigint[] = [];
  let accumulator = 0n;
  let accumulatorBits = 0;

  for (const [value, width] of input.packed) {
    const nextBits = width + accumulatorBits;
    if (nextBits < Field.sizeInBits) {
      accumulator = value + (accumulator << BigInt(width));
      accumulatorBits = nextBits;
    } else {
      if (accumulatorBits > 0) packedFields.push(accumulator);
      accumulator = value;
      accumulatorBits = width;
    }
  }
  if (accumulatorBits > 0) packedFields.push(accumulator);

  return [...input.fields, ...packedFields].map(Field);
}

function permissionModel(permission: Permission): ModelInput {
  return appendModel(
    packedModel(permission.constant.toBoolean() ? 1n : 0n, 1),
    packedModel(permission.signatureNecessary.toBoolean() ? 1n : 0n, 1),
    packedModel(permission.signatureSufficient.toBoolean() ? 1n : 0n, 1),
  );
}

function timingModel(timing: Timing): ModelInput {
  return appendModel(
    packedModel(timing.isTimed.toBoolean() ? 1n : 0n, 1),
    packedModel(timing.initialMinimumBalance.toBigInt(), 64),
    packedModel(timing.cliffTime.toBigint(), 32),
    packedModel(timing.cliffAmount.toBigInt(), 64),
    packedModel(timing.vestingPeriod.toBigint(), 32),
    packedModel(timing.vestingIncrement.toBigInt(), 64),
  );
}

function permissionsModel(account: Account): ModelInput {
  const permissions = account.permissions;
  return appendModel(
    permissionModel(permissions.editState),
    permissionModel(permissions.access),
    permissionModel(permissions.send),
    permissionModel(permissions.receive),
    permissionModel(permissions.setDelegate),
    permissionModel(permissions.setPermissions),
    permissionModel(permissions.setVerificationKey[0] as Permission),
    packedModel((permissions.setVerificationKey[1] as UInt32).toBigint(), 32),
    permissionModel(permissions.setZkappUri),
    permissionModel(permissions.editActionState),
    permissionModel(permissions.setTokenSymbol),
    permissionModel(permissions.incrementNonce),
    permissionModel(permissions.setVotingFor),
    permissionModel(permissions.setTiming),
  );
}

function zkappModel(zkapp: Zkapp): Field {
  const input = appendModel(
    fieldModel(zkapp.zkappUri),
    packedModel(zkapp.provedState.toBoolean() ? 1n : 0n, 1),
    packedModel(zkapp.lastActionSlot.toBigInt(), 32),
    ...zkapp.actionState.map(fieldModel),
    packedModel(zkapp.zkappVersion.toBigInt(), 32),
    fieldModel(zkapp.verificationKey.hash),
    ...zkapp.appState.map(fieldModel),
  );
  return Poseidon.hashWithPrefix(zkappAccountHashPrefix, packModel(input));
}

function accountModel(account: Account): ModelInput {
  return appendModel(
    fieldModel(zkappModel(account.zkapp)),
    permissionsModel(account),
    timingModel(account.timing),
    fieldModel(account.votingFor),
    fieldModel(account.delegate.x),
    packedModel(account.delegate.isOdd.toBoolean() ? 1n : 0n, 1),
    fieldModel(account.receiptChainHash),
    packedModel(account.nonce.toBigint(), 32),
    packedModel(account.balance.toBigInt(), 64),
    packedModel(account.tokenSymbol.field.toBigInt(), 48),
    fieldModel(account.tokenId.toFields()[0]!),
    fieldModel(account.pk.x),
    packedModel(account.pk.isOdd.toBoolean() ? 1n : 0n, 1),
  );
}

function accountCommitment(account: Account): Field {
  return Poseidon.hashWithPrefix(
    accountHashPrefix,
    packToFields(Account.toHashInput(account)),
  );
}

function expectedAccountCommitment(account: Account): Field {
  return Poseidon.hashWithPrefix(
    accountHashPrefix,
    packModel(accountModel(account)),
  );
}

function cloneAccount(account: Account): Account {
  return Account.fromFields(
    Account.toFields(account),
    Account.toAuxiliary(account),
  );
}

function deterministicFields(label: string, count: number): Field[] {
  const generator = new DeterministicByteGenerator("primitive-account", label);
  return Array.from({ length: count }, () => {
    const bytes = generator.nextBytes(8);
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    return Field(value);
  });
}

function populatedZkapp(): Zkapp {
  const empty = Zkapp.empty();
  return new Zkapp({
    appState: deterministicFields("zkapp-state", 32),
    verificationKey: empty.verificationKey,
    zkappVersion: Field(19),
    actionState: deterministicFields("zkapp-actions", 5),
    lastActionSlot: Field(4_294_967_294n),
    provedState: Bool(true),
    zkappUri: deterministicFields("zkapp-uri", 1)[0]!,
  });
}

function assertModelMatches(account: Account, label: string): void {
  const actualInput = Account.toHashInput(account);
  const expectedInput = accountModel(account);
  assert.deepEqual(
    actualInput.fieldElements.map((value) => value.toBigInt()),
    expectedInput.fields,
    `${label} fields`,
  );
  assert.deepEqual(
    actualInput.packeds.map(([value, width]) => [value.toBigInt(), width]),
    expectedInput.packed,
    `${label} packed values`,
  );
  assert.deepEqual(
    packToFields(actualInput).map((value) => value.toBigInt()),
    packModel(expectedInput).map((value) => value.toBigInt()),
    `${label} packed fields`,
  );
  assert.equal(
    accountCommitment(account).toString(),
    expectedAccountCommitment(account).toString(),
    `${label} commitment`,
  );
}

describe("proof-off primitive account packing and hashing", () => {
  it("PRIM-ACCOUNT-001 checks the canonical empty account", () => {
    const account = Account.empty();
    assert.equal(Account.isEmpty(account).toBoolean(), true);
    assertModelMatches(account, "empty");
    assert.equal(zkappModel(account.zkapp).toString(), EMPTY_ZKAPP_HASH);
    assert.equal(accountCommitment(account).toString(), EMPTY_ACCOUNT_HASH);
  });

  it("PRIM-ACCOUNT-002 checks account field order and packing", () => {
    const account = deterministicAccount(0, 7_000_000_011n, 1);
    account.nonce = UInt32.from(29);
    account.tokenSymbol = TokenSymbol.from("ORDER1");
    account.timing = new Timing({
      isTimed: Bool(true),
      initialMinimumBalance: UInt64.from(6_000_000_013n),
      cliffTime: UInt32.from(31),
      cliffAmount: UInt64.from(2_000_000_017n),
      vestingPeriod: UInt32.from(37),
      vestingIncrement: UInt64.from(1_000_000_019n),
    });
    account.zkapp = populatedZkapp();

    assertModelMatches(account, "ordered populated account");
  });

  it("PRIM-ACCOUNT-003 checks numeric boundaries", () => {
    const uint64Max = (1n << 64n) - 1n;
    const uint32Max = (1n << 32n) - 1n;
    const cases = [
      { name: "zero", balance: 0n, nonce: 0n },
      { name: "one", balance: 1n, nonce: 1n },
      {
        name: "maximum minus one",
        balance: uint64Max - 1n,
        nonce: uint32Max - 1n,
      },
      { name: "maximum", balance: uint64Max, nonce: uint32Max },
    ] as const;

    for (const testCase of cases) {
      const account = deterministicAccount(0, testCase.balance);
      account.nonce = UInt32.from(testCase.nonce);
      assertModelMatches(account, testCase.name);
    }
  });

  it("PRIM-ACCOUNT-004 separates default and custom tokens", () => {
    const cases = [
      { name: "default", tokenId: TokenId.default, expected: 1n },
      { name: "custom", tokenId: TokenId.fromValue(2n), expected: 2n },
    ] as const;
    const commitments = new Set<string>();

    for (const testCase of cases) {
      const account = deterministicAccount(0, 100n);
      account.tokenId = testCase.tokenId;
      assert.equal(
        account.tokenId.toFields()[0]!.toBigInt(),
        testCase.expected,
      );
      assertModelMatches(account, testCase.name);
      commitments.add(accountCommitment(account).toString());
    }
    assert.equal(commitments.size, cases.length);
  });

  it("PRIM-ACCOUNT-005 checks token-symbol width and byte order", () => {
    const cases = [
      { symbol: "", expected: 0n },
      { symbol: "A", expected: 65n },
      { symbol: "MINA12", expected: 0x3231414e494dn },
    ] as const;

    for (const testCase of cases) {
      const account = deterministicAccount(0, 100n);
      account.tokenSymbol = TokenSymbol.from(testCase.symbol);
      const actual = Account.toHashInput(account).packeds.find(
        ([value, width]) =>
          width === 48 && value.equals(account.tokenSymbol.field).toBoolean(),
      );
      assert.equal(
        account.tokenSymbol.field.toBigInt(),
        testCase.expected,
        testCase.symbol,
      );
      assert.deepEqual(
        actual && [actual[0].toBigInt(), actual[1]],
        [testCase.expected, 48],
        testCase.symbol,
      );
      assertModelMatches(account, `symbol ${testCase.symbol}`);
    }
  });

  it("PRIM-ACCOUNT-009 checks empty zkApp constants and hash", () => {
    const zkapp = Zkapp.empty();
    assert.equal(
      Zkapp.toHashInput(zkapp).toString(),
      zkappModel(zkapp).toString(),
    );
    assert.equal(Zkapp.toHashInput(zkapp).toString(), EMPTY_ZKAPP_HASH);
    assert.equal(
      zkapp.appState.every((value) => value.toBigInt() === 0n),
      true,
    );
    assert.equal(zkapp.actionState.length, 5);
  });

  it("PRIM-ACCOUNT-010 checks populated zkApp order and hash", () => {
    const zkapp = populatedZkapp();
    const expected = zkappModel(zkapp);
    assert.equal(Zkapp.toHashInput(zkapp).toString(), expected.toString());

    const reordered = new Zkapp({
      ...zkapp,
      appState: [...zkapp.appState].reverse(),
    });
    assert.notEqual(zkappModel(reordered).toString(), expected.toString());
    assert.notEqual(
      Zkapp.toHashInput(reordered).toString(),
      expected.toString(),
    );
  });

  it("PRIM-ACCOUNT-011 round trips JSON and preserves an empty delegate", () => {
    const cases = [
      { name: "normal delegate", account: deterministicAccount(0, 91n, 1) },
      { name: "empty delegate", account: deterministicAccount(1, 92n) },
    ] as const;
    cases[1].account.delegate = Account.empty().delegate;

    for (const testCase of cases) {
      const json = Account.toJSON(testCase.account);
      const decoded = Account.fromJSON(structuredClone(json));
      assert.deepEqual(
        Account.toFields(decoded).map((value) => value.toBigInt()),
        Account.toFields(testCase.account).map((value) => value.toBigInt()),
        testCase.name,
      );
    }
  });

  it("PRIM-ACCOUNT-012 characterizes malformed and unknown JSON", () => {
    const account = deterministicAccount(0, 93n, 1);
    const valid = Account.toJSON(account) as Record<string, unknown>;
    const malformedCases = [
      {
        name: "public key",
        mutate: (json: Record<string, unknown>) => (json.pk = "invalid"),
      },
      {
        name: "balance overflow",
        mutate: (json: Record<string, unknown>) =>
          (json.balance = (1n << 64n).toString()),
      },
      {
        name: "token",
        mutate: (json: Record<string, unknown>) => (json.tokenId = "invalid"),
      },
    ] as const;

    for (const testCase of malformedCases) {
      const json = structuredClone(valid);
      testCase.mutate(json);
      const decoded = Account.fromJSON(json);
      assert.equal(Account.isEmpty(decoded).toBoolean(), true, testCase.name);
    }

    const withUnknown = structuredClone(valid);
    withUnknown.unknownAssuranceField = "ignored";
    const decoded = Account.fromJSON(withUnknown);
    assert.equal(Account.isEmpty(decoded).toBoolean(), false);
    assert.equal(decoded.balance.toBigInt(), account.balance.toBigInt());
  });

  it("PRIM-ACCOUNT-013 changes commitments for semantic field mutations", () => {
    const base = deterministicAccount(0, 101n, 1);
    base.tokenSymbol = TokenSymbol.from("BASE");
    const otherIdentity = deterministicAccount(0, 1n).pk;
    const mutations = [
      {
        name: "balance",
        apply: (value: Account) => (value.balance = UInt64.from(102n)),
      },
      {
        name: "nonce",
        apply: (value: Account) => (value.nonce = UInt32.from(1)),
      },
      {
        name: "token",
        apply: (value: Account) => (value.tokenId = TokenId.fromValue(2n)),
      },
      {
        name: "symbol",
        apply: (value: Account) =>
          (value.tokenSymbol = TokenSymbol.from("MUTATE")),
      },
      {
        name: "delegate",
        apply: (value: Account) => (value.delegate = otherIdentity),
      },
      {
        name: "timing",
        apply: (value: Account) =>
          (value.timing = new Timing({
            ...Timing.empty(),
            cliffTime: UInt32.from(1),
          })),
      },
      {
        name: "permission",
        apply: (value: Account) => (value.permissions.send = Permission.none()),
      },
      {
        name: "zkApp",
        apply: (value: Account) => (value.zkapp = populatedZkapp()),
      },
    ] as const;
    const baseline = accountCommitment(base).toString();
    const commitments = new Set<string>();

    for (const mutation of mutations) {
      const account = cloneAccount(base);
      mutation.apply(account);
      assertModelMatches(account, mutation.name);
      const commitment = accountCommitment(account).toString();
      assert.notEqual(commitment, baseline, mutation.name);
      commitments.add(commitment);
    }
    assert.equal(commitments.size, mutations.length);
  });
});
