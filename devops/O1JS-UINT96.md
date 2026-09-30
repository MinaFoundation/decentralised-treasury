# Audit #09: UInt96 migration

The Treasury uses `UInt96` for acceptance and approval arithmetic.
The o1js fork marks `UInt128` as deprecated but keeps its checked implementation for compatibility.
The published fork revision is `d670b3efd4fc7f0bf431a0b2211c28b1dc257944`.
All workspace pins use this revision.

## Integer bounds

Each `UInt96` input is range-checked before circuit use.
A product of two inputs is smaller than `2^192`.
This value is smaller than the native field modulus.
The multiplication result has a 96-bit range check.

Division range-checks the quotient and remainder to 96 bits.
The product `q*y` is smaller than `2^192`, so it cannot wrap in the field.
The circuit also checks that the remainder is less than the divisor.
This check rejects a zero divisor.

Treasury inputs originate as `UInt64` values.
An amount or currency value multiplied by `10000` uses fewer than 78 bits.
Three maximum vote totals use fewer than 66 bits.
Each basis-point curve product is at most `100000000`, which uses 27 bits.
The participation product also uses fewer than 78 bits.

## Migration

The migration changes the following contract calculations:

- acceptance criteria;
- vote totals;
- approval basis points;
- related off-chain reference calculations.

The API validates contract arithmetic values against the `UInt96` maximum.
`UInt128` remains available for callers that cannot migrate in this release.

## Verification

Run the installed dependency check:

```sh
pnpm test:o1js-uint96
```

Run the Treasury proof check from `packages/sdk`:

```sh
O1JS_SECURITY_PROOFS=true node --loader ts-node/esm --test test/assurance/primitive/uint96-treasury-proof.test.ts
```

The migration changes circuit constraints.
Recompile all affected contracts and generate new verification keys before deployment.
An installed dependency does not change a deployed contract.
