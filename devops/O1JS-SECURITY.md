# o1js 3.1.0 Treasury fork

The workspace uses one immutable fork revision in all package manifests.
The root `package.json` and `pnpm-lock.yaml` pin [b6ddc6ae](https://github.com/maht0rz/o1js/commit/b6ddc6ae65ea2c51ad9a38650df71e6f19ffd0b9).
This revision is published on the existing `feature/mesa-support` branch.
The package version is `3.1.0`.

## Included changes

The fork includes the complete runtime source changes from the official npm
[o1js 3.1.0 package](https://registry.npmjs.org/o1js/-/o1js-3.1.0.tgz).
It retains `UInt128`, `VerificationKey.fromData`, `LocalBlockchain.setNetworkState`,
and the additional exports used by the Treasury.

| Audit finding | Correction                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| #00, #05      | Mandatory account updates remain in the call forest, including empty-key updates. Only explicit optional updates can be omitted. |
| #01           | A nested call constrains the token ID against the callee instance.                                                               |
| #02           | Every witnessed account update receives the full canonical field checks. The `skipCheck` bypass is removed.                      |
| #09           | UInt128 multiplication and division use bounded integer constraints. See [the arithmetic record](O1JS-UINT128.md).               |

The fork also synchronizes the cached `SmartContract.self` update after a nested call.
Compilation does not execute the callee witness. Proving does execute it.
Both paths must retain the checked witnessed update for later caller access.
Without this correction, Treasury vote and tally proofs fail with a `FieldVector` bounds error.
The correction preserves the existing account-update range and authorization checks.

## Native backend

The optional native dependency remains pinned to `@o1js/native` `3.0.0`.
The registry did not provide `@o1js/native` `3.1.0` on 2026-09-28.
This fork retains the existing compiled cryptographic backend and Mesa support.
The package version and native dependency version are therefore different by design.

## Validation

Run these checks from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test:o1js-security
pnpm test:o1js-uint128
pnpm test:o1js-security:browser
O1JS_BACKEND=native pnpm test:o1js-security:proofs
O1JS_BACKEND=native pnpm test:o1js-uint128:proofs
```

The proof commands generate and verify real proofs.
The nested-update regression includes two nested calls, a voter signature, and explicit approval.
It must prove and include the transaction with both child proof authorizations present.
Negative proof tests can print an expected proving error while the test passes.

Use [the remediation record](AUDIT-REMEDIATION.md) for the complete finding inventory and final validation results.

## Deployment

Recompile all affected contracts and generate matching verification keys.
Installing a new dependency does not change deployed contracts.
The Owner and Pause Controller can prohibit in-place verification-key replacement.
Use a new deployment or an approved protocol migration where required.
Validate the intended network configuration before deployment.
