# Method and external reference patterns

Use these sources for structure and vocabulary, not as evidence about the analyzed repository.

## Architecture and documentation

- [ISO/IEC/IEEE 42010:2022](https://www.iso.org/standard/74393.html): represent stakeholders, concerns, viewpoints, model kinds, views, and correspondences.
- [C4 model](https://c4model.com/diagrams): use hierarchical context/container/component views and dynamic diagrams selectively; use typed nodes and labelled directional relationships.
- [arc42](https://docs.arc42.org/home/): cover goals, constraints, context, strategy, building blocks, runtime scenarios, deployment, cross-cutting concepts, decisions, quality scenarios, risks, and glossary.
- [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/sarif-v2.1.0-os.html): adopt rule IDs, levels, precise locations, related locations, and code-flow concepts in YAML findings.

## Static analysis

- [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API): prefer `Program`, `TypeChecker`, AST spans, symbols, signatures, JSDoc, imports/exports, and diagnostics over regular-expression parsing. Pin the TypeScript version.
- [CodeQL data-flow model](https://codeql.github.com/docs/writing-codeql-queries/about-data-flow-analysis/): distinguish value flow from taint-like flow; record sources, sinks, barriers, added steps, and local/global precision limitations.
- Use installed language-native analyzers when available, but normalize their output into canonical YAML and preserve tool/version/command limitations. Never treat a detector result as intended business logic.

## Tests and quality

- Treat tests as an expectation map: target behavior, setup, input partition, assertion, mocks, and missing cases.
- Apply senior QA review categories: boundary-value analysis, equivalence partitions, state-transition coverage, decision tables, error/recovery paths, concurrency/order/retry, determinism, fixture fidelity, isolation, observability, and maintainability.
- Distinguish structural coverage from semantic adequacy. A test that calls a method does not necessarily test its rule or invariant.

## Smart contracts and blockchain

- [OWASP Smart Contract Security Verification Standard](https://scs.owasp.org/SCSVS/): record applicability and coverage for architecture, code, governance/economic logic, authorization, communications/oracles, cryptography, blockchain interactions, bridges, DeFi, and protocol components.
- [Solidity NatSpec](https://docs.soliditylang.org/en/latest/natspec-format.html): preserve public-interface notice/developer/parameter/return intent annotations when present; documentation is not implementation proof.
- When installed and language-applicable, Slither, Aderyn, Semgrep, or CodeQL may contribute evidence bundles. They are optional complements, not pipeline dependencies.

## Zero knowledge

- [ZKProof implementation guidance](https://docs.zkproof.org/pages/reference/versions/zkproof-implementation-20180801.pdf): connect the high-level statement to the circuit/constraint representation; record representation, range, setup, deployment, and side-channel assumptions.
- For o1js/Mina or similar TypeScript ZK platforms, distinguish host-language computation from constraint-producing operations. Map state preconditions, public/private values, witness computations, commitment/root binding, recursive public-input continuity, permissions, verification-key policy, and proof-mode configuration.
- Static analysis can identify likely missing or partial bindings but cannot establish cryptographic soundness, completeness, privacy, or deployed verifier behavior.

## Marketplace and reusable-skill patterns

- [OpenAI Plugins repository](https://github.com/openai/plugins): use versioned skills, explicit phase contracts, durable artifacts, and narrowly scoped role instructions.
- [Codex Security finding-discovery skill](https://github.com/openai/plugins/blob/main/plugins/codex-security/skills/finding-discovery/SKILL.md): adopt an explicit coverage ledger, bounded deep-review inputs, and separate discovery from validation. Codex Security is an optional specialized complement, not required by this skill.
- [OpenAI Skills catalog](https://github.com/openai/skills) documents the skill packaging model but is deprecated in favor of the Plugins repository.
- Community codebase-knowledge and documentation skills reinforce local-first inventory, file-cited claims, bounded multi-document publication, and rubric-based challenge passes. Inspect licenses and instructions before reuse; do not install them implicitly.

## Adopted design principles

1. One canonical normalized model; many evidence bundles and reader views.
2. Static completeness and semantic interpretation are separate gates.
3. Intended, test-expected, implemented-static, inferred, and unresolved facts never collapse.
4. Every scoped source/test surface is accountable, but not every AST node becomes a reader behavior.
5. Parallelism is bounded and disjoint; integration is serial and context-rich.
6. Whole-repository analysis proceeds in resumable component waves with explicit cross-component flows.
7. Unknown dynamic, generated, dependency, native, deployed, and cryptographic behavior remains visible.
