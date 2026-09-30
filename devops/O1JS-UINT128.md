# Audit #09: UInt128 compatibility fix

`UInt128` is deprecated for Treasury arithmetic.
This record documents the checked implementation that remains for compatibility.
See [the UInt96 migration](O1JS-UINT96.md) for the current Treasury type.

Fix commit: `ac7eb036637f39e054ca68555c250f645a532da4`.
Parent: `25c616cdaa63827cb07e5199ac73058163fc60a9`.
The fix is integrated into the published `feature/mesa-support` branch.
The o1js 3.1.0 Treasury fork includes this fix.
The workspace manifests identify the final combined fork revision.

## Change and soundness

The production change is confined to `src/lib/provable/int.ts` in the fork.
It adds the existing `divMod64` import and changes `UInt128.mul()` and `UInt128.divMod()`.
It preserves the public API, full input range, and valid results.

Multiplication splits both inputs into checked 64-bit limbs.
It constrains the high-by-high product to zero and the cross-product sum plus carry to 64 bits.
Every intermediate is smaller than the field modulus, so the constraints enforce integer multiplication without modular wraparound.
Division uses this checked multiplication for `q*y`, then retains the bounded remainder and `r < y` checks.
Every valid division has `q*y <= x`, so this bound rejects no valid UInt128 division.

The fork's `UINT128-SECURITY.md` contains the complete integer argument.
This compatibility fix did not require a new dependency or backend change.
Node ESM, CommonJS, and browser outputs were rebuilt.

## Verification

| Check                                    | Result                                                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Old dependency                           | The two audit regression tests fail as expected                                                                              |
| UInt128 arithmetic                       | 6 tests pass across constants, witnesses, mixed inputs, limb boundaries, zero divisors, and deterministic BigInt comparisons |
| Prior account-update fixes plus UInt128  | 10 tests pass in both Node ESM and CommonJS                                                                                  |
| Chromium                                 | Valid arithmetic and required fork APIs work; both audit attacks are rejected                                                |
| WASM real proofs                         | Valid maximum product and division verify; both attacks, ordinary overflow, zero divisor, and malformed limb are rejected    |
| Native real proofs                       | Same proof test passes with the platform native package                                                                      |
| Treasury acceptance/approval real proofs | 3 cases verify, including zero approval votes and large UInt64 inputs                                                        |
| Selected Treasury contract tests         | 25 pass: acceptance criteria, Owner/Proposal boundaries, and tally/execution                                                 |
| Fork and SDK type checks                 | Passed                                                                                                                       |

The initial native attempt lacked the optional platform package in the temporary fork.
The rerun used the isolated Treasury package with the existing native dependency and passed.
Tests used isolated Treasury source and dependency copies to avoid interference with other tasks.
The complete project test suite and a new network deployment were not run for this narrow arithmetic change.

`Provable.runAndCheck()` does not validate the custom range-check gates used by `divMod64`.
The real-proof test therefore substitutes an oversized limb while preserving its reconstruction and requires rejection.
The quotient tests also verify that the malicious witness was actually substituted.

Measured circuit rows include two witnessed UInt128 inputs:

| Operation               | Old | Fixed |
| ----------------------- | --: | ----: |
| Multiplication          |  26 |    32 |
| Division with remainder |  43 |    57 |

Run the installed dependency checks:

```sh
pnpm test:o1js-uint128
pnpm test:o1js-uint128:proofs
pnpm test:o1js-security
pnpm test:o1js-security:browser
```

Run the Treasury proof check from `packages/sdk`:

```sh
O1JS_SECURITY_PROOFS=true node --loader ts-node/esm --test test/assurance/primitive/uint96-treasury-proof.test.ts
```

These circuit changes require new verification keys before deployment.
Existing deployed contracts do not receive the constraints through a dependency installation.
Evidence logs are stored under `output/audit-review/uint128/`.
