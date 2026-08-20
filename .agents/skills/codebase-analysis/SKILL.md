---
name: codebase-analysis
description: Perform a strictly read-only two-pass analysis of an entire repository or bounded scope, combining source/tests with RFCs, prior audits, policies, and discussions to produce an accurate author-facing YAML model and Markdown/Mermaid overview of requirements, business logic, implementation, architecture, flows, clauses, invariants, I/O, relationships, smart-contract/ZK properties, and business or implementation gaps. Use for codebase comprehension, requirement traceability, specification consolidation, quality review, or assurance planning without executing target code, tests, verifiers, or proofs.
---

# Codebase analysis

Build a revision-specific static model of a codebase in two mandatory passes. Pass 1 discovers local facts; Pass 2 reinterprets every semantic conclusion using the complete synthesized system context and user-supplied background evidence. Treat the normalized YAML model as authoritative and Markdown as a reader-facing projection. Support whole-repository waves and focused path/symbol scopes without implying coverage beyond the recorded boundary.

Read [ARTIFACTS.md](references/ARTIFACTS.md), [GOVERNANCE-ZK-REVIEW.md](references/GOVERNANCE-ZK-REVIEW.md), and [STE-STYLE.md](references/STE-STYLE.md) completely before creating or resuming every run. The governance reference defines the mandatory zkSecurity-inspired review method for all code; apply its protocol reconstruction, threat/assumption modelling, local/composed review, failure-class challenge, and root-cause reporting even when the scope is not blockchain or ZK. The STE reference defines the required style for author-facing YAML prose and Markdown. Read [METHOD.md](references/METHOD.md) when choosing additional general analysis techniques.

## Inputs and operation

Require a repository-relative scope or an existing `.codebase-analysis/<scope-slug>/` run root.

- **Create:** pin revision and create a new run.
- **Resume:** continue from `STATUS.yaml`; never reconstruct state from chat.
- **Refresh:** recompute only units affected by source/test/configuration changes, then rebuild dependent flows and publications.
- **Validate:** check model/schema/source-accountability/publication parity without changing semantic conclusions.

Use repository-installed TypeScript tooling for deterministic read-only utilities. Do not use Python or create Python artifacts. Do not add dependencies or execute application, test, proof, build, generation, migration, or formatting behavior. This skill never changes from static read-only mode; runtime validation belongs to a separate workflow and separate user request. Static test analysis does not mean tests passed.

Never create or run per-claim TypeScript verifiers, `verify.test.mts`, repository test commands, proof compilation/generation/verification, local chains, or target-module imports. Never set `PROOFS_ENABLED`, including to false: this pipeline does not execute proof-related code in either mode. The bundled TypeScript integrity scripts may read bytes, YAML, and Markdown only; they validate artifact structure/hashes and are not behavioral verifiers.

Invoke with `$codebase-analysis .` for the whole repository, `$codebase-analysis <path-or-symbol>` for a bounded scope, or `$codebase-analysis .codebase-analysis/<scope-slug>` to resume. Report the run-root path immediately after Phase 0. At completion, link `model/codebase.yaml`, `publication/SPECIFICATION.md`, `publication/SUMMARY.md`, and `STATUS.yaml`, and state exact coverage/unresolved counts.

## Absolute read-only boundary

Target source, tests, configuration, documentation, and user-supplied context are immutable inputs. Under no condition may any agent edit, format, generate into, rename, delete, restore, stage, or otherwise touch them. The only permitted repository write root is the current `.codebase-analysis/<scope-slug>/` run root. Temporary analysis data may use an isolated temporary directory, never a target directory.

- Do not invoke formatters, fix modes, generators, migrations, installers, builds, application code, tests, proof systems, or compilers that may emit caches/artifacts beside inputs.
- Use read-only compiler APIs and commands. TypeScript utilities must declare and enforce their output path under the run root.
- Record every primary and context input hash before analysis and recheck before and after every phase. On any mismatch, stop as `SOURCE_CHANGED`; do not revert, overwrite, or “repair” the file.
- Inspect existing worktree changes read-only and preserve them. A pre-existing dirty file is still immutable and is pinned by its byte hash.
- Workers may write only their assigned bundle below the run root. The orchestrator may write only run-root control/model/publication artifacts.

## Epistemic model

Keep these evidence classes separate on every behavior, rule, clause, invariant, and finding:

- `DOCUMENTED_INTENT`: explicitly stated product, policy, interface, comment, or design objective;
- `TEST_EXPECTATION`: outcome encoded by a test or fixture;
- `IMPLEMENTED_STATIC`: behavior supported by source/compiler facts;
- `INFERRED_BUSINESS_RULE`: domain rule inferred from implementation or tests but not authoritative;
- `EXTERNAL_STANDARD`: vocabulary or review criterion, never repository fact;
- `UNRESOLVED`: insufficient, conflicting, dynamic, generated, native, or external evidence.

Record confidence as `HIGH`, `MEDIUM`, or `LOW` with rationale. Do not promote comments or tests to intended authority. Do not state that runtime behavior, cryptographic soundness, or a test pass has been proven by static analysis.

## Canonical record types

Maintain stable IDs in `model/codebase.yaml`:

- `PKG-*` package/application boundaries;
- `REQ-*` atomic requirements from RFCs, policies, decisions, specifications, and authoritative discussions;
- `BR-*` business rules, goals, permissions, and lifecycle policies;
- `CMP-*` components and deployable/runtime units;
- `SRC-*` files, symbols, material callbacks, configuration, schemas, and generated boundaries;
- `API-*` public/internal interfaces and callable surfaces;
- `BHV-*` meaningful behaviors and business rules;
- `FLW-*` end-to-end and cross-component flows;
- `CL-*` semantic clauses and outcomes;
- `INV-*` explicit or candidate invariants;
- `IO-*` inputs, outputs, formats, validation, trust, and sensitivity;
- `REL-*` calls, reads, writes, emits, authorizes, proves, verifies, derives, serializes, or depends-on edges;
- `TST-*` test suites/cases/fixtures and their target mappings;
- `FND-*` static quality, correctness, maintainability, or security observations;
- `SEC-*` protected security/correctness objectives and their enforcement surfaces;
- `THR-*` threat, misuse, failure-composition, and adverse-state hypotheses;
- `ASM-*` trust, environment, deployment, dependency, protocol, and operational assumptions;
- `GAP-*` business-logic, requirement, implementation, expectation, operational-trust, and audit-drift gaps;
- `UNR-*` unresolved boundaries and required follow-up;
- `EVD-*` source/test/document/compiler evidence;
- `ZKP-*` zero-knowledge statements, programs, proof-composition boundaries, and host/constraint bindings when applicable.

## Static analysis obligations

For every scoped file and relevant test/configuration artifact:

1. Inventory declarations, exports, imports, callables, state, schemas, public APIs, tests, fixtures, and material anonymous/top-level execution sites.
2. Identify actors, roles, domain entities, goals, permissions, assets, state transitions, lifecycle stages, failure policies, and business decisions.
3. Record inputs, outputs, validation/defaulting, serialization, errors, side effects, persistence, events, external calls, and trust boundaries.
4. Enumerate semantic clauses for branches, assertion pass/fail, switch/conditional/logical outcomes, returns/throws/catches, loop partitions and exits, mutation/effect sites, configuration branches, ordering/replay behavior, and source-visible boundary cases.
5. Derive invariant candidates for authorization, conservation, state consistency, lifecycle/order, uniqueness/replay, idempotency, atomic failure, input/output consistency, arithmetic/range, serialization, resource bounds, and dependency assumptions.
6. Build call, data, ownership, state, and test-to-behavior relationships. Represent static data paths as `may_flow`; identify sources, transforms, barriers, and sinks without claiming runtime reachability.
7. Map tests to behaviors, clauses, invariants, and fixtures. Record gaps, contradictions, overly coupled fixtures, and untested static partitions. Tests remain expectation/static evidence unless separately executed.
8. Classify every scoped source record as `MEANINGFUL`, `SUPPORTING`, `INERT_OR_TYPE_ONLY`, `GENERATED`, `OUT_OF_SCOPE`, or `UNRESOLVED_SIGNIFICANCE` with rationale and parent links.
9. Atomize applicable RFC/policy/audit requirements and build a requirement-to-business-rule/implementation/test matrix. Preserve maturity, rollout stage, authority, optionality, and unresolved decisions.
10. Identify business and implementation gaps without conflating them with security findings. Record consequence, affected actors/assets, evidence, rollout relevance, and a neutral author question.
11. Apply the mandatory zkSecurity-inspired method to reconstruct the system before judging local code: enumerate protected assets/objectives, actors, entry points, trust zones, privileges, assumptions, adverse states, and local plus composed failure hypotheses; map each to exact source, behavior, clause, invariant, flow, and test records.
12. Challenge known failure classes appropriate to the domain, including missing checks/bindings, state-machine errors, unsafe defaults, authorization confusion, incomplete failure handling, replay/uniqueness, arithmetic/encoding, concurrency/order, dependency/configuration, and liveness. Record a disposition and rationale for every applicable class; do not convert absence of static evidence into a safety claim.

Avoid path explosion. Preserve every statically visible semantic outcome, but group related clauses beneath one reader-facing behavior when they implement one coherent rule. Split behaviors when authorization, state transitions, assets, proof rules, externally visible outcomes, failure policies, or required oracles are independent.

## Blockchain and zero-knowledge extension

Apply only where relevant, but record applicability explicitly.

- Model accounts, addresses/identities, tokens/assets, balances, permissions, privileged roles, state preconditions/postconditions, events, cross-contract calls, transaction atomicity, upgrade/configuration authority, ordering, replay, finality, and off-chain dependencies.
- For smart-contract methods, map caller/authorization, account/state reads, constrained preconditions, writes, emitted events, asset effects, failure paths, and proof/signature requirements.
- For zero-knowledge code, model the statement, public inputs/outputs, private witnesses, constraint-producing operations, host-language-only computation, ranges/canonical encodings, hashes/commitments, roots/witnesses, recursive proof continuity, verification-key/configuration assumptions, prover/verifier boundaries, and proof-enabled/disabled differences visible in source/configuration.
- Record each candidate invariant as static evidence only. Underconstraint, overconstraint, cryptographic security, and representative integration remain `UNRESOLVED` unless separate assurance work establishes them.
- Apply the whole-protocol review in `GOVERNANCE-ZK-REVIEW.md`: explain each proof statement in pseudocode, then map public/private values, constraints, host computation, recursive continuity, verifier/state effects, initial-state assumptions, ranges/encodings, uniqueness/replay, configuration, and liveness. Do not execute a verifier.

## Orchestration and parallelism

The root agent is the sole orchestrator and canonical-model owner. Count it toward a hard maximum of four active local agents; therefore run at most three workers concurrently. Workers are fresh, do not delegate, never edit `model/codebase.yaml`, and write only assigned evidence bundles.

Allocate durable IDs only in the orchestrator. Each proposal carries a `stable_key` formed as `<record-kind>:<primary-owner-stable-key>:<canonical-symbol-or-semantic-slug>`, normalized to lowercase NFC text with repository-relative `/` paths. Set the ID to `<PREFIX>-<first 10 uppercase hexadecimal characters of SHA-256(stable_key)>`; extend the digest only on collision. Never allocate IDs by merge order.

Choose the smallest useful topology:

```yaml
topology:
  small_scope:
    criteria: "one cohesive component and context fits comfortably in one agent"
    workers: 0-1
  medium_scope:
    criteria: "several components or distinct implementation/test concerns"
    workers: 2
  large_or_whole_repo:
    criteria: "multiple packages, bounded contexts, or cross-system flows"
    workers: 3
  hard_max_active_agents_including_orchestrator: 4
```

Prefer one coherent agent over artificial partitioning. Parallelize only disjoint evidence ownership or orthogonal views. The root agent remains the persistent context keeper across both passes. Use waves:

### Phase 0 — pin, context intake, and partition

The orchestrator writes `SCOPE.yaml`, `STATUS.yaml`, and `READ_ONLY_GUARD.yaml`; identifies languages/tooling; determines repository closure; and creates bounded work-unit YAML files. Register every user-supplied RFC, prior audit, design note, forum discussion, policy, or decision record as immutable context with hash, date, provenance, authority level, and applicability. Whole-repository units normally follow package/application boundaries; focused units follow requested symbols/paths plus necessary static dependency context. Use the deterministic slug, scope-hash, and closure rules in `ARTIFACTS.md`.

### Pass 1 / Phase 1 — reconnaissance wave

Run up to three roles concurrently when useful:

1. [business-analyst.toml](agents/business-analyst.toml): primary ownership of documents/policies; tests are read-only expectation context;
2. [inventory-analyst.toml](agents/inventory-analyst.toml): primary ownership of raw source/test/configuration inventory and dependency graph;
3. [platform-analyst.toml](agents/platform-analyst.toml): semantic ownership of build/runtime/deployment and blockchain/ZK interpretations; configuration/source are read-only context.

They must not share primary ownership. The orchestrator serially validates and merges their proposed YAML patches.

### Pass 1 / Phase 2 — local semantic waves

After inventory exists, dispatch [semantic-analyst.toml](agents/semantic-analyst.toml) across up to three disjoint components/work units. Each worker receives the exact model slice, exact source/tests, and neighboring interfaces required for context. It proposes BHV/FLW/CL/INV/IO/REL/TST/FND/UNR records.

For a large repository, merge each wave before dispatching the next. Analyze both endpoints before assigning an integration flow. Never give several workers ownership of the same canonical record. The source component owns outgoing `CALLS`/`MAY_FLOW_TO`; the state/data owner owns `READS`/`WRITES`; the orchestrator owns cross-component `FLW-*` and relationship deduplication.

### Pass 1 / Phase 3 — preliminary cross-flow and challenge

Dispatch [quality-challenger.toml](agents/quality-challenger.toml) to disjoint high-impact flows, invariant groups, public APIs, or unresolved clusters. In the same bounded wave, assign [security-reviewer.toml](agents/security-reviewer.toml) mandatory ownership of the preliminary protocol overview, security objectives, assumptions, trust zones, threat hypotheses, and known-failure-class matrix. These views may run concurrently only when their record ownership is disjoint. They append evidence; they do not rewrite earlier bundles.

### Bridge / Phase 4 — immutable Pass-1 snapshot and global context synthesis

The orchestrator validates and freezes `model/pass-1.yaml`. It then writes `model/context.yaml`, a compact but complete context pack derived from Pass 1 plus user-supplied evidence. It must contain scope/revision hashes; product mission; domain glossary; actors/roles/assets; authority map; component/API map; lifecycle/state model; principal flows; global invariants; security objectives; threat model; explicit assumptions; trust and deployment boundaries; blockchain/ZK model; test strategy; decisions; conflicts; unresolved questions; and a component-to-context index. Every summary statement cites canonical Pass-1 IDs and evidence. Preserve competing interpretations rather than selecting one silently.

This bridge is the antidote to isolated-worker assumptions: every Pass-2 worker receives the complete context pack, not merely a local excerpt, plus its raw local evidence. Keep the context pack concise enough to fit every worker while retaining IDs and pointers to detailed records.

### Pass 2 / Phase 5 — context-informed reinterpretation

Dispatch [contextual-reviewer.toml](agents/contextual-reviewer.toml) over disjoint semantic record groups. Each fresh worker receives:

1. complete `model/context.yaml`;
2. all applicable user-supplied context inputs, or faithful hashed extracts with direct source pointers when an input is too large;
3. its assigned Pass-1 records and evidence;
4. exact source/tests and neighboring interfaces.

Every current Pass-1 `REQ/BR/CMP/API/BHV/FLW/CL/INV/IO/REL/TST/FND/SEC/THR/ASM/GAP/UNR/ZKP` record receives exactly one contextual disposition: `CONFIRMED`, `REFINED`, `CONTRADICTED`, or `UNRESOLVED`. The review identifies assumptions added/removed, business rationale, global consequences, conflicting evidence, and replacements. No record may reach final publication solely from Pass 1.

### Pass 2 / Phase 6 — integration and adversarial context challenge

After component reinterpretation is merged, run up to three orthogonal reviews when useful: system/business coherence, QA/static completeness, and security/trust coherence. The security review is mandatory and uses [security-reviewer.toml](agents/security-reviewer.toml) with the complete context pack and full merged Pass-2 summary. It rechecks every material objective/threat/assumption across component boundaries, compares local enforcement with whole-system effects, applies the known-failure-class matrix, and challenges finding severity, prerequisites, root cause, impact, and limitations. The root resolves overlaps serially and preserves dissent as explicit conflicts.

### Phase 7 — consolidate and publish

The orchestrator alone reconciles conflicts, assigns final IDs/status/confidence, validates two-pass coverage, requirements/gaps, source accountability, read-only hashes, and graph integrity, and writes Markdown publications plus `MANIFEST.yaml`. Do not use a separate writer that lacks the canonical merge context. Publication must distinguish Pass-1 observation from Pass-2 contextual conclusion wherever the disposition is not `CONFIRMED`. Use the required STE style for all author-facing YAML prose and Markdown. Preserve exact technical terms, identifiers, schema values, evidence, and quotations. Optimize the Markdown for author comprehension: one-page summary, glossary, narrative plus diagrams, consistent component tables, traceability matrix, prioritized gap register, and consolidated author questions.

After publication validation succeeds, the user may preview the Markdown from the repository root with `node .agents/skills/codebase-analysis/scripts/preview-publication.mts .codebase-analysis/<scope-slug>/publication`. The preview utility is read-only, serves only generated Markdown on `127.0.0.1`, and does not import or execute analyzed source. VS Code **Markdown: Open Preview** remains the offline Mermaid-capable alternative.

## Context-preservation rules

- Durable YAML, not chat, is the handoff surface.
- Pass-1 workers receive `SCOPE.yaml`, their work unit, relevant source/test paths, applicable user context, and their role contract. Pass-2 workers additionally receive the complete context pack and exact Pass-1 slice.
- Every evidence bundle states revision, scope hash, owned IDs/paths, source hashes, assumptions, unresolved context, and proposed model patch.
- Shared dependencies are `READ_ONLY_CONTEXT`; one work unit remains primary owner.
- Conflicting bundles are both preserved and become a `UNR-*` conflict until a fresh bounded challenge resolves or records it.
- Hash changes stale only affected units and dependent flows.
- Never compress away conflicts, authority level, assumptions, or unresolved questions from the context pack. Summaries orient reasoning but never replace raw evidence.
- Run the bundled TypeScript validator after every canonical merge and final publication. A missing installed YAML parser is a preflight blocker; do not add a dependency silently.
- Run `scripts/validate-skill.test.mts` before first use after changing the skill. Run `scripts/validate-run.test.mts` with `CODEBASE_ANALYSIS_RUN` set to the run root using an already-installed TypeScript loader. Record that exact command in `MANIFEST.yaml`; never substitute a Python validator.

## Completion gates

Finish only when:

- every scoped file and material source/test/configuration surface has one significance disposition;
- the immutable Pass-1 snapshot and complete global context pack are hash-bound in the manifest;
- every current semantic record has exactly one Pass-2 contextual disposition and review evidence;
- every user-supplied context input is hashed, authority-classified, applicability-mapped, and represented or explicitly unresolved;
- public APIs, component boundaries, material behaviors, flows, clauses, invariants, inputs/outputs, relationships, and test mappings are accounted for or explicitly unresolved;
- every applicable external requirement and supplied audit item is authority/scope/version classified and traced to implementation/tests, a justified non-applicable/deferred status, or a visible gap;
- every material business/implementation divergence is represented in the gap register and author review checklist;
- whole-repository and scoped coverage claims match the actual closure boundary;
- intended, test-expected, implemented-static, inferred, and unresolved facts remain distinguishable;
- every Markdown statement and Mermaid node/edge links to canonical YAML IDs and evidence;
- the mandatory security review accounts for every protected objective, material threat, explicit assumption, applicable known-failure class, and composed boundary, with no unreviewed security record;
- every current finding states category, severity, confidence, exploit/failure prerequisites, root cause, impact, recommendation, scope limitation, and links to applicable objectives/threats/assumptions or an explicit no-link rationale;
- diagrams, component/flow pages, threat model, assumptions/limits, security review, static findings, test map, unresolved register, and YAML model agree;
- the author-facing publication style check reports no unapproved STE-style issue;
- `MANIFEST.yaml` records hashes and validation results;
- target source and tests remain unchanged.
- every primary/context input hash still matches `READ_ONLY_GUARD.yaml`; otherwise the run stops without publication.

The output is a high-quality static understanding baseline for later testing and business-logic consolidation. It is not a runtime verification, formal proof, penetration test, or certification.
