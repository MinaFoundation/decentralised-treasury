# Treasury audit remediation

Assessment date: 2026-09-28.
Source: `mina-treasury-2 (1).pdf`, 29 pages.
SHA-256: `cb8cc39dece4e61457a3c86e96070cb2d0319e03c94f51f2b134ae3859d470ba`.

The audit has 11 findings. The contents label the last finding #0a; its body uses #0B.
The document recommendations are review input. They do not authorize publication or deployment.

## Release status

The code corrections below are implemented and tested.
The combined o1js fork is published on the existing `feature/mesa-support` branch at [b6ddc6ae](https://github.com/maht0rz/o1js/commit/b6ddc6ae65ea2c51ad9a38650df71e6f19ffd0b9).
All eight workspace manifests and the lockfile use that immutable revision.
The temporary local package override is removed.
The Treasury merge includes `origin/develop` at `f399bb347c32aecaac13e2b8721df1b36e9ac9d9`.
The merge and working changes remain uncommitted.

These results establish local implementation coverage. They do not establish auditor acceptance or the state of a deployed Treasury.

## Findings

| Finding                                             | Correction                                                                                                                                                | Regression evidence                                                                                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #00: empty-key account updates disappear; high      | The fork retains mandatory updates. Only explicit optional updates can be omitted.                                                                        | The installed dependency retains an empty-key update and its nonce requirement. Conditional update behavior also passes.                                                  |
| #01: nested token ID is unconstrained; high         | Nested calls bind the witnessed token ID to the callee token ID.                                                                                          | A substituted wrong-token witness is rejected. Valid nested calls generate and verify real proofs.                                                                        |
| #02: unchecked account-update packing; high         | The fork removes the `skipCheck` bypass and checks the complete witnessed account update.                                                                 | Malformed Boolean and UInt32 witnesses are rejected even when the old option is supplied.                                                                                 |
| #03: public administrative GraphQL; high            | Both cited Kubernetes routes use the limited daemon endpoint on port 3000. The internal administrative port remains private.                              | A configuration test checks both public routes. Generated runbooks and downloads match the source templates.                                                              |
| #04: misleading signing bundles; high               | Existing fixes recompute the operation hash and verify deployment, nonce, participant, and Proposal state before signing.                                 | All 101 backoffice tests pass. Both signing paths use the verified operation.                                                                                             |
| #05: empty-key DUMMY vote poisons a tally; high     | Mandatory signature updates remain present. Owner voting also rejects `Vote.DUMMY`; reducer padding retains DUMMY support.                                | Authorization tests reject new DUMMY votes without adding actions. The full Treasury voting and tally proof tests pass.                                                   |
| #06: raw ledger symbol and URI bytes; medium        | Ledger import preserves bytes before JSON parsing. Account hashing uses the committed fields. Invalid records no longer become empty accounts.            | Ledger decoding, native root fixtures, storage, and constrained hashing tests pass. The API uses the resulting Account JSON type directly.                                |
| #07: compressed non-curve public keys; medium       | Import, storage, and delegate indexing use a canonical compressed-key decoder without requiring a curve point.                                            | Both reported mainnet keys decode. Canonical encoding, parity, checksum, and coordinate rejection tests pass.                                                             |
| #08: shortened events stop processing; medium       | Existing schema decoding restores the omitted final zero. Other undecodable events are quarantined with their raw snapshot and cursor in one transaction. | API pipeline tests process later valid events. PostgreSQL tests prove rollback and atomic quarantine. Dependency failures still retry. Readiness reports incomplete data. |
| #09: UInt128 arithmetic is underconstrained; medium | Checked 64-bit limbs enforce integer multiplication and overflow bounds. Division uses checked multiplication and a bounded remainder.                    | BigInt comparisons, malicious witnesses, overflow, zero divisor, and malformed limb tests pass. Real UInt128 and Treasury arithmetic proofs pass.                         |
| #0a/#0B: shared reducer state; low                  | Traces, nullifiers, and proofs use lifecycle, canonical Proposal key, and token ID. A trace must start with the empty nullifier root.                     | Real reducer proofs cover two Proposals, restart, and clearing. Full Treasury tally and execution proofs pass.                                                            |

## Code references

- Library corrections: [o1js security](O1JS-SECURITY.md) and [UInt128 constraints](O1JS-UINT128.md).
- Public routes: [daemon template](runbooks/1-Network/1b-Mina-Daemon/helmfile.yaml) and [stack template](runbooks/2-Treasury/2c-Deploy-Stack/helmfile.yaml).
- Vote guard: [Treasury Owner](../packages/sdk/src/provable/contracts/treasury-owner.ts).
- Ledger import: [staking ledger](../packages/sdk/src/ledgers/staking-ledger/staking-ledger.ts), [raw bytes](../packages/sdk/src/ledgers/staking-ledger/ledger-json-bytes.ts), and [key decoder](../packages/sdk/src/utils/public-key.ts).
- Event isolation: [processor](../packages/processor/src/events-processor.ts), [migration](../apps/api/src/db/migrations/1790586000000-processor-event-quarantine.ts), and [replay reconciliation](../apps/api/src/processors/proposals/proposal-projection-reconciler.ts).
- Reducer isolation: [SQLite service](../packages/sdk/src/services/sqlite/sqlite-vote-reducer-service.ts) and [tracer](../packages/sdk/src/proving/tracing/vote-reducer-tracer.ts).

## Dependency and integration

The fork uses o1js version 3.1.0 and retains UInt128, `VerificationKey.fromData`, `LocalBlockchain.setNetworkState`, and additional exports.
A source comparison covers all 212 official `src/lib` TypeScript files.
Only four files differ: the three required extension modules and `zkapp.ts`.
The extra `zkapp.ts` correction synchronizes the nested callee's cached checked account update during compilation and proving.
Without this correction, Treasury voting and tallying failed with `FieldVector` bounds errors.
With it, all nine full Treasury proof tests pass with the original explicit approval calls.

The native dependency remains explicitly pinned to `@o1js/native` 3.0.0.
The registry did not provide version 3.1.0 of that package at validation time.
The fork retains the existing Mesa/native backend and compiled cryptographic artifacts.
Real native proofs validate the changed Treasury paths with this combination.

## Validation

Validation uses Node 24.6.0 and pnpm 9.0.0 on macOS.
Real proof runs use `O1JS_BACKEND=native` and two workers for the full Treasury lifecycle.
The proof cache stores compiled circuits; tests still generate and verify proofs.

| Check                                      | Result                                                             |
| ------------------------------------------ | ------------------------------------------------------------------ |
| Full Treasury lifecycle with real proofs   | 9 passed; creation, voting, tally, and execution                   |
| Proposal-specific reducer with real proofs | 3 passed; compilation, startup, and isolation lifecycle            |
| Library nested-call real proofs            | 2 passed; wrong-token rejection and nested update cache regression |
| UInt128 adversarial real proofs            | 1 passed, with valid and attack cases                              |
| Treasury UInt128 real proofs               | 1 passed, with three arithmetic cases                              |
| Node ESM and CommonJS library regressions  | 10 passed in each format                                           |
| Browser security checks                    | All seven reported checks passed                                   |
| SDK focused regression suite               | 68 passed with proofs disabled                                     |
| PostgreSQL integration                     | 6 passed, with no skipped tests                                    |
| Web / backoffice / shared UI               | 134 / 101 / 203 passed                                             |
| Workspace type checks / lint               | 9 / 4 tasks passed                                                 |

Backend coverage passes: 64 indexer tests and 232 API tests.
All 62 processor tests pass with coverage. A stale fetch cannot clear an unresolved quarantine.
All 24 focused CLI tests, the root CLI launcher test, and 13 deployment configuration tests pass.
Documentation validation and the production documentation build pass.
The published package matches all 2,623 installed source and build files in the tested fork.
Its package version is 3.1.0. Generated test databases are excluded from the staged changes.
A frozen installation of the published revision passes. Workspace type checks and library regression checks also pass after installation.
All three library security proof tests pass again against the published package.
Local logs are under `output/audit-final/`; they are not release source files.
Earlier failed runs remain there as diagnostic evidence. Only successful final runs support the results above.

## Deployment requirements and limits

1. Install from the final immutable dependency pin and lockfile.
2. Run database migrations before starting the updated processor.
3. Recompile affected contracts and deploy matching verification keys.
4. Apply the corrected public routes. Check that administrative mutations fail through each public endpoint.
5. Retry previously blocked events after deployment. Inspect quarantined snapshots; later valid events can continue while readiness remains false.
6. Use a fresh reducer namespace for each Proposal. Do not reuse old lifecycle-only state.

An installed package cannot modify an existing on-chain contract.
A new deployment or an approved protocol migration can be necessary where verification-key replacement is prohibited.
Existing poisoned on-chain histories require separate recovery planning.
No live network deployment or full audited mainnet ledger export was tested in this work.
The tests cover the reported failure mechanisms and relevant valid flows, rather than every possible Treasury exploit input or network schedule.
