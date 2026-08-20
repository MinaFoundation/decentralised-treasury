---
name: audit-spec
description: Create, resume, validate, or review a threat-model-driven repository security specification. Separates intended, expected, and implemented behavior; exhaustively accounts for statically discoverable business/security semantics; deterministically verifies atomic properties and composed attack chains in TypeScript; and presents one human-review checklist after consolidation.
---

# Audit specification

Build a revision-specific specification of behavior that matters to users, operators, assets, authorization, state, integrations, and security. Chat orchestrates fresh specialist agents; `.audit-spec/<scope-slug>/` is the durable record.

Read [ARTIFACTS.md](references/ARTIFACTS.md) completely before creating or resuming a run. For security-sensitive scope, read all of [SECURITY_PROFILES.md](references/SECURITY_PROFILES.md), record an applicability decision and rationale for every profile in `SCOPE.md`, and select every applicable or uncertain profile.

## Input and operation

Require one repository-relative source scope or existing `.audit-spec/<scope-slug>/` directory.

- **Create:** start at Phase 0 when no run exists.
- **Resume:** continue from the latest valid checkpoint in `STATUS.md`.
- **Validate:** explicitly dispatch fresh inventory/verifier work, then run artifact-only consolidation without adding claims. Validation re-execution is separate from consolidation and happens only when requested or required by stale evidence.
- **Review:** finish automated consolidation, then present the Phase 9 human checklist.

## What is in specification scope

A **meaningful behavior** is an observable rule or outcome that affects at least one of:

- user, operator, or external-system output, error, or decision;
- persistent, on-chain, or lifecycle state;
- authorization, permissions, roles, assets, funds, or tokens;
- proof constraints, public inputs/outputs, or cryptographic operations;
- a business or security invariant;
- a component or trust-boundary interaction;
- an event or externally visible side effect;
- ordering, replay, concurrency, retry, configuration, or environment behavior;
- a material failure, boundary case, or recovery path.

Private helpers and mechanical transformations do not receive separate claims unless they independently create or mediate one of these effects. Every executable helper must link to a parent meaningful behavior or remain `UNRESOLVED_SIGNIFICANCE`; only mechanically non-executable declarations or inert data may use `NO_OBSERVABLE_BEHAVIOR`.

This workflow aims for complete accounting, not path explosion. It inventories every scoped source file, declared symbol, and anonymous or top-level executable site carrying a material-effect indicator, then assigns each record exactly one significance disposition:

- `BEHAVIOR`: implements one or more meaningful `BHV-*` records;
- `SUPPORTING_IMPLEMENTATION`: supports a named meaningful behavior;
- `NO_OBSERVABLE_BEHAVIOR`: mechanically non-executable type/declaration or inert data without calls, mutation, or initialization effects;
- `UNRESOLVED_SIGNIFICANCE`: significance could not be decided and must enter human review;
- `OUT_OF_SCOPE`: excluded by the recorded scope.

Do not enumerate irrelevant AST nodes or claim exploration of infinite inputs/schedules. Do exhaustively enumerate every statically discoverable executable decision/effect and its semantic outcomes. Several clauses may implement one reader-facing behavior, and one verifier may cover related clauses only when it reports a decisive result for each.

### Exhaustive security-semantic layer

Under the reader-facing `BHV-*` layer, maintain:

- `CL-*` for every semantic clause/outcome;
- `INV-*` for every explicit or candidate invariant.

The TypeScript compiler-API inventory must create clauses for every:

- `if`/`else`, switch case/default, conditional expression, and logical short-circuit outcome;
- assertion/precondition and its pass/fail outcome;
- return/yield/throw/reject and try/catch/finally outcome;
- loop zero/one/many partition plus break/continue/early-exit behavior;
- state mutation, asset movement, event, external/cross-contract call, authorization decision, proof verification, witness/commitment/root/hash transition, and configuration branch;
- parsing/serialization/default/fallback behavior and numeric/range/empty/maximum boundary visible in source;
- ordering/replay/duplicate/stale-state/concurrency interaction indicated by state or source semantics.

Generate `INV-*` candidates for authorization, conservation/assets, state consistency, lifecycle/temporal order, uniqueness/replay, proof/public-input continuity, commitment/root/witness binding, arithmetic/range, atomic failure, and output/event consistency wherever applicable. Source assertions are candidates, not proof that the invariant holds.

Every clause/invariant maps to exactly one active BHV and HYP, and ends `VERIFIED`, `CONTRADICTED`, `UNRESOLVED`, `INFEASIBLE`, or `OUT_OF_SCOPE`. Feasible records need a named assertion/result; `INFEASIBLE` needs deterministic structural proof. Before human review, a proposed exclusion remains `UNRESOLVED` with `OUT_OF_SCOPE_REQUESTED` and a REV item. It becomes `OUT_OF_SCOPE` only after human approval, scope update, replay, and later consolidation. Coverage/reachability alone is insufficient.

Every BHV/CL/INV also maps to a normative `BL-*` or an explicit `IMPLEMENTATION_DERIVED_RULE` candidate whose intended and expected behavior remain `UNKNOWN`. Source-derived rules are never silently promoted to intended business logic; material candidates enter final human review for confirmation, correction, or defect classification.

Exhaustive means complete accounting of static semantic decisions and declared partitions—not proof over an infinite state space. Dynamic loading, reflection, native/dependency internals, external services, unbounded values, and unmodeled schedules become explicit `UNRESOLVED` records rather than omissions.

### Threat-driven assurance layer

Static completeness and security completeness are different. Preserve the exhaustive BHV/CL/INV ledger, then independently build a threat model and try to falsify its security objectives through composed behavior sequences.

The threat model identifies protected assets, actors, trust zones, attacker capabilities, entry points, security objectives, unacceptable outcomes, environmental/dependency assumptions, and scope limitations. Maintain a profile-applicability register for every available profile. For every selected profile, create one `SEC-*` obligation for each listed layer and challenge; map each to THR/ATK/evidence, or record `NOT_APPLICABLE`/`UNRESOLVED` with exact rationale. A coarse profile or layer row cannot close its individual challenges.

After atomic verification, synthesize cross-behavior `ATK-*` hypotheses covering applicable ordering, replay, identity/account aliasing, stale state, partial failure, privilege escalation, asset imbalance, commitment/public-input mismatch, proof-composition discontinuity, integration mismatch, and multi-step state-machine abuse. Historical vulnerability corpora and reputable security guidance may orient attack classes, but are neither repository evidence nor intended authority.

Each material attack hypothesis needs a separate deterministic TypeScript falsification harness, fixed seed/configuration, exact operation sequence or generator boundary, decisive security oracle, minimized counterexample when found, and explicit context limitations. Include stateful, generative, differential, or metamorphic testing where the threat requires it. A finite campaign provides evidence only for the recorded campaign; it does not prove an unbounded property.

### Behavior decomposition boundary

Do not compress a component into a single omnibus behavior. Apply these minimum semantic boundaries:

- every externally callable contract method and every circuit/program method maps to at least one dedicated `BHV-*`;
- every public pure API with a material output or error contract—such as parsing, commitment encoding, hashing, witness/root calculation, validation, or serialization—maps to a dedicated behavior unless it is a true alias;
- split state transitions, authorization decisions, asset movements, proof-continuity rules, cryptographic commitments, and material failure policies when they can succeed/fail independently, need different oracles, or require different execution contexts;
- several entry points may share a BHV only when they are demonstrable aliases with the same preconditions, authorization, state effects, outputs, failures, and oracle. Record the rationale;
- several checks inside one entry point may stay together when they jointly enforce one indivisible externally observable rule under one oracle/context.

The architecture pass must publish a behavior-boundary matrix mapping each external/program/public-material API and each independent security/state boundary to its `BHV-*`. Consolidation rejects an omnibus BHV that crosses these boundaries without an alias or indivisibility rationale.

### Complexity-preserving tasks

Every `BHV-*` records complexity tags from `PURE`, `STATEFUL`, `AUTHORIZATION`, `ASSET`, `PROOF`, `CRYPTOGRAPHIC`, `INTEGRATION`, `ORDERING`, `FAILURE_POLICY`, and `REPRESENTATIVE_CONTEXT`, plus required contexts and an impact tier. Generated jobs list exact BHV IDs; agents never infer ownership from a component or path glob.

- A standard investigation job owns at most six `PURE` BHVs.
- A job owns at most three BHVs when any is `HIGH`/`CRITICAL` or tagged `STATEFUL`, `AUTHORIZATION`, `ASSET`, `PROOF`, `INTEGRATION`, or `REPRESENTATIVE_CONTEXT`.
- Split further when the named sources, contexts, or oracles do not fit comfortably in one fresh-agent context.
- Verification remains one fresh verifier per HYP, regardless of investigation grouping.

These are maximums, not fill targets. The job preserves each owned BHV's boundary type, impact, tags, source anchors, required contexts, and expected output paths.

## Non-negotiable rules

1. The main agent is the sole orchestrator. Start every specialist as a new `default` agent with no inherited conversation and the exact role, job, artifact, source, and evidence inputs it needs. Specialists do not delegate.
2. Run business-logic analysis before reading implementation architecture. Keep **intended**, **expected**, and **implemented** behavior separate:
   - intended: explicitly authorized goal or rule, otherwise `UNKNOWN`;
   - expected: predeclared observable outcome derived from a named authority, public contract, policy, or test, otherwise `UNKNOWN` or `CONFLICTING`;
   - implemented: behavior observed at the pinned revision, publishable only after deterministic TypeScript verification.
3. Treat implementation statements from inspection or reasoning as hypotheses. Documentation, source inspection, existing tests, diagrams, and agent agreement are not implementation proof.
4. Create one atomic `HYP-*` per meaningful `BHV-*`. A claim may cover multiple source symbols and the normal, failure, boundary, and context partitions of the same rule, but must split independent rules or outcomes.
5. Every `HYP-*` needs a saved `verify.test.mts`, decisive oracle, exact command, raw output, and `RESULT.md`. The consolidator validates the saved harness, command, raw output, hashes, execution metadata, and per-record result without executing it.
6. A passing TypeScript run with executed assertions, no failures/skips, the required context, and unchanged source promotes the hypothesis to `VERIFIED`. A decisive observation of its counter-hypothesis makes it `CONTRADICTED`. Infrastructure failure, missing context, timeout, flake, skip, or weak oracle is `UNRESOLVED`.
7. Verification must observe the claimed rule or effect. Mere line, symbol, or branch reachability is insufficient.
8. Record the exact runtime, configuration, fixtures, mocks, services, proof mode, isolation, and input/state boundaries that ran. Do not generalize beyond them. When a security property depends on a representative execution context, a weaker context cannot verify it.
9. Use only the repository's installed TypeScript runtime, runner, and dependencies for executable audit work. Every inventory, census, structural check, atomic verifier, attack verifier, fixture, generator, and deterministic audit utility must be TypeScript. Do not invoke Python or create Python audit artifacts. Do not add packages, package.json scripts, repository runners, or target-source files. The required `.audit-spec/` TypeScript harnesses are explicitly permitted audit artifacts. Read-only shell/file/hash commands may orchestrate artifacts but may not replace TypeScript evidence.
10. Default to isolated, read-only execution. Network, secrets, persistent mutation, external cost, or production access requires explicit user approval. Never persist secrets.
11. Use general domain knowledge to choose vocabulary, recognize material behavior, and challenge risks and edge cases. It is orientation, not evidence of repository behavior or intended authority.
12. Assign every claim an impact tier. `HIGH` and `CRITICAL` claims require a counterexample/boundary attempt and independent replay.
13. Preserve conflicts, deviations, contradicted results, unresolved contexts, and stale evidence. Never rewrite an expectation after observing implementation.
14. Mermaid diagrams are derived views, not evidence. Keep canonical `.mmd` text, stable component/flow IDs, adjacent trace records, visible uncertainty, and identical fenced copies in the Markdown editions.
15. Do not interrupt automated Phases 1–8 for semantic uncertainty. Add material uncertainty to `REVIEW_PACKET.md` and ask the human once, after consolidation. Safety authorization remains an immediate gate.
16. Human review covers material intended/expected/implemented deviations, conflicting or unknown material intent/expectation, high/critical risks, contradictions, unresolved meaningful behavior or execution contexts, and `UNRESOLVED_SIGNIFICANCE` symbols. Agents cannot approve intent or fabricate decisions.
17. A change to source, scope, role definitions, a claim, verifier, or supporting evidence makes dependent artifacts stale. Preserve history and replay affected work.
18. An investigator must challenge BHV atomicity and its impact/tags/contexts/job load before writing a claim. For a non-atomic BHV, write `SPLIT_REQUEST.md`; for an atomic but misprofiled or overloaded assignment, write `PROFILE_CORRECTION.md`. The orchestrator reruns targeted architecture correction and replaces affected jobs before claims from those jobs are accepted or verification begins.
19. No behavior is complete while one of its `CL-*` or `INV-*` records lacks a direct test assertion/result or an explicit unresolved/infeasible/excluded disposition. Component-level or method-level verification cannot stand in for missing clause evidence.
20. Independently implement a generic semantic/invariant census and the authored classifier. The census emits invariant-category obligations from mechanical source indicators; the classifier cannot define its own completeness baseline. Consolidation reconciles every outcome and invariant obligation.
21. Treat the threat model as an independent completeness baseline for security review. Every available profile has an applicability decision; every selected profile layer/challenge has a SEC obligation; and every protected asset, trust boundary, attacker capability, unacceptable outcome, SEC, and material threat scenario maps to BHV/INV/ATK evidence or a visible unresolved/out-of-scope disposition.
22. Atomic verifier success cannot close a composed threat. Material multi-step and cross-component threats require ATK evidence from a separate fresh attack verifier.
23. Security findings include exploit scenario, prerequisites, impact, likelihood/difficulty, affected assets and trust boundaries, evidence, remediation, and regression-test identity. Confirmed fixes require replay of the original counterexample plus affected atomic and attack-chain tests.

## Phase 0 — preflight

Pin repository revision, scope and hash, lockfile, runtime, TypeScript runner, available execution contexts, role hashes, sensitive exclusions, and authorized behavior inputs in `SCOPE.md`. Initialize `STATUS.md` and smoke-test the existing TypeScript runner. Stop if source cannot be pinned or TypeScript cannot run.

## Phase 1 — business logic

Start a fresh agent with [business-logic.toml](agents/business-logic.toml). Give it only `SCOPE.md` and named requirement, policy, product, public-interface, and test artifacts—not implementation source. It writes `BUSINESS_LOGIC.md` with actors, goals, rules, state transitions, invariants, permissions, failure policy, intended behavior, expected observable behavior, authorities, conflicts, and unknowns.

## Phase 2 — architecture and meaningful-behavior inventory

Start a fresh agent with [architect.toml](agents/architect.toml). Give it `BUSINESS_LOGIC.md` and the named source. It writes and runs one deterministic TypeScript source-inventory program using the TypeScript compiler API, then produces:

- a lightweight `SRC-*` record for every scoped file, declared symbol, and detected material anonymous/top-level executable site;
- a significance disposition for every `SRC-*`;
- one `BHV-*` per atomic meaningful business/security behavior;
- a behavior-boundary matrix proving every external/program/public-material API and independent security/state boundary is mapped at appropriate granularity;
- a complete semantic clause/invariant ledger (`CL-*`/`INV-*`) beneath the BHVs;
- `ARCHITECTURE.md`, canonical Mermaid diagrams and trace records;
- bounded investigation jobs grouped by component, flow, or related behavior.

It reconciles files, symbols, material sites, generic semantic census records, classified clauses, invariant candidates, and BHV mappings. Apply the decomposition and complexity rules above; component-level omnibus behavior and missing semantic outcomes are invalid. If significance, feasibility, or atomicity is unclear, preserve an unresolved record.

## Phase 3 — threat model and security coverage

Start a fresh agent with [threat-model.toml](agents/threat-model.toml). Give it `SCOPE.md`, `BUSINESS_LOGIC.md`, `ARCHITECTURE.md`, `BEHAVIOR_INVENTORY.md`, all security profiles, and exact scoped source. It writes `SECURITY_MODEL.md` with assets, actors, trust zones, attacker capabilities, assumptions, objectives, unacceptable outcomes, entry points, profile applicability, one `SEC-*` obligation per selected profile layer/challenge, and stable `THR-*` scenarios. It maps every material threat to BHV/INV targets or writes `THREAT_GAP.md`. It creates deferred synthesis job definitions owning exact THR IDs; those jobs are dispatched only after Phase 5 supplies their exact atomic-result inputs. It does not assert implementation facts or write tests.

Any `THREAT_GAP.md` blocks affected investigation. The orchestrator starts a fresh targeted Phase-2 correction, updates BHV/INV/jobs, reruns Phase 3, validates the replacement mappings, and records the preserved gap as resolved before Phase 4/5 work is accepted.

## Phase 4 — investigation

For each bounded job, start a fresh agent with [investigator.toml](agents/investigator.toml). Give it exact BHV/SRC/CL/INV ownership, profiles, business records, architecture items, and source. It challenges atomicity, profile, semantic completeness, feasibility, and workload. A claim must enumerate exact clauses/invariants and a decisive per-record verification plan. Missing clauses trigger `SEMANTIC_GAP.md`; boundary/profile defects use the existing correction artifacts. Resolve all requests before accepting affected claims or verification.

## Phase 5 — atomic verification

For each claim, start a different fresh agent with [verifier.toml](agents/verifier.toml). It writes and runs the saved TypeScript verifier and writes `RESULT.md` with one assertion/result row per assigned CL/INV. A verifier may contain multiple cases for the same behavior, but no aggregate pass can hide an unexecuted semantic record. If the required context cannot run, mark affected records `UNRESOLVED`; do not substitute a weaker environment.

If a counter-hypothesis is observed, keep the original claim `CONTRADICTED`. Add a new claim only when the distinct observed behavior must be stated as an implemented fact.

## Phase 6 — adversarial composition

Start fresh agents with [attack-synthesizer.toml](agents/attack-synthesizer.toml) for bounded `THR-*` groups. Give each exact threat, BHV/INV/result, trust-boundary, source, and context inputs. They write stable `ATK-*` attack hypotheses, including multi-step sequences and falsification plans, without executing them.

For every material `THR-*`, require at least one `ATK-*`. Start a different fresh agent with [attack-verifier.toml](agents/attack-verifier.toml) for every material ATK. It writes and runs a saved deterministic TypeScript attack harness and records per-objective results, seeds, explored sequence boundary, counterexample/minimization, and context fidelity. When representative execution cannot proceed, the saved harness must deterministically assert/detect the missing prerequisite and produce an `UNRESOLVED` result; prose alone is insufficient. Missing representative context is never a pass.

## Phase 7 — writing

First run a fresh architecture-integration agent to add hypothesis/result links and evidence statuses to the behavior inventory, architecture, and diagrams without changing the original symbol list or behavior definitions.

Then run a fresh agent with [writer.toml](agents/writer.toml). It writes `RISKS.md`, `COVERAGE.md`, `SPECIFICATION.md`, `REVIEW_PACKET.md`, and `publication/`. The reader-facing structure is by business context, component, and flow—not by source syntax. The specification includes:

- intended, expected, and verified implemented behavior;
- components, flows, state, invariants, permissions, errors, side effects, and security contexts;
- Mermaid diagrams;
- findings, risks, limitations, and coverage;
- threat model, security objectives, attack chains, exploit scenarios, and residual risk;
- a compact source-accountability appendix mapping every `SRC-*` to its significance disposition and parent `BHV-*`, without prose specifications for implementation-only helpers.

## Phase 8 — consolidate

Start a fresh agent with [consolidator.toml](agents/consolidator.toml). Give it only the run root. Consolidation is artifact-only: it must not execute inventory programs, atomic verifiers, attack verifiers, proof compilation, or target code. It recomputes file/source hashes; validates saved commands, raw logs, exit/timeout records, contexts, seeds/bounds, harness/result consistency, and per-record evidence; reconciles every source symbol to a disposition; and ensures every meaningful behavior and material threat has evidence or explicit unresolved status. It also validates threat/profile coverage, attack-chain traceability, diagram traceability, Markdown publication links, edition parity, and the deferred review queue.

If evidence is missing, partial, stale, internally inconsistent, or bound to a different revision/context, consolidation fails and identifies the exact upstream inventory/verifier job to rerun. The orchestrator—not the consolidator—dispatches that fresh execution work, after which a new artifact-only consolidation runs.

Repair automated gaps and reconsolidate. Do not ask for semantic human judgment until status is `READY_FOR_HUMAN_REVIEW` or `READY_WITH_UNRESOLVED`.

## Phase 9 — one human review

Present one prioritized checklist from `REVIEW_PACKET.md`: high/critical risks and defects; expected/implemented deviations; material unknown/conflicting intent or expectation; contradictions; unresolved meaningful behavior, threats, assumptions, execution contexts, profile layers, and coverage; `UNRESOLVED_SIGNIFICANCE`; and carry-over items.

Record direct identifiable human decisions in `HUMAN_REVIEW.md`. Allowed dispositions are `CONFIRMED`, `INTENT_CORRECTED`, `EXPECTATION_CORRECTED`, `IMPLEMENTATION_ACCEPTED`, `DEFECT_CONFIRMED`, `MORE_EVIDENCE_REQUIRED`, `OUT_OF_SCOPE`, and `UNRESOLVED`. Corrections or requested evidence reopen affected automated phases and require a new consolidation and review round. Approval cannot rewrite captured implementation observations.

After an approved round, project only authorized review fields into the reserved review regions of `SPECIFICATION.md` and `publication/review-status.md`, recompute manifest hashes, and mechanically validate that technical content did not change.

## Completion

Finish only when:

- every scoped file, declared symbol, and detected anonymous/top-level material-effect site has one significance disposition;
- every executable semantic-census outcome maps to CL records and every invariant obligation maps to INV records; only non-executable syntax may receive a schema-defined non-semantic classification;
- every decision arm, assertion outcome, effect, exit/error, edge partition, and applicable invariant candidate has one CL/INV record and final disposition;
- every meaningful behavior has one claim and deterministic TypeScript result, including explicit `UNRESOLVED` results where no representative context exists;
- every external/program/public-material API and independent state/security boundary appears in the behavior-boundary matrix, with any grouping justified as true aliasing or one indivisible rule;
- every active BHV carries its profile; normal investigation jobs have exact non-overlapping BHV/record ownership within caps; coordinated CLAUSE_SHARD jobs may share one parent BHV/HYP only when their CL/INV ownership is disjoint and one CLAIM_INTEGRATION job owns the final claim; every correction request is resolved before affected verification;
- every active CL/INV maps to one BHV/HYP and evidence: named assertion/result when feasible, structural proof when infeasible, or reviewed-and-reconsolidated scope exclusion when out of scope; semantic gaps are resolved;
- every published implementation fact is supported by immutable saved evidence whose harness, command, log, hashes, context, and result are validated in consolidation;
- every available profile has an applicability decision and rationale; every selected profile layer/challenge has one SEC obligation; every protected asset, trust zone, attacker capability, security objective, unacceptable outcome, SEC, and material THR maps to evidence or an explicit unresolved/out-of-scope disposition;
- every material composed threat has an ATK hypothesis and replayable deterministic TypeScript result, with finite campaign bounds and context limitations stated;
- every confirmed security defect has an exploit scenario, prerequisites, impact, exploitation difficulty, remediation status, and durable regression-test identity;
- intended, expected, and implemented behavior and their deviations remain distinct and traceable;
- material business/security behavior, public surfaces, state transitions, permissions, assets, proof/cryptographic effects, integrations, failures, and execution-context limits are covered or visibly unresolved;
- diagrams, the single-file specification, and the Markdown publication agree;
- the consolidated human checklist covers all material uncertainty;
- required human decisions and correction rounds are complete;
- target source remains unchanged.

Completion does not claim mathematical enumeration of infinite inputs or schedules, but it does require explicit accounting of every statically discoverable branch arm, semantic exit/effect, declared edge partition, and invariant candidate.
