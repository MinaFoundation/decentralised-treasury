import {
  Bool,
  Field,
  Mina,
  PublicKey,
  Struct,
  TokenSymbol,
  UInt64,
  VerificationKey,
  TokenId,
  UInt32,
  ReceiptChainHashBase58,
  StateHashBase58,
  Poseidon,
} from "o1js";

export const accountHashPrefix = "MinaAccount*********";

export class Timing extends Struct({
  isTimed: Bool,
  initialMinimumBalance: UInt64,
  cliffTime: UInt32,
  cliffAmount: UInt64,
  vestingPeriod: UInt32,
  vestingIncrement: UInt64,
}) {
  public static empty() {
    return new Timing({
      isTimed: Bool(false),
      initialMinimumBalance: UInt64.from(0),
      cliffTime: UInt32.from(0),
      cliffAmount: UInt64.from(0),
      vestingPeriod: UInt32.from(1),
      vestingIncrement: UInt64.from(0),
    });
  }
  public static toHashInput(timing: Timing) {
    return (
      [
        packed(timing.isTimed.toField(), 1),
        packed(timing.initialMinimumBalance.toFields()[0], 64),
        packed(timing.cliffTime.toFields()[0], 32),
        packed(timing.cliffAmount.toFields()[0], 64),
        packed(timing.vestingPeriod.toFields()[0], 32),
        packed(timing.vestingIncrement.toFields()[0], 64),
      ]
        // .reverse()
        .reduce(append, { fieldElements: [], packeds: [] })
    );
  }
}

export class Permission extends Struct({
  constant: Bool,
  signatureNecessary: Bool,
  signatureSufficient: Bool,
}) {
  public static toHashInput(permission: Permission) {
    return (
      [
        packed(permission.constant.toField(), 1),
        packed(permission.signatureNecessary.toField(), 1),
        packed(permission.signatureSufficient.toField(), 1),
      ]
        // .reverse()
        .reduce(append, { fieldElements: [], packeds: [] })
    );
  }

  public static fromString(string: string) {
    switch (string) {
      case "impossible":
        return Permission.impossible();
      case "none":
        return Permission.none();
      case "proof":
        return Permission.proof();
      case "signature":
        return Permission.signature();
      case "either":
        return Permission.either();
      default:
        throw new Error(`Invalid permission string: ${string}`);
    }
  }
  public static impossible() {
    return new Permission({
      constant: Bool(true),
      signatureNecessary: Bool(true),
      signatureSufficient: Bool(false),
    });
  }

  public static none() {
    return new Permission({
      constant: Bool(true),
      signatureNecessary: Bool(false),
      signatureSufficient: Bool(true),
    });
  }

  public static proof() {
    return new Permission({
      constant: Bool(false),
      signatureNecessary: Bool(false),
      signatureSufficient: Bool(false),
    });
  }

  public static signature() {
    return new Permission({
      constant: Bool(false),
      signatureNecessary: Bool(true),
      signatureSufficient: Bool(true),
    });
  }

  public static either() {
    return new Permission({
      constant: Bool(false),
      signatureNecessary: Bool(false),
      signatureSufficient: Bool(true),
    });
  }
}

export class Permissions extends Struct({
  editState: Permission,
  send: Permission,
  receive: Permission,
  access: Permission,
  setDelegate: Permission,
  setPermissions: Permission,
  setVerificationKey: [Permission, UInt32],
  setZkappUri: Permission,
  editActionState: Permission,
  setTokenSymbol: Permission,
  incrementNonce: Permission,
  setVotingFor: Permission,
  setTiming: Permission,
}) {
  public static toHashInput(permissions: Permissions) {
    return (
      [
        Permission.toHashInput(permissions.editState),
        Permission.toHashInput(permissions.access),
        Permission.toHashInput(permissions.send),
        Permission.toHashInput(permissions.receive),
        Permission.toHashInput(permissions.setDelegate),
        Permission.toHashInput(permissions.setPermissions),
        Permission.toHashInput(permissions.setVerificationKey[0] as Permission),
        packed((permissions.setVerificationKey[1] as UInt32).toFields()[0], 32),
        Permission.toHashInput(permissions.setZkappUri),
        Permission.toHashInput(permissions.editActionState),
        Permission.toHashInput(permissions.setTokenSymbol),
        Permission.toHashInput(permissions.incrementNonce),
        Permission.toHashInput(permissions.setVotingFor),
        Permission.toHashInput(permissions.setTiming),
      ]
        // .reverse()
        .reduce(append, { fieldElements: [], packeds: [] })
    );
  }
}

// TODO: implement zkapp support
// export class Zkapp extends Struct({
//   appState: Field,
//   verificationKey: VerificationKey,
//   zkappVersion: Field,
//   actionState: Field,
//   lastActionSlot: Field,
//   provedState: Bool,
//   zkappUri: Field,
// }) {}

export class Zkapp extends Field {
  public static empty() {
    return new Zkapp(
      "17496579307054293919236546471315760436947051349021271414215926440979771046144"
    );
  }
}

export class Account extends Struct({
  pk: PublicKey,
  tokenId: TokenId,
  tokenSymbol: TokenSymbol,
  balance: UInt64,
  nonce: UInt32,
  receiptChainHash: Field,
  delegate: PublicKey,
  votingFor: Field,
  timing: Timing,
  permissions: Permissions,
  zkapp: Zkapp,
}) {
  public static empty() {
    return new Account({
      pk: PublicKey.empty(),
      tokenId: TokenId.fromBase58(
        "wSHV2S4qX9jFsLjQo8r1BsMLH2ZRKsZx6EJd1sbozGPieEC4Jf"
      ),
      tokenSymbol: TokenSymbol.empty(),
      balance: UInt64.from(0),
      nonce: UInt32.from(0),
      receiptChainHash: ReceiptChainHashBase58.fromBase58(
        "2mzbV7WevxLuchs2dAMY4vQBS6XttnCUF8Hvks4XNBQ5qiSGGBQe"
      ),
      delegate: PublicKey.empty(),
      votingFor: StateHashBase58.fromBase58(
        "3NK2tkzqqK5spR2sZ7tujjqPksL45M3UUrcA4WhCkeiPtnugyE2x"
      ),
      timing: Timing.empty(),
      permissions: new Permissions({
        editState: Permission.signature(),
        access: Permission.none(),
        send: Permission.signature(),
        receive: Permission.none(),
        setDelegate: Permission.signature(),
        setPermissions: Permission.signature(),
        setVerificationKey: [Permission.signature(), UInt32.from(3)],
        setZkappUri: Permission.signature(),
        editActionState: Permission.signature(),
        setTokenSymbol: Permission.signature(),
        incrementNonce: Permission.signature(),
        setVotingFor: Permission.signature(),
        setTiming: Permission.signature(),
      }),
      zkapp: Zkapp.empty(),
    });
  }

  public static isEmpty(account: Account) {
    return Poseidon.hash(Account.toFields(account)).equals(
      Poseidon.hash(Account.toFields(Account.empty()))
    );
  }

  public static toHashInput(account: Account) {
    return [
      append(field(account.pk.x), packed(account.pk.isOdd.toField(), 1)),
      field(account.tokenId.toFields()[0]),
      packed(account.tokenSymbol.field, 48),
      packed(account.balance.toFields()[0], 64),
      packed(account.nonce.toFields()[0], 32),
      field(account.receiptChainHash.toFields()[0]),
      append(
        field(account.delegate.x),
        packed(account.delegate.isOdd.toField(), 1)
      ),
      field(account.votingFor.toFields()[0]),
      Timing.toHashInput(account.timing),
      Permissions.toHashInput(account.permissions),
      field(account.zkapp.toFields()[0]),
    ]
      .reverse()
      .reduce(append, { fieldElements: [], packeds: [] });
  }
}

/**
 * The input for a random oracle, formed of full field elements and "chunks"
 * of fields that can be combined into one or more field elements.
 *
 * The chunks are represented as [value, length], where
 * 0 <= value < 2^length. This allows efficient packing of values in a known
 * range. Packing logic (when needed) is handled by a separate helper.
 */
export type RandomOracleInput<Field> = {
  fieldElements: Field[];
  packeds: Array<[Field, number]>; // [value, length]
};

export function append<Field>(
  t1: RandomOracleInput<Field>,
  t2: RandomOracleInput<Field>
): RandomOracleInput<Field> {
  return {
    fieldElements: t1.fieldElements.concat(t2.fieldElements),
    packeds: t1.packeds.concat(t2.packeds),
  };
}

export function fieldElements<Field>(a: Field[]): RandomOracleInput<Field> {
  return { fieldElements: a, packeds: [] };
}

export function field<Field>(x: Field): RandomOracleInput<Field> {
  return fieldElements([x]);
}

export function packeds<Field>(
  a: Array<[Field, number]>
): RandomOracleInput<Field> {
  return { fieldElements: [], packeds: a };
}

/** packed x = packeds [ x ] */
export function packed<Field>(
  x: Field,
  width: number
): RandomOracleInput<Field> {
  return packeds([[x, width]]);
}

const pow2 = (n: number) => {
  let acc = Field.from(2);
  for (let i = 1; i < n; i++) {
    acc = acc.mul(Field.from(2));
  }
  return acc;
};

// Assumes RandomOracleInput<T> = { fieldElements: T[]; packeds: Array<[T, number]> }
export function packToFields(input: {
  fieldElements: Field[];
  packeds: Array<[Field, number]>;
}): Field[] {
  const { fieldElements, packeds } = input;

  const shiftLeft = (acc: Field, n: number) => acc.mul(pow2(n));

  const packedBits: Field[] = [];
  let acc = Field.from(0);
  let accBits = 0;

  for (const [x, n] of packeds) {
    const nextBits = n + accBits;
    if (nextBits < Field.sizeInBits) {
      acc = x.add(shiftLeft(acc, n));
      accBits = nextBits;
    } else {
      if (accBits > 0) packedBits.push(acc);
      acc = x;
      accBits = n;
    }
  }

  if (accBits > 0) packedBits.push(acc);

  return fieldElements.concat(packedBits);
}
