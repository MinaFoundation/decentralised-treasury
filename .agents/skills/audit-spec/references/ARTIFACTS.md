# Audit-spec artifact contract

This is the durable, deliberately small record format for `$audit-spec`.

## Layout

```text
.audit-spec/<scope-slug>/
├── SCOPE.md
├── STATUS.md
├── BUSINESS_LOGIC.md
├── BEHAVIOR_INVENTORY.md
├── ARCHITECTURE.md
├── SECURITY_MODEL.md
├── RISKS.md
├── COVERAGE.md
├── SPECIFICATION.md
├── REVIEW_PACKET.md
├── HUMAN_REVIEW.md
├── CONSOLIDATION.md
├── inventory/
│   ├── census.test.mts
│   ├── inventory.test.mts
│   └── raw output
├── diagrams/
│   ├── *.mmd
│   └── *.trace.md
├── jobs/JOB-*.md
├── claims/HYP-*/
│   ├── CLAIM.md
│   ├── verify.test.mts
│   ├── RESULT.md
│   ├── stdout.log
│   └── stderr.log
├── attacks/ATK-*/
│   ├── ATTACK.md
│   ├── attack.test.mts
│   ├── RESULT.md
│   ├── stdout.log
│   └── stderr.log
├── replay/HYP-*/
├── reviews/round-<n>/
└── publication/
    ├── README.md
    ├── SUMMARY.md
    ├── system-overview.md
    ├── components/*.md
    ├── flows/*.md
    ├── findings.md
    ├── review-status.md
    ├── coverage.md
    ├── evidence.md
    ├── glossary.md
    └── MANIFEST.md
```

## Scope and status

`SCOPE.md` records repository/revision, included paths and exclusions, scope and lockfile hashes, dirty state, Node/package-manager/TypeScript runner versions, smoke-test command, role/artifact hashes, sensitive exclusions, authorized normative inputs, an applicability decision/rationale for every security profile, selected applicable/uncertain profiles, and available deterministic TypeScript execution contexts with fixtures, mocks, services, proof mode, isolation, and limitations.

`STATUS.md` is orchestrator-owned. Record hashes; SRC/BHV/CL/INV/census/mapped/unmapped/HYP/result and asset/objective/THR/ATK counts; dispositions; risks; review/consolidation state; next action; and jobs. Preserve invalid/superseded history.

Each `JOB-*.md` records ID, role, revision, objective, dependencies, exact paths/boundary/permissions/safety. Investigation jobs contain exact BHV/CL/INV ownership, profiles, anchors, contexts, and outputs. Dynamic ownership is invalid. Normal jobs cannot overlap. An indivisible over-cap BHV uses disjoint `CLAUSE_SHARD` jobs sharing only parent BHV/HYP, then one `CLAIM_INTEGRATION` job that alone owns CLAIM.md.

Workload caps: PURE jobs own at most six BHVs or 24 records; complex jobs own at most three BHVs or 12 records. Indivisible over-cap BHVs require clause shards and integration. Split smaller for incompatible contexts/oracles.

## Behavior layers

- **Intended:** explicit authorized goal/rule. Record authority and source; otherwise `UNKNOWN`. Only an identifiable human can make it `AUTHORITY_APPROVED`.
- **Expected:** predeclared observable result derived from named intent, public contract, policy, or test; otherwise `UNKNOWN` or `CONFLICTING`.
- **Implemented:** observed behavior of the pinned revision; publish only from a `VERIFIED` TypeScript result.

Never infer intent from code or rewrite expectation after observing implementation.

## `BUSINESS_LOGIC.md`

Write before implementation inspection. Begin with an authority register, then one `BL-*` per meaningful business/security rule:

```markdown
## BL-0001 — Title
- Actor or stakeholder: <name or UNKNOWN>
- Requirement class: BUSINESS | SECURITY
- Intended behavior: <authorized rule or UNKNOWN>
- Intended authority/source/status: <authority, anchor, AUTHORITY_PROPOSED|AUTHORITY_APPROVED|UNKNOWN>
- Expected behavior: <observable outcome or UNKNOWN|CONFLICTING>
- Expected basis and derivation: <source and reasoning or UNKNOWN>
- Implemented behavior: NOT_EVALUATED
- Applies when: <preconditions/domain>
- Conflicts and unknowns: <gaps>
```

Cover actors, goals, decisions, inputs/outputs, permissions, state transitions, invariants, failure policy, side effects, ordering, and limits.

## `BEHAVIOR_INVENTORY.md`

Record independent census/classifier commands, hashes, diagnostics, and counts. The generic census identifies every executable outcome/effect and independently emits invariant-category obligations without authored CL/INV records. Every executable outcome maps to CL; every obligation maps to INV. `NON_SEMANTIC` is limited to non-executable syntax and requires an allowed reason plus mechanical evidence.

```markdown
| Census ID | Source anchor | Syntax kind | Classification | Allowed reason | Mechanical evidence |
|---|---|---|---|---|---|
| CEN-... | src/x.ts:L1 | InterfaceDeclaration | NON_SEMANTIC | TYPE_ONLY | no executable child/initializer |
```

Allowed reasons: `TYPE_ONLY`, `DECLARATION_ONLY`, `INERT_LITERAL_DATA`, `IMPORT_EXPORT_ONLY`. Executable sites cannot use them.

### Source accountability

Assign one stable `SRC-*` per scoped file and declared symbol. Also assign one to each anonymous callback or top-level executable site found by the compiler-AST scan to contain calls, mutation, thrown errors, or state/authorization/asset/proof/cryptographic/external-effect indicators. Do not enumerate other AST nodes or control-flow paths.

```markdown
| SRC | File/symbol | Kind/visibility | Significance | Parent BHV | Rationale |
|---|---|---|---|---|---|
| SRC-0001 | src/x.ts::run | exported function | BEHAVIOR | BHV-0001 | controls an externally visible transition |
```

Allowed significance values:

- `BEHAVIOR`
- `SUPPORTING_IMPLEMENTATION`
- `NO_OBSERVABLE_BEHAVIOR`
- `UNRESOLVED_SIGNIFICANCE`
- `OUT_OF_SCOPE`

Every record has exactly one. Supporting records link to at least one parent behavior. Every executable helper/site is `BEHAVIOR`, `SUPPORTING_IMPLEMENTATION`, or `UNRESOLVED_SIGNIFICANCE`. `NO_OBSERVABLE_BEHAVIOR` is allowed only when the inventory mechanically classifies the record as a non-executable type/declaration or inert data with no call, mutation, or initialization effect. `UNRESOLVED_SIGNIFICANCE` enters human review. This provides omission resistance without giving every helper an independent specification or test.

### Meaningful behaviors

Create one record per atomic user/business/security rule or observable effect:

```markdown
## BHV-0001 — Title
- Status: PROVISIONAL | VERIFIED | CONTRADICTED | UNRESOLVED | OUT_OF_SCOPE | STALE | SUPERSEDED
- Impact tier: LOW | MEDIUM | HIGH | CRITICAL
- Complexity tags: <PURE and/or STATEFUL | AUTHORIZATION | ASSET | PROOF | CRYPTOGRAPHIC | INTEGRATION | ORDERING | FAILURE_POLICY | REPRESENTATIVE_CONTEXT>
- Actors and trigger: <who/what starts it>
- Preconditions and domain: <state/inputs>
- Normal outcome: <observable rule/effect>
- Material failure and boundary cases: <partitions>
- State and side effects: <changes/events>
- Authorization/assets: <relevance or none>
- Proof/cryptographic context: <relevance, modes, or none>
- Integration/configuration/ordering context: <relevance or none>
- Business logic: <BL-* or none>
- Source surfaces: <one or more SRC-* and anchors>
- Components/flows: <CMP-*/FLW-*>
- Hypothesis/result: <HYP-* and path or pending>
- Required execution contexts: <named contexts>
- Superseded by: <child BHV IDs and architecture correction job, or not-applicable>
```

One behavior may span many symbols/sites and contain multiple normal/failure/boundary/context test cases. Split independent rules or effects. End with counts proving every scoped file, declared symbol, and detected material anonymous/top-level site is inventoried and dispositioned; list unresolved significance separately. Do not count other AST nodes or all feasible control-flow paths.

## `SPLIT_REQUEST.md`

An investigator writes this job-owned file only when an assigned BHV is not atomic:

```markdown
# Split request — JOB-XXXX
## BHV-XXXX
- Status: OPEN | RESOLVED
- Reason: independently triggerable rules | incompatible oracles | incompatible contexts
- Existing boundary and anchors: <exact record/source>
- Proposed child boundaries: <titles, triggers, observations>
- Distinct oracles and contexts: <why one result cannot decide all>
- Impact and complexity tags: <per proposed child>
- Affected BL/SRC/CMP/FLW IDs: <IDs>
- Resolution: <architecture correction job, child BHV IDs, replacement job IDs, resolution UTC, or pending>
```

It is not a claim and creates no new IDs. The orchestrator marks the parent and dependent jobs stale, starts a fresh targeted architecture correction, marks the parent BHV `SUPERSEDED`, records child and replacement-job links in both directions, marks the preserved request `RESOLVED`, then reinvestigates. Verification may not begin for a parent with an open request; superseded parents are historical and do not require a HYP/result.

## `PROFILE_CORRECTION.md`

Use this for an atomic BHV whose impact, complexity tags, contexts, or job load is wrong:

```markdown
# Profile correction — JOB-XXXX
- Status: OPEN | RESOLVED
- Affected BHV IDs: <IDs>
- Current profile/job: <impact, tags, contexts, job>
- Proposed correction: <exact values and rationale/source anchors>
- Cap/coherence effect: <required repartition>
- Resolution: <architecture correction job, replacement job IDs, resolution UTC, or pending>
```

Preserve the file. A targeted architecture agent updates only its authoritative BHV profiles/jobs and reports the replacement links. After validating those artifacts, the orchestrator transcribes the resolution job, replacement-job IDs, and UTC into the investigator-owned preserved request and marks it `RESOLVED`; the orchestrator also marks any old-profile claims stale in `STATUS.md`. Open requests block affected claims and verification.

### Behavior-boundary matrix

Before the BHV records, include:

```markdown
| Surface/boundary | Kind | Source | BHV | Decision | Rationale |
|---|---|---|---|---|---|
| Treasury.pause | external contract method | SRC-... | BHV-... | DEDICATED | independent authorization and state transition |
```

The matrix includes every externally callable contract method, circuit/program method, public material parsing/validation/serialization/commitment/hash/Merkle API, and independent state transition, authorization decision, asset movement, proof-continuity rule, cryptographic commitment, and material failure policy. Source-surface rows reconcile to the independent raw classification census. `DEDICATED`, `SPLIT`, or `ALIASED` are allowed. `ALIASED` requires identical preconditions, authorization, effects, output, errors, context, and oracle. Split boundaries when they can independently succeed/fail, **or** need different oracles, **or** require different contexts; a shared coarse revert/throw result is not sufficient to merge them. A component or flow name is not a grouping rationale. End with raw-versus-matrix counts by surface kind and mapped/unmapped total; unmapped must be zero.

## Semantic clause and invariant ledger

Every generic census site maps to one or more stable records:

```markdown
| ID | Census/obligation | Kind/category | Source anchor | Parent SRC/BHV | Business basis | Materiality | REV | Trigger | Outcome/invariant | Feasibility | HYP/evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| CL-00001 | CEN-... | IF_TRUE | src/x.ts:L10 | SRC-... / BHV-... | IMPLEMENTATION_DERIVED_RULE | MATERIAL | REV pending | true | state changes | FEASIBLE | pending |
| INV-00001 | OBL-... | AUTHORIZATION | src/x.ts:L10 | SRC-... / BHV-... | IMPLEMENTATION_DERIVED_RULE | MATERIAL | REV pending | unauthorized | no mutation | CANDIDATE | pending |
```

Clause kinds include condition/switch/logical arms; assertion pass/fail; return/yield/throw/reject/catch/finally; loop zero/one/many and exits; mutation; asset/event/external-call effects; authorization/proof/witness/hash/root/commitment decisions; parse/default/fallback; configuration; ordering/replay/duplicate/stale-state; and source-visible numeric/empty/maximum boundaries.

Invariant categories include authorization, asset conservation, state consistency, lifecycle/temporal, uniqueness/replay, proof/public-input continuity, commitment/root/witness binding, arithmetic/range, atomic failure, and output/event consistency.

`Feasibility` is `FEASIBLE`, `INFEASIBLE`, or `DYNAMIC_UNKNOWN`. Final dispositions are `VERIFIED`, `CONTRADICTED`, `UNRESOLVED`, `INFEASIBLE`, or `OUT_OF_SCOPE`. Feasible/dynamic records use named assertions; infeasible uses a deterministic structural check. A proposed exclusion is `UNRESOLVED / OUT_OF_SCOPE_REQUESTED` with a REV item during first consolidation. Only after human approval changes SCOPE, stales/replays work, and a later consolidation validates the new hash may it become `OUT_OF_SCOPE` with SCOPE/REV evidence.

`IMPLEMENTATION_DERIVED_RULE` means source appears to enforce a rule absent from the normative baseline. Record candidate text, intended/expected `UNKNOWN`, `MATERIAL` or `NON_MATERIAL` with rationale, and a REV link for every MATERIAL candidate. It is not authority.

## Clause shards

For an indivisible BHV above a record cap, each `CLAUSE_SHARD` owns disjoint CL/INV IDs and writes `claims/HYP-XXXX/fragments/JOB-XXXX.md`. One fresh `CLAIM_INTEGRATION` job reads all fragments, proves zero overlap/omission and compatible hypothesis/context, and alone writes CLAIM.md. Any correction request blocks integration.

## `SEMANTIC_GAP.md`

```markdown
# Semantic gap — JOB-XXXX
- Status: OPEN | RESOLVED
- Missing/mis-mapped source sites: <anchors and census IDs>
- Required CL/INV records: <kinds, partitions, candidate invariants>
- Affected BHV/SRC/BL/CMP/FLW: <IDs>
- Impact and contexts: <values>
- Resolution: <architecture job, new/replacement IDs/jobs, UTC, or pending>
```

Preserve it. A fresh targeted architecture correction updates the canonical census mapping/ledger/BHVs/jobs. The orchestrator validates and transcribes resolution. Open gaps block affected claims and verification.

## `THREAT_GAP.md`

The threat-model agent writes this when an applicable SEC/THR cannot map to an adequately bounded BHV/INV:

```markdown
# Threat gap — JOB-XXXX
- Status: OPEN | RESOLVED
- Profiles/SEC/THR: <exact IDs>
- Missing or misbounded behavior/invariant: <required semantic boundary>
- Source/architecture anchors: <exact paths/SRC/CMP/FLW>
- Security impact and required context: <values>
- Resolution: <targeted Phase-2 job, replacement BHV/INV/job IDs, rerun threat-model job, UTC, or pending>
```

Preserve it. The orchestrator blocks affected investigation, starts a fresh targeted architecture correction, reruns the threat model against replacement records, validates exact mappings, and transcribes resolution. Open threat gaps block claims, verification, writing, and consolidation.

## `SECURITY_MODEL.md`

Write this after architecture and before investigation. It contains:

- `AST-*` protected assets and unacceptable loss/corruption/disclosure outcomes;
- actors, `TRZ-*` trust zones/boundaries, entry points, and attacker capabilities;
- `ASM-*` environment, dependency, compiler/runtime, cryptographic, deployment, and operational assumptions;
- `OBJ-*` security objectives, including distinct soundness, completeness, privacy, authorization, asset, state-integrity, replay/order, availability, and integration objectives where applicable;
- a complete profile-applicability register covering every profile in `SECURITY_PROFILES.md`;
- one `SEC-*` obligation for every layer and challenge listed by every selected profile;
- stable `THR-*` threat scenarios and exact BHV/INV/source targets;
- bounded attack-synthesis jobs.

```markdown
## THR-0001 — Title
- Attacker goal/capability: <values>
- Assets/objectives: <AST/OBJ IDs>
- Preconditions and assumptions: <values/ASM IDs>
- Steps and crossed trust boundaries: <sequence/TRZ IDs>
- Target behaviors/invariants/source: <BHV/INV/SRC IDs>
- Unacceptable outcome and impact: <value/tier>
- Likelihood or exploitation difficulty: <value/rationale>
- Required context: <runtime/state/proof/integration context>
- Evidence status: UNTESTED | PARTIAL | FALSIFIED | NOT_FALSIFIED_WITHIN_BOUNDS | UNRESOLVED
- ATK mapping: <ATK IDs or pending/unresolved reason>
```

The applicability register uses `APPLICABLE`, `NOT_APPLICABLE`, or `UNCERTAIN` with scope/source rationale; every `APPLICABLE` or `UNCERTAIN` profile is selected. The profile matrix gives each selected layer and each listed challenge a stable SEC ID and `IN_SCOPE`, `NOT_APPLICABLE`, `OUT_OF_SCOPE_REQUESTED`, or `UNRESOLVED` disposition, exact rationale, targets, and evidence/gap. A coarse layer row cannot replace individual challenge obligations. Every SEC, asset, boundary, capability, assumption, objective, unacceptable outcome, and material THR must reconcile to evidence or a visible unresolved/exclusion request.

## Attack hypotheses and results

Each `attacks/ATK-XXXX/ATTACK.md` contains exactly one material composed attack hypothesis:

```markdown
# ATK-0001 — Title
- Status: PROPOSED | FALSIFIED | NOT_FALSIFIED_WITHIN_BOUNDS | UNRESOLVED | STALE
- Threat/objectives/assets/boundaries: <THR/OBJ/AST/TRZ IDs>
- Behaviors/invariants/evidence: <BHV/INV/HYP/RESULT IDs>
- Impact and exploitation difficulty: <values and rationale>
- Required context and assumptions: <exact values>
## Prerequisites and attacker controls
<identities, values, state, ordering, capabilities>
## Exact composed sequence
<multi-step operations and expected intermediate state>
## Security hypothesis and counter-hypothesis
<property being challenged and strongest exploit alternative>
## Decisive oracle
<observable falsification rule>
## Deterministic TypeScript plan
<example/generator/state machine/differential/metamorphic method, seed and bounds>
## Counterexample minimization and preservation
<method/path>
## Limitations
<what the finite/context-bound run cannot establish>
```

`attack.test.mts` and its `RESULT.md` record revision/scope hashes, exact command/context, seeds, repetitions, sequence/depth/input bounds, executed objectives, counterexample and minimization, logs/hashes, and one row per OBJ/INV. Allowed results are:

- `FALSIFIED`: a reproducible counterexample violates the objective;
- `NOT_FALSIFIED_WITHIN_BOUNDS`: the exact finite campaign found none;
- `UNRESOLVED`: context/oracle/infrastructure was insufficient.

Never publish `NOT_FALSIFIED_WITHIN_BOUNDS` as proof of absence. A confirmed remediation retains the original attack harness and counterexample and records fix-replay plus affected HYP/ATK regression results.

## Claims and results

Each `CLAIM.md` contains:

```markdown
# HYP-0001 — Title
- Status: PROPOSED | VERIFIED | CONTRADICTED | UNRESOLVED
- Impact: LOW | MEDIUM | HIGH | CRITICAL
- Complexity tags: <exact authoritative BHV tags>
- Meaningful behavior: <exactly one BHV-*>
- Semantic records: <exact CL-* and INV-* IDs>
- Source surfaces/anchors: <one or more SRC-* and paths/symbols>
- Business logic: <BL-* or none>
- Revision and inspection boundary: <exact values>
- Required TypeScript context: <runtime/config/fixtures/mocks/services/proof mode>

## Intended behavior
<exact BL-* statement or UNKNOWN>
## Expected behavior
<exact sourced expectation/derivation or UNKNOWN|CONFLICTING>
## Implemented-behavior hypothesis
<one atomic rule/effect>
## Counter-hypothesis
<strongest plausible alternative>
## Cases and input/state partitions
<normal, failure, boundary, permission, state, context cases of this rule>
## Per-record assertion plan
| CL/INV | Test/assertion name | Trigger/input/state | Decisive observable | Expected result | Required context | Feasibility |
|---|---|---|---|---|---|---|
## Decisive observation and TypeScript oracle
<independent pass/fail rule and provenance>
## Counterexample plan
<required for HIGH/CRITICAL, otherwise NOT_REQUIRED>
## Risks, coverage targets, and limitations
<material items>
```

`verify.test.mts` may contain multiple cases for that single behavior. It must mechanically fail when the counter-hypothesis is observed and must assert an observable result or independent invariant.

`RESULT.md` records BHV/HYP, classification, expected alignment, revision/scope before and after, verifier/log hashes, exact command/cwd/context, exit/timeout, seeds/repetitions/threshold, counterexamples, oracle, observation, limitations, and:

```markdown
| CL/INV | Evidence type | Assertion/check | Executed/skipped | Observation | Disposition | Evidence/log or SCOPE/REV anchor |
|---|---|---|---|---|---|---|
```

- `VERIFIED`: assertions executed and passed without skips, required context ran, and source/scope stayed fixed.
- `CONTRADICTED`: decisive observation supports the counter-hypothesis.
- `UNRESOLVED`: unavailable/weak context, infrastructure failure, timeout, flake, skip, mutation, or non-decisive oracle.

Expected alignment is separately `MATCHES_EXPECTED`, `DEVIATES_FROM_EXPECTED`, `EXPECTATION_UNKNOWN`, or `UNRESOLVED`.

## Architecture and diagrams

`ARCHITECTURE.md` describes actors, components (`CMP-*`), interfaces, dependencies, trust boundaries, state, and flows (`FLW-*`), maps BL/SRC/BHV items, and assigns one publication slug per component/flow. Mark unverified semantic relationships provisional.

Canonical Mermaid lives in `.mmd`. Its sibling `.trace.md` records revision, diagram hash/status, stable elements, and BL/BHV/HYP/THR/ATK links. Required views are system context, components/trust boundaries, materially stateful elements, meaningful flows, and material attack paths. Diagrams summarize; they are not evidence.

## Risks, coverage, and specifications

`RISKS.md` contains `RSK-*` records with category, affected AST/TRZ/OBJ/THR/ATK/BHV/INV IDs, prerequisites, exploit scenario, impact, likelihood/exploitation difficulty, evidence status, remediation, regression-test identity, limitations, and next action.

`COVERAGE.md` is organized by BL, BHV, component, flow, and applicable meaningful dimensions: normal/failure/boundary, state/postconditions, authorization/assets, side effects/events, configuration/order/retry, dependencies/integration, proof/cryptography/security, limits, and representative-context fidelity. Link cells to HYP results or unresolved reasons. Include source-accountability counts separately; do not create behavioral coverage cells for every helper.

`SPECIFICATION.md` is the one-file reader edition:

1. Scope and revision
2. Business context and authorities
3. Intended behavior
4. Expected behavior
5. Implemented behavior and Mermaid diagrams
6. Intended/expected/implemented alignment
7. Components, flows, state, and invariants
8. Errors, side effects, and material boundaries
9. Threat model, security-relevant behavior, and attack chains
10. Risks and residual uncertainty
11. Coverage and execution contexts
12. Deviations and conflicts
13. Contradicted hypotheses
14. Unresolved, stale, and excluded subjects
15. Human review and reconciliation
16. Source accountability index

Every implemented factual statement links to BHV/HYP evidence. Section 16 compactly maps every SRC-* to significance, parent behavior, and rationale. Before review, Section 15 contains PENDING and one empty HUMAN_REVIEW marker region.

`publication/` is a portable Markdown book organized by overview, components, flows, findings, review, coverage, evidence, and glossary. `SUMMARY.md` is navigation. `MANIFEST.md` maps pages to revision, IDs, diagram hashes, and page hashes. Use only relative internal links. Embed relevant canonical Mermaid text. Keep the book and single-file edition semantically aligned.

## Human review

`REVIEW_PACKET.md` is generated after writing and validated by consolidation. It contains REV items for material deviations/unknowns/risks/contradictions, unresolved behavior/threat/assumption/profile/context/coverage/significance, every MATERIAL IMPLEMENTATION_DERIVED_RULE, every material FALSIFIED or UNRESOLVED ATK, material unresolved CL/INV, and carry-over. Each item includes IDs, evidence, impact, exploit scenario where applicable, question, dispositions, follow-up, and batch template.

`HUMAN_REVIEW.md` records only decisions received directly from an identifiable human: timestamp/channel digest, exact reviewed packet and consolidation hashes, one disposition/rationale/follow-up per REV, publication permission, and final `APPROVED`, `CHANGES_REQUIRED`, or `INCOMPLETE`. Preserve rounds. Agents cannot approve or simulate this record.

Allowed item dispositions: `CONFIRMED`, `INTENT_CORRECTED`, `EXPECTATION_CORRECTED`, `IMPLEMENTATION_ACCEPTED`, `DEFECT_CONFIRMED`, `MORE_EVIDENCE_REQUIRED`, `OUT_OF_SCOPE`, `UNRESOLVED`.

Corrections, evidence requests, or scope changes stale affected work and require automated replay, a new consolidation, and later review. Scope changes stale all results bound to the prior scope hash. After approval, only reserved review regions and manifest hashes may change; mechanically validate links, parity, page hashes, and technical-content immutability.

## Consolidation

`CONSOLIDATION.md` records revision/scope and source-hash validation; inventory raw-output and symbol reconciliation; artifact validation for every atomic and attack harness/result (harness, command, raw logs, exit/timeout, hashes, context, seeds/bounds, per-record rows); security-model reconciliation; selected-profile coverage; THR-to-ATK mapping; published-fact evidence checks; behavior-layer separation; deviations; high-impact counterexamples; context fidelity; risks/coverage; diagram parity; publication links/manifest/edition parity; review-queue completeness; safety; exact failures/actions; completed packet hash; and status `READY_FOR_HUMAN_REVIEW`, `READY_WITH_UNRESOLVED`, or `FAIL`.

Consolidation never executes inventory programs, target code, atomic verifiers, attack verifiers, or proof work. Missing, partial, stale, or inconsistent evidence is an upstream execution blocker: name the exact fresh job required, do not repair or rerun it inside consolidation. `replay/` may contain only mechanical reconciliation/hash/link reports and preserved prior consolidation rounds; it is not an execution log directory for the consolidator.

Resume from `STATUS.md`, not chat.
