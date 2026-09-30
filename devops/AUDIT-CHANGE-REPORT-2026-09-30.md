# Audit change report — 30 September 2026

**Verification closed at the user's request. Source and documentation commits created. Publication is recorded in the accompanying commit manifest.** This report records implemented changes, completed checks and residual limits. It does not claim all tests passed or release readiness.

## Scope and publication state

Audit: `mina-treasury-2 (2).pdf`, dated 28 September 2026, 53 pages, 26 findings.
PDF SHA-256: `44a33618eeb823914cfa61d72cb6a1055d38f8fa90b0abf2fd8e15e09480142b`.
Audited Treasury revision: `98f5ed25129a874dc36e217403f3114ce51b716e`.
Audited o1js revision: `87bc121acad6ba4d81df499e49ff44800c130ded`.

The history review covers 27 pre-existing Treasury commits between the audited revision and reviewed base `57167b6fcf2ae9af6c10a77a263646d7a7184879`, plus four fork commits. The new series has 22 remediation/publication groups: 21 source/documentation commits through `fbcd14af4f1899c51f7db84f7769e7fa6309dab6` plus T20 for this report and the current remediation summary. Thus the published history adds 22 commits to the 27 pre-existing commits; it does not replace them. The sanitized bundle carries the full 22-group mapping; T20's self-hash is recorded there only.

The installed fork is published at `d670b3efd4fc7f0bf431a0b2211c28b1dc257944`, version 3.1.0. All eight dependency pins and the lockfile select it. Its prior security commits are `25c616cd`, `ac7eb036`, and `b6ddc6ae`. See [library security](O1JS-SECURITY.md) and [UInt96 migration](O1JS-UINT96.md).

Chart source is committed and pushed at `c648c68ab8ee1f1cb2a88e91c022411aafcb82f2`, tree `ee106f72840ea4ab88781725c2f0c8a6b7ea86e5`. [Chart PR 346](https://github.com/MinaFoundation/helm-charts/pull/346) awaits required code-owner review. Auto-merge is disabled. No bypass, merge, release tag, or cluster rollout is claimed. Independent direct reads confirm both authored source refs and their generated copies at the full pushed commit after the ledger-provider correction. Source pinning and release-tag publication are separate steps.

## Findings and change mapping

The table uses the revised audit's hexadecimal IDs. [Audit remediation](AUDIT-REMEDIATION.md) contains durable source references and migration details. “Implemented” describes source, not deployment.

| Finding | Change or accepted decision | Treasury commit | Verification and remaining limit |
| --- | --- | --- | --- |
| 00,01,02 | Published fork retains mandatory updates, binds nested token IDs, and checks complete AccountUpdates. | [479bdc2862c1](https://github.com/MinaFoundation/decentralised-treasury/commit/479bdc2862c140f0d7f6d01280e1782bcca1bc95) | Native library regressions passed. Existing fork commit 25c616cd supplies these fixes; compiled deployment keys must change. |
| 03 | Public routes use restricted GraphQL port 3000. Additional browser amount/recipient comparison was declined. | [fbcd14af4f18](https://github.com/MinaFoundation/decentralised-treasury/commit/fbcd14af4f1899c51f7db84f7769e7fa6309dab6) (decision/docs) | Configuration checks passed. Recommendation remains partial; deployed access is unverified. |
| 04 | Imported signing operations are checked against the displayed operation and deployment context. | [51e93045043c](https://github.com/MinaFoundation/decentralised-treasury/commit/51e93045043c74d2866060e3d762f3bb4e10f445) (earlier fix) | Earlier client correction remains; separate signing defects below remain open. |
| 05 | Required signatures remain present; Owner rejects DUMMY votes before dispatch. | [479bdc2862c1](https://github.com/MinaFoundation/decentralised-treasury/commit/479bdc2862c140f0d7f6d01280e1782bcca1bc95), [519cb86a0567](https://github.com/MinaFoundation/decentralised-treasury/commit/519cb86a056728083070128b0a89f0c8c18fdf43) | Authorization/reducer checks passed. Internal reducer padding remains valid. |
| 06,07 | Preserve raw symbol/URI bytes and compressed public keys across import, hashing, storage, and indexing. | [96b2780889a3](https://github.com/MinaFoundation/decentralised-treasury/commit/96b2780889a35003e48a4b73534ed4a0c6903af1) | Native byte and key checks passed. Full audited Mainnet export remains untested. |
| 08 | Restore permitted trailing event zero; quarantine undecodable events atomically. | [338e4edf69c5](https://github.com/MinaFoundation/decentralised-treasury/commit/338e4edf69c567954ab880c8fe67d39d2b1ed82a) | Processor and replay regressions passed; quarantine remains visible to readiness. |
| 09 | Use checked UInt96 in Treasury; retain corrected UInt128 as deprecated compatibility. | [479bdc2862c1](https://github.com/MinaFoundation/decentralised-treasury/commit/479bdc2862c140f0d7f6d01280e1782bcca1bc95), [dbdd613d3dd6](https://github.com/MinaFoundation/decentralised-treasury/commit/dbdd613d3dd633c67bc57f9f812ced930b7cb180) | Native arithmetic and browser checks passed. Fork commits ac7eb036 and d670b3ef supply arithmetic/export changes. |
| 0a | Require a fresh Owner deployment; migrate fixtures to prepared snapshots. | [e1ba69e35d9a](https://github.com/MinaFoundation/decentralised-treasury/commit/e1ba69e35d9ab49203e7235e7acb08237182ff6f), [f099412b1dde](https://github.com/MinaFoundation/decentralised-treasury/commit/f099412b1ddede750548eea47802507fea273333) | Deployment checks passed. Historical composed Lightnet flow is not a clean final-suite result. |
| 0b | Suppress Proposal Markdown images; retain alt text and stored commitments. | [1b5bfd0cec92](https://github.com/MinaFoundation/decentralised-treasury/commit/1b5bfd0cec9225cf08932d5336b74878e6353067) | UI regressions passed. Mermaid remains plain code; no broader moderation service was added. |
| 0c | Exclude `.env*` recursively and root audit `output`/`tmp` from Docker contexts. | [2784c291f8f1](https://github.com/MinaFoundation/decentralised-treasury/commit/2784c291f8f1ba3249a6030e94696f121a667d9d) | Synthetic Docker check passed 1/1 while retaining app files; docs 111 passed. Clean-context image checks and full Compose false workflow passed. Published-image/credential assessment is separate. |
| 0d | Bind pause signatures to Proposal key, token ID, local nonce, and explicit target. | [825de0e4d76d](https://github.com/MinaFoundation/decentralised-treasury/commit/825de0e4d76d3b566fa2a069e13269f07099698a), [f099412b1dde](https://github.com/MinaFoundation/decentralised-treasury/commit/f099412b1ddede750548eea47802507fea273333) | Native integration checks passed. Schema-2 bundles, new signatures, and new keys are required. |
| 0e | Select mainnet/devnet before compilation; bind worker and cache identity to network. | [af1d956ad735](https://github.com/MinaFoundation/decentralised-treasury/commit/af1d956ad735f78fcb287f2ea27b3212695073ac), [c00e8f827701](https://github.com/MinaFoundation/decentralised-treasury/commit/c00e8f82770140e43213b1b885e3e8d3149f12a0) | Mainnet Controller proof verifies with its Mainnet key and rejects the Devnet key. No live Mainnet submission. |
| 0f,18 | Prove positive default-token Owner snapshot membership; use the same selected account and witness for tally. | [f064b6206d70](https://github.com/MinaFoundation/decentralised-treasury/commit/f064b6206d700c7eded50fc300e5d415c97aa6f6), [f099412b1dde](https://github.com/MinaFoundation/decentralised-treasury/commit/f099412b1ddede750548eea47802507fea273333) | Membership and token-selection checks passed. API/CLI/browser continuations and full Compose false mode passed; final retained Lightnet flows remain unverified. |
| 10 | End bounded periods at `start + duration - 1`. | [ac1834bc79a2](https://github.com/MinaFoundation/decentralised-treasury/commit/ac1834bc79a27e6e026f78d72d839e2d5a3218f2), [f099412b1dde](https://github.com/MinaFoundation/decentralised-treasury/commit/f099412b1ddede750548eea47802507fea273333) | Boundary checks passed. Unbounded operation ranges remain unchanged. |
| 11 | Namespace reducer state by lifecycle, Proposal key, and token ID. | [b1815cacb9d6](https://github.com/MinaFoundation/decentralised-treasury/commit/b1815cacb9d6521f753419a51cd3a82d9d07fe75) | Native reducer and restart checks passed. Existing mixed artifacts require a controlled rebuild. |
| 12 | Remove SQLite sidecars on restore; drain checkpoint writes and close before shutdown. | [c83a7f044fa6](https://github.com/MinaFoundation/decentralised-treasury/commit/c83a7f044fa6121162b51a7ba3abe6f3c7fa0540), [c00e8f827701](https://github.com/MinaFoundation/decentralised-treasury/commit/c00e8f82770140e43213b1b885e3e8d3149f12a0) | Recovery and signal checks passed. Compose/chart grace cannot guarantee completion during hard eviction. |
| 13,14 | Retry operational failures; require completed snapshots; project one branch with stable transaction-relative identity and safe replay. | [338e4edf69c5](https://github.com/MinaFoundation/decentralised-treasury/commit/338e4edf69c567954ab880c8fe67d39d2b1ed82a), [f099412b1dde](https://github.com/MinaFoundation/decentralised-treasury/commit/f099412b1ddede750548eea47802507fea273333) | Backend/database checks passed after quarantine-tail repair. Tied tips use canonical-only output; API/CLI/browser continuations and full Compose false mode passed. |
| 15 | Limit joins to two levels/four relation steps; reject entity revisits before reads. | [7b4c9199bba8](https://github.com/MinaFoundation/decentralised-treasury/commit/7b4c9199bba8b288f16734d8ee2eb15f88880952) | HTTP regressions passed. This is not a general database performance bound. |
| 16 | Document unusable voting weight; retain the protocol as requested. | [fbcd14af4f18](https://github.com/MinaFoundation/decentralised-treasury/commit/fbcd14af4f1899c51f7db84f7769e7fa6309dab6) | Documentation-only decision. Unsignable weight remains in the threshold denominator. |
| 17 | Document the requirement for five distinct vote inclusion slots. | [fbcd14af4f18](https://github.com/MinaFoundation/decentralised-treasury/commit/fbcd14af4f1899c51f7db84f7769e7fa6309dab6) | Protocol limit remains; five voters alone are insufficient. |
| 19 | Separate chart workload identities and public servers; honor false token mounts and restrict role assignment. | [c00e8f827701](https://github.com/MinaFoundation/decentralised-treasury/commit/c00e8f82770140e43213b1b885e3e8d3149f12a0) | Chart commit c648c68a passed 18 tests and is pushed. Source pins are verified. Required PR review, release tags, and live permissions remain distinct. |

## Additional changes

These changes are separate from the PDF recommendations.

| Change | Reason and validation | Commit |
| --- | --- | --- |
| 10 MINA minimum Proposal and 1 MINA minimum bond | Shared integer policy across contract, SDK, CLI and UI; focused native/unit checks passed. | [69382d51732c](https://github.com/MinaFoundation/decentralised-treasury/commit/69382d51732c27d5aea53a5b0feed828d13fe749) |
| Tally-input downloader | Downloads and checks input identity without signing, submitting, or cryptographically verifying the downloaded proof; SQLite/HTTP regressions passed. | [34f179edc045](https://github.com/MinaFoundation/decentralised-treasury/commit/34f179edc045bed5e98182abe7a464cbfc64585d) |
| Local-chain and fixture compatibility | Add canonical Archive ancestry support, current snapshot/caller inputs, isolated ports, and corrected content fixtures. All eight API/CLI/browser continuations passed; full Compose false mode passed. | [f099412b1dde](https://github.com/MinaFoundation/decentralised-treasury/commit/f099412b1ddede750548eea47802507fea273333) |
| Verification harness and CI | Fix source-map coverage positions and child environment isolation; add serialized native jobs and SDK type checks. No threshold reduction. | [c871cc7fbf39](https://github.com/MinaFoundation/decentralised-treasury/commit/c871cc7fbf39f931eaef76f17fdead5732b7cf52) |
| Documentation and runbooks | Describe migrations, evidence limits, network selection, snapshots, and privilege separation. Final generation/build passed; later test-only changes do not affect docs inputs. | [fbcd14af4f18](https://github.com/MinaFoundation/decentralised-treasury/commit/fbcd14af4f1899c51f7db84f7769e7fa6309dab6) |

## Observed validation

Counts overlap across commands and must not be summed.

- Backend: 67 indexer, 63 processor, 239 API; PostgreSQL: 11. All passed with unchanged sources.
- Native Treasury lifecycle: 11 passed; account/minimum/reducer: 38; Mainnet Controller proof: 1.
- Ledger bytes: 36 synthetic accounts, eight verified proof batches and native root parity. Four snapshots (17/1,009/1,007/10 accounts) passed import/storage/root checks, not full-snapshot proofs.
- Local checks: all three API and all three CLI suites pass both modes through source/case-matched continuations. Negative CLI true passed 34/34 in 5,475.583 seconds. Web false and true each passed 13/13; true took 2,272.933 seconds with unchanged sources and clean cleanup. Backoffice false and true each passed 2/2; true took 693.948 seconds.
- Fresh 900-slot Lightnet deployment/funding passed. Its first snapshot wait timed out; the second failed early on HTTP 502. The container runs, but the daemon is absent; cause unknown. Four final live flows remain unverified. Automatic approval review rejected private backup; neither backup nor recovery ran. Earlier 420-slot evidence is historical.
- Software-Ledger signing and a real 2 MINA payment passed with task-local account allocation. Retained manager retries timed out; its liveness and physical hardware remain unverified.
- Final docs checks and production build passed with 718 unchanged files at capture. Three later test-only changes are outside actual docs generator/check inputs; no regeneration is required.
- Assurance tests passed; diagnostic coverage remains NOT_READY (72.13% lines, 65.54% functions, 85.45% branches; 28 files below 60% lines). Standard backend coverage percentages remain unvalidated TypeScript-offset approximations.

The corrected standard Compose proof-disabled workflow passed in 665.571 seconds, including creation, five votes, tally, payout, projections and browser checks. The user requested fast completion, so its duplicate true phase was stopped during startup; it did not pass. The wrapper exited 1 after intentional SIGINT, with unchanged sources and unforced cleanup. Both projects were verified empty and all seven ports free. Earlier failures remain preserved.

A later result-reader-only change passed nine focused tests, six saved native-pair rechecks and lint. No runtime or suite source changed. The Compose fixture marker is outside those eight continuation inventories. Separate continuation passes do not establish a complete original-wrapper pass.

The exact 288,898-account Mainnet export remains untested and unavailable in the bounded search. Audit #06 used LocalBlockchain/Mesa Lightnet byte cases; #07 used Mainnet for non-curve keys. Invalid URI bytes were not established in that Mainnet export. Physical Ledger and live Mainnet acceptance remain unverified.

## Residual risks and migration

Exactly three additional signing defects remain unresolved; their implementations were not approved:

1. Reject a client result that omits a required account signer. The current defect does not bypass on-chain authorization.
2. Bind Controller authorization to its deployment and network context. Cross-Controller replay is demonstrated; cross-network replay still needs a test.
3. Require distinct participant keys so one key cannot satisfy multiple threshold positions.

The request to commit and push does not approve these implementations. Their failing regressions remain visible. Static comparison places these cases and affected functions before the remediation; no old-dependency execution baseline is claimed.

Recompile affected verification keys, replace old pause bundles, and recollect signatures. Rebuild corrupted ledger artifacts from original byte exports. Deploy a fresh Owner and wait for its funded staking snapshot. Back up the database before migrations and verify replay completion. Replace old network options with `--network`/`NETWORK`. Review chart identity and storage migrations before a separately authorized rollout.

No clean full-suite pass, auditor acceptance, registry cleanup, cluster rollout, or public-network deployment is claimed. Verification is closed with these limits. The actual source/documentation IDs are recorded above. The report commit omits its own hash to avoid a self-reference.
