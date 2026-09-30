# Treasury audit remediation

## Current review — 30 September 2026

Source: `mina-treasury-2 (2).pdf`, 53 pages, 26 findings.
SHA-256: `44a33618eeb823914cfa61d72cb6a1055d38f8fa90b0abf2fd8e15e09480142b`.
Finding IDs below use the revised audit's hexadecimal sequence.

Verification is closed at the user's request. The 21 source/documentation commits are complete through `fbcd14af4f1899c51f7db84f7769e7fa6309dab6`. Publication is recorded in the accompanying commit manifest.
“Implemented” describes committed source, not auditor acceptance or deployed behavior.
All eight API/CLI/browser continuations and the corrected full Compose false workflow passed. The duplicate Compose true phase was deliberately stopped. Signing defects and external/unverified scopes remain explicit residual limits.
See the [actual finding-to-commit mapping](AUDIT-CHANGE-REPORT-2026-09-30.md#findings-and-change-mapping).
Historical results below do not establish that the final candidate passes every test.

The o1js fork is published at `d670b3efd4fc7f0bf431a0b2211c28b1dc257944` on `feature/mesa-support`.
All eight manifests and the lockfile select this immutable revision, version 3.1.0.
It retains Mesa support, exports checked UInt96, and deprecates corrected UInt128.
Node ESM, CommonJS, and browser outputs are integrated. The 2,624 packaged files match the fork.
Arithmetic proof and browser checks passed. These checks do not establish acceptance by a live Mainnet node.
See [library security](O1JS-SECURITY.md) and [UInt96 migration](O1JS-UINT96.md).

| Revised finding | Current correction or decision | Verification limit and durable reference |
| --- | --- | --- |
| #00 — Empty-key updates pruned | Published fork retains mandatory AccountUpdates; only explicit absent optional updates are omitted. | Native library checks passed. New deployed verification keys remain unverified. [Library security](O1JS-SECURITY.md). |
| #01 — Nested token ID unbound | Published fork constrains the witnessed callee token ID. | Native nested-call checks passed. Recompile affected keys. [Library security](O1JS-SECURITY.md). |
| #02 — AccountUpdate packing unchecked | Published fork removes the `skipCheck` bypass and checks complete witnessed updates. | Focused malformed-field checks passed; this is not an exhaustive Treasury exploit claim. [Library security](O1JS-SECURITY.md). |
| #03 — Public administrative GraphQL | Public routes use limited port 3000. User declined the additional browser amount/recipient comparison. | Recommendation remains partial; deployed access requires operator checks. [Public routing regression](test/public-graphql.test.mjs). |
| #04 — Misleading signing bundles | Signing paths recompute the displayed operation hash and verify imported context. | This does not close the three separate signing issues listed below. [Signing review](../apps/backoffice/features/signing-bundle-review.test.ts). |
| #05 — DUMMY vote blocks tally | Fork retains mandatory signature updates; Owner rejects DUMMY votes before dispatch. | Reducer padding retains DUMMY support. [Owner contract](../packages/sdk/src/provable/contracts/treasury-owner.ts). |
| #06 — Token-symbol and URI bytes break import | Import preserves bytes; hashing and storage avoid a text round trip. Invalid records no longer become empty accounts. | 36 synthetic accounts passed native-root checks and eight real proof batches. Full audited Mainnet export remains untested; details below. [Ledger regression](../packages/sdk/test/ledgers/staking-ledger/account-decoding.test.ts). |
| #07 — Non-curve keys block tally | Shared compressed-key decoding covers import, storage, and delegate indexing. | Both audit keys occur in synthetic tests. This is not a full Mainnet import. [Key decoder](../packages/sdk/src/utils/public-key.ts). |
| #08 — Shortened events halt processing | Schema decoding restores permitted trailing zero fields; undecodable events are quarantined transactionally. | Quarantine remains visible to readiness. Replay-tail checks, all paired API/CLI/browser continuations and full Compose false mode passed; retained Lightnet remains unverified. [Processor](../packages/processor/src/events-processor.ts). |
| #09 — UInt128 arithmetic underconstrained | Treasury uses UInt96; the fork retains corrected UInt128 as deprecated compatibility. | Native arithmetic proofs passed. New compiled keys are required. [UInt96 migration](O1JS-UINT96.md). |
| #0a — Existing Owner permits planted Proposal | SDK and CLI require a fresh Owner. Prepared-network fixtures replace incompatible genesis-Owner fixtures. | Historical composed Lightnet evidence is not a clean final-suite pass. [Lightnet guide](../apps/docs/docs/developer/local-development/lightnet.md). |
| #0b — Proposal tracking pixels | Both Markdown renderers suppress images and retain alt text; stored content stays unchanged. | UI checks passed. Mermaid stays plain code; broader content moderation is not implemented. [Proposal detail regression](../packages/ui/src/treasury/proposals/proposal-detail.test.tsx). |
| #0c — Environment files enter published images | Docker build contexts exclude `**/.env*` recursively and exclude root `output/` and `tmp/` artifacts. | Synthetic Docker check passed. Published images, registry caches, and credential exposure still need assessment. [Exclusion regression](test/docker-env-exclusion.test.mjs). |
| #0d — Detached authorization prevents pause | Proposal owns its pause nonce. Signatures bind key, token ID, nonce, and explicit target; Controller verification consumes no Controller nonce. | Native integration checks passed. New keys and schema-2 bundles with new signatures are required. [Proposal contract](../packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts). |
| #0e — Devnet compilation prevents Mainnet proving | Strict `--network` / `NETWORK` selects mainnet or devnet before compile; default is mainnet. Workers and caches carry network identity. | Real Controller proof verifies with its Mainnet key and rejects its Devnet key. No live Mainnet submission. [Network regression](../packages/sdk/test/assurance/contracts/network/mainnet-controller-proof.test.ts). |
| #0f — Owner absent from staking snapshot | Creation requires positive default-token Owner membership under the exact staking root recorded by the transaction. | Wrong key, token, balance, and root regressions passed. Paired API/CLI/browser continuations and full Compose false mode passed; final retained Lightnet flows remain unverified. [Creation regression](../packages/sdk/test/provable/contracts/creation-snapshot.test.ts). |
| #10 — Adjacent periods overlap | Bounded periods end at `start + duration - 1`; unbounded operations keep their range. | Focused boundary checks passed. [Owner contract](../packages/sdk/src/provable/contracts/treasury-owner.ts). |
| #11 — Reducer state shared across Proposals | Traces, nullifiers, and proofs use lifecycle, canonical Proposal key, and token ID; traces start from an empty nullifier root. | Native reducer checks passed. [Reducer service](../packages/sdk/src/services/sqlite/sqlite-vote-reducer-service.ts). |
| #12 — Restore leaves stale SQLite sidecars | Restore clears sidecars. Shutdown drains checkpoint work and closes SQLite; Compose allows 21 minutes and the chart defaults to 1,260 seconds. | Recovery and signal checks passed. Hardware eviction or shorter spot deadlines can still interrupt shutdown. [Checkpoint regression](../apps/cli/test/checkpoint-recovery.test.ts). |
| #13 — Transient failures block processing | Readers require complete snapshots and reopen replacements. Operational failures retry with persisted backoff. | Unit and database checks passed. Quarantine-tail and zero-target checks, paired API/CLI/browser continuations and full Compose false mode passed. [Snapshot completion](../apps/api/src/staking-ledger/completed-snapshot.ts). |
| #14 — Conflicting or duplicate projections | Pending events require one complete branch; tied tips use canonical-only output. Identity uses transaction hash, account-update index, and event index. | Migration and projection checks passed. Replay-tail checks, paired API/CLI/browser continuations and full Compose false mode passed; controlled deployment remains unverified. [Identity migration](../apps/api/src/db/migrations/1790770000000-transaction-event-identity.ts). |
| #15 — Unbounded API joins | Parser allows two levels and four relation steps, and rejects entity revisits before reads. | HTTP regressions passed; this is not a general database performance guarantee. [CRUD parser](../apps/api/src/processor-crud-routes.ts). |
| #16 — Unusable voting weight | Documentation only, as requested. Unsignable weight remains in total currency. | No threshold or voting protocol change. [Protocol behavior](../apps/docs/docs/operate/reference/protocol-behavior.md). |
| #17 — Five distinct vote slots required | Documentation states the distinct inclusion-slot requirement. Five voters alone do not satisfy it. | Protocol limit remains. [Protocol behavior](../apps/docs/docs/operate/reference/protocol-behavior.md). |
| #18 — CLI tally ignores token ID | SQLite, API, and downloader use the default-token Owner and the same witness index. | Custom-token-first and custom-only regressions passed. [Snapshot inputs](../packages/sdk/test/services/treasury-owner-snapshot-inputs.test.ts). |
| #19 — Excess pod privileges | Committed and pushed chart source separates accounts and public servers, honors false token mounts, and limits role assignment. | Render checks passed. PR 346 awaits required code-owner review. Both authored and generated chart source refs are independently verified at the pushed commit; release tags, cloud policies, and rollout remain unverified. [Pipeline runbook](runbooks/2-Treasury/2d-Lifecycle-Pipeline/README.md). |

### Ledger and integration evidence

The ledger regression includes invalid URI bytes `ed b0 80`, both reported non-curve keys, byte-valued symbols, Unicode, and boundary lengths.
Thirty-six synthetic accounts passed import, SQLite storage, serialized trace replay, and eight generated and verified native proof batches.
Native Mina independently returned the same staking root, `jwf6wMnmAYgDBAQNUfLtAGYPTvLLCFcRuMjuvQxgiGGuvxhE62d`.
Four existing snapshots, with 17, 1,009, 1,007, and 10 accounts, passed import, stored-field, and native-root checks.
The eight proof batches belong to the synthetic fixture, not all accounts in those four snapshots.
The complete 288,898-account Mainnet export from the audit was not imported or proved in this work.

The post-repair baseline backend command passed 67 indexer, 63 processor, and 239 API tests, with zero skips. The PostgreSQL suite passed 11 tests, with zero skips. Both runs had unchanged before/after source hashes.
Its coverage percentages remain unvalidated TypeScript-offset approximations. Test passes do not establish accurate source coverage.
The source-mapped assurance run passed its tests but remains below the recorded line and function coverage targets.
API creation true mode passed 1/1 in 16.023 seconds, matching the saved false-mode cases and source hash with clean cleanup. API recovery true passed 16/16 and payout true 7/7, both with matched cases/sources. CLI operator true mode passed 2/2 in 2,190.796 seconds, with the saved false-mode cases and source hash matched, coverage recorded, and clean cleanup. Varied-ledger and negative CLI now pass both modes: 2/2 and 34/34, respectively, with matched cases and unchanged sources. These composed results do not establish a complete standard-wrapper pass. Recovery/payout false passed 16/16 and7/7.
These reported counts can include parent and child tests and must not be summed across reruns.
The title/body fixture corrections are complete. Corrected web proof-off passed 13/13 with unchanged sources; its wrapper stopped before Backoffice. Final browser proof-off passed web13/13 and Backoffice2/2 in2224.557seconds, with unchanged sources and clean cleanup. It includes the final warning-copy change. Web true passed 13/13 in 2,272.933 seconds and Backoffice true passed 2/2 in 693.948 seconds, with matched false cases, unchanged sources, coverage and clean unforced cleanup. Two separate default Backoffice browser tests passed against the verified production build.
The replay-tail correction passed 64 focused API tests, 63 processor tests, and worker-wiring checks. It preserves quarantine visibility and legacy zero-target projections. The final backend and database checks passed. Broader API/CLI and browser runs remain separate. No clean full repository pass is claimed.

The earlier disposable Lightnet check used a fresh Owner, actual funding, and a genuine local staking snapshot.
The normal run created a Proposal, then failed on temporary API database setup.
A separate recovery run passed five votes, reducer proofs, approved tally, execution, API assertions, and an 11 MINA payout.
This is composed historical evidence. It predates the final creation-witness interface and does not establish a clean final-suite pass.
It does not close the remaining prepared CLI or physical-device checks. Fresh current-key deployment and funding passed; The second read-only wait passed in 1,065.355 seconds: epoch 25, slot 18,012, 21 accounts, ledger root `jwrDL6WT5eFcM94CFzcqvZxucXMUaANzJtU66G5TMFEBDVtfxfp`, Owner present with positive balance. This establishes exported snapshot membership only; snapshot proofs and a completed current live flow remain unverified.
The isolated 900-slot Lightnet Owner/Controller deployment passed in 323.905 seconds and received 1,000 local MINA. Its actual anchor is slot 22,320 at epoch 31 start. This fresh Owner needs its own funded staking snapshot and proof/live-flow checks. The first permitted wait timed out; the second failed early on HTTP 502. The unchanged container remains running, but the Mina daemon is absent and its RPC port refuses connections. Cause unknown; the four final live flows are blocked, with no restart or reset performed. The earlier 420-slot deployment and epoch 25 positive snapshot remain historical evidence, not evidence for this new Owner. Isolated Compose proof-off smoke passed in 44.467 seconds; exact UI/probes passed in 36.939 seconds (Playwright 1/1). All task containers, networks, volumes and reserved listeners were removed; the three image IDs were unchanged. The first standard Compose attempt failed because the fixture lacked its completion marker. After that fixture-only correction, the full proof-disabled workflow passed in 665.571 seconds. The duplicate true phase was deliberately stopped at the user's fast-finish request; it did not pass. The wrapper exited 1 after intentional SIGINT, with unchanged sources and unforced cleanup; both projects were verified empty and all seven ports free. No public-network transaction or production deployment is claimed.

### Additional signing decisions and release limits

Three additional signing defects remain unresolved; their implementations were not approved:

- A client signing result can omit a required account signer. This does not bypass on-chain signature checks.
- Controller authorization can replay across Controllers with matching participants and nonce. Cross-network replay needs a separate test.
- Repeated participant keys can satisfy multiple threshold positions with one key.

See the [signing regression](../packages/sdk/test/signing/ledger-review.test.ts).
The Proposal-local pause correction does not close the separate Controller authorization issue.
A Controller envelope change would require matching circuit, caller, bundle, verification-key, and signature migration.

The user approved all remaining PDF implementation scopes. Finding #03's additional comparison remains declined; #16 is documentation-only; #17 remains a protocol limit.
Replay-tail correction and independent review are complete. Verification closes with the recorded passes, failed signing regressions and unverified scopes; no all-green or release-readiness claim is made.
Chart source publication and both immutable runbook pins are complete. Required PR review, release tags, cluster rollout, registry cleanup, cloud permission checks, and public-network deployment remain incomplete.
The fork was committed and pushed. Chart commit `c648c68ab8ee1f1cb2a88e91c022411aafcb82f2` is pushed and [PR 346](https://github.com/MinaFoundation/helm-charts/pull/346) awaits protected-branch review. Treasury source/documentation changes are committed through `fbcd14af4f1899c51f7db84f7769e7fa6309dab6`; push is not yet confirmed. The user authorized separate commits and pushes.
Updated operator and developer pages accompany the approved changes.


After these eight continuations passed, a helper-only proof-mode label normalization was applied to the native result reader and its test. Nine focused tests passed; all six saved pairs and final lint now pass. Runtime and suite sources did not change.


Verification is closed at the user's request with the completed checks and residual limits above. All eight API/CLI/browser matched continuations passed; this is not a complete original-wrapper or all-green repository result. Final retained Lightnet flows, the full audited Mainnet export and physical hardware remain unverified. No new proof/live job or backup/recovery is planned for this report. The [concise change report](AUDIT-CHANGE-REPORT-2026-09-30.md#findings-and-change-mapping) records the actual source/documentation commit IDs; the sanitized bundle carries the full 22-group series, including report-only T20.

## Previous audit baseline — 28 September 2026

The remaining sections record the previous audit and validation baseline.
They do not establish that the current worktree passes those full suites.
Finding numbers differ between the two audit documents.
The revised review must resolve the remaining implementation, dependency, and Lightnet fixture work before release.

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
| #07: compressed non-curve public keys; medium       | Import, storage, and delegate indexing use a canonical compressed-key decoder without requiring a curve point.                                            | Both reported mainnet keys decode. Round-trip and malformed-encoding checks pass. Separate invalid-parity and out-of-range-coordinate rejection cases were not established by that evidence.                                                             |
| #08: shortened events stop processing; medium       | Existing schema decoding restores the omitted final zero. Other undecodable events are quarantined with their raw snapshot and cursor in one transaction. | API pipeline tests process later valid events. PostgreSQL tests prove rollback and atomic quarantine. Dependency failures still retry. Readiness reports incomplete data. |
| #09: UInt128 arithmetic is underconstrained; medium | Checked 64-bit limbs enforce integer multiplication and overflow bounds. Division uses checked multiplication and a bounded remainder.                    | BigInt comparisons, malicious witnesses, overflow, zero divisor, and malformed limb tests pass. Real UInt128 and Treasury arithmetic proofs pass.                         |
| #0a/#0B: shared reducer state; low                  | Traces, nullifiers, and proofs use lifecycle, canonical Proposal key, and token ID. A trace must start with the empty nullifier root.                     | Real reducer proofs cover two Proposals, restart, and clearing. Full Treasury tally and execution proofs pass.                                                            |

## Code references

- Library corrections: [o1js security](O1JS-SECURITY.md), [UInt96 migration](O1JS-UINT96.md), and [UInt128 compatibility](O1JS-UINT128.md).
- Public routes: [daemon template](runbooks/1-Network/1b-Mina-Daemon/helmfile.yaml) and [stack template](runbooks/2-Treasury/2c-Deploy-Stack/helmfile.yaml).
- Vote guard: [Treasury Owner](../packages/sdk/src/provable/contracts/treasury-owner.ts).
- Ledger import: [staking ledger](../packages/sdk/src/ledgers/staking-ledger/staking-ledger.ts), [raw bytes](../packages/sdk/src/ledgers/staking-ledger/ledger-json-bytes.ts), and [key decoder](../packages/sdk/src/utils/public-key.ts).
- Event isolation: [processor](../packages/processor/src/events-processor.ts), [migration](../apps/api/src/db/migrations/1790586000000-processor-event-quarantine.ts), and [replay reconciliation](../apps/api/src/processors/proposals/proposal-projection-reconciler.ts).
- Reducer isolation: [SQLite service](../packages/sdk/src/services/sqlite/sqlite-vote-reducer-service.ts) and [tracer](../packages/sdk/src/proving/tracing/vote-reducer-tracer.ts).

## Dependency and integration

The fork uses o1js version 3.1.0 and retains deprecated UInt128, `VerificationKey.fromData`, `LocalBlockchain.setNetworkState`, and additional exports.
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
