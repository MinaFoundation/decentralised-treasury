# Project agent instructions

## User-facing language

Use ASD-STE100 Simplified Technical English style for all user-facing
communication in this repository. Follow
`.agents/skills/codebase-analysis/references/STE-STYLE.md`. Treat project
terms, code identifiers, and exact values as technical terms. This is a style
rule only; do not claim ASD-STE100 certification or compliance.

## Audit specification workflow

The canonical entry point is the repository-local `$audit-spec` skill at `.agents/skills/audit-spec/SKILL.md`. Invoke it explicitly with a repository source scope or an existing run root.

When explicitly invoked, follow the skill’s operation selection, fresh-context orchestrator phases, artifact format, deterministic TypeScript promotion boundary, validation, and stopping rules. Store durable work under `.audit-spec/<scope-slug>/` and resume from `STATUS.md`, never from chat.

The workflow performs business-logic analysis before architecture; keeps intended, expected, and implemented behavior separate; and deterministically verifies business and security semantics. It accounts for every scoped file/symbol/material site plus every statically discoverable decision outcome, effect, edge partition, and invariant candidate. It does not claim mathematical exploration of infinite inputs, dynamic systems, or schedules: those limits are explicit unresolved records. Automated verification, writing, and consolidation finish before one prioritized human checklist. Outputs include a single-file specification and component-and-flow Markdown publication.

Do not activate this workflow for ordinary coding, review, or documentation tasks.

## Codebase analysis workflow

The canonical entry point is the repository-local `$codebase-analysis` skill at `.agents/skills/codebase-analysis/SKILL.md`. Invoke it with a whole-repository scope, repository-relative paths/symbols, or an existing `.codebase-analysis/<scope-slug>/` run root.

Use it to create or refresh a formal static understanding baseline for later testing, business-logic consolidation, architecture work, quality review, or assurance planning. It produces one authoritative YAML model and a traceable Markdown/Mermaid publication covering business logic, implementation semantics, tests, components, flows, clauses, invariants, I/O, relationships, findings, and applicable blockchain/zero-knowledge properties.

Every run applies the mandatory zkSecurity-inspired whole-system review method: reconstruct the protocol/system before judging local code; enumerate security objectives, threats, assumptions, trust boundaries, and known failure classes; review local enforcement and cross-component composition; and report findings by prerequisites, root cause, impact, severity, confidence, remediation, and limitations. This is required for ordinary application code as well as smart-contract and ZK scopes.

The workflow always uses two passes. Pass 1 collects local facts and freezes an immutable model; the orchestrator then creates a complete global context pack from those facts plus hashed user-supplied RFCs, prior audits, forum discussions, policies, and design records. Pass 2 re-reviews every semantic record with that complete summarized context and its raw local evidence before final publication.

The root orchestrator is the sole canonical-model owner and counts toward the hard maximum of four active local agents. Run at most three fresh workers concurrently, with disjoint evidence ownership and serial model integration. Prefer fewer workers for cohesive scopes. Store durable state under `.codebase-analysis/<scope-slug>/` and resume from `STATUS.yaml`, never from chat.

This workflow is strictly read-only. Under no condition may any agent touch source, tests, configuration, documentation, or supplied context; the sole repository write root is the active `.codebase-analysis/<scope-slug>/` run root. Tests are analyzed but not executed. Never create/run claim verifiers, target TypeScript, repository tests, proof compilation/generation/verification, local chains, or any `PROOFS_ENABLED` mode. The skill's bounded TypeScript integrity checker may only read hashes/YAML/Markdown. Runtime, proof, cryptographic, and deployed behavior remains unresolved.
