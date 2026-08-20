# zkSecurity-inspired whole-system static-review guide

Use the core method in this guide for every scope. Use its governance, treasury, smart-contract, voting, ledger, and zero-knowledge extensions when applicable. It supplies review questions and output structure, not facts about the analyzed revision. Repository evidence and user-supplied authoritative material always take precedence. “zkSecurity-inspired” describes the adopted public review patterns; it does not imply endorsement, equivalence to a professional audit, or use of unpublished methodology.

## Source basis and limits

- [Mina Decentralized Treasury RFC](https://forums.minaprotocol.com/t/rfc-mina-decentralized-treasury-decentralized-on-chain-community-treasury/6924) — proposed goals, mechanisms, parameters, risks, rollout stages, and community discussion.
- [Mina Foundation RFC-to-delivery update](https://forums.minaprotocol.com/t/an-update-on-the-decentralized-treasury-from-rfc-to-delivery/7077) — published description of implementation and audit scope: overall design, repository, smart-contract logic, zkProgram assumptions, governance/voting mechanics, execution/tallying, participant capacity, remediation, and future integrated review.
- [zkSecurity Zeko report](https://reports.zksecurity.xyz/reports/zeko/) — Mina-related example of combining local circuit inspection with whole-protocol review, explicit scope limits, assumptions, severity, and follow-up recommendations.
- [zkSecurity underconstraint guidance](https://blog.zksecurity.xyz/posts/underconstrain-bugs/) — prover computation is not a proved statement unless the necessary relation is constrained and bound to public values.
- [zkSecurity Penumbra review](https://blog.zksecurity.xyz/posts/penumbra/) — statement-oriented circuit descriptions, pseudocode, stateful/stateless/execute separation, commitments, nullifiers, double-spend/double-vote reasoning, and remediation follow-up.
- [zkSecurity ZK bug knowledge base](https://blog.zksecurity.xyz/posts/zkbugs-website/) — known-bug taxonomy and root-cause-oriented learning; static tools have bounded coverage and do not replace protocol reasoning.
- [zkSecurity Aleo synthesizer review](https://www.zksecurity.xyz/blog/2023-aleo-synthesizer.pdf) — value of protocol specifications, rationale, workflow modelling, shared-logic complexity, prover/verifier comparison, and lower-level gadget boundaries.

The public Mina update dated May 27, 2026 stated that detailed audit reports were expected later. The full Treasury-specific zkSecurity report was not among the public sources verified while preparing this guide. Therefore do not infer its individual findings or remediation details. If the user supplies that report, register it as `PRIOR_AUDIT`, hash it, extract every finding/assumption/scope exclusion/remediation claim, and trace it to the analyzed revision.

## Mandatory core method for every codebase

Apply the following sequence to ordinary applications, libraries, infrastructure, smart contracts, and ZK systems alike:

1. Pin revision, exact scope, dependencies, generated/native boundaries, supplied context, exclusions, and review limitations.
2. Reconstruct the system before reviewing defects: purpose, actors, assets, privileges, trust zones, entry points, state/lifecycle, principal flows, external dependencies, and deployment assumptions.
3. State protected security and correctness objectives (`SEC-*`) as properties the system must preserve. Tie them to business rules, invariants, enforcement sites, and affected assets.
4. Make every trust, protocol, environment, dependency, configuration, operator, availability, and cryptographic assumption explicit (`ASM-*`). Record its evidence, affected records, failure consequence, and whether code enforces, merely relies on, or cannot establish it.
5. Build threat and adverse-state hypotheses (`THR-*`) from assets, entry points, privilege boundaries, state transitions, data/control flow, failure policy, and composed interactions. Include accidental failure and misuse, not only malicious actors.
6. Review locally and compositionally. A correct function can participate in an unsafe flow; a local check can be invalidated by ordering, configuration, another component, stale state, or a downstream consumer.
7. Map each objective, assumption, and threat to exact requirements, behaviors, flows, clauses, invariants, I/O, relationships, tests, findings, and source anchors. Unsupported narrative is not a review result.
8. Apply the known-failure-class matrix below. Mark every class `APPLICABLE_REVIEWED`, `NOT_APPLICABLE`, or `UNRESOLVED`, with rationale and linked records. Absence of a finding is not evidence of safety.
9. Report root cause rather than symptom. Every finding states category, severity, confidence, prerequisites, affected assets/actors, root cause, impact, evidence, recommendation, uncertainty, and scope limitations. Keep business/specification gaps distinct but cross-linked.
10. Re-review after global context synthesis. Reassess local conclusions, threat composition, assumption validity, severity, and remediation/audit drift against the complete system model.

Mandatory known-failure classes:

- missing validation, authorization, equality, binding, ownership, or state-transition check;
- incorrect initial/default/terminal state, unsafe fallback, partial update, or incomplete rollback/recovery;
- identity, privilege, confused-deputy, tenancy, account, resource, recipient, or domain mix-up;
- replay, uniqueness, idempotency, ordering, concurrency, race, stale-read, duplication, or omission failure;
- arithmetic, range, signedness, precision, rounding, encoding, serialization, canonicalization, truncation, or overflow error;
- untrusted input/data flow reaching a sensitive sink without a documented barrier;
- inconsistent producer/consumer, client/server, write/read, construction/validation, or local/global rule set;
- dependency, configuration, feature-mode, environment, deployment, upgrade, key, version, or permission assumption;
- information exposure, secret handling, logging, error-message, or metadata leak;
- resource exhaustion, unbounded work/storage, queue/backlog, retry storm, availability, or liveness failure;
- incomplete observability, audit trail, event, monitoring, operational response, or administrative recovery;
- test oracle/fixture blind spot, mocked-away trust boundary, missing adverse partition, or expectation drift;
- requirement/audit/remediation drift across versions or moved code;
- smart-contract/ZK-specific constraint, proof, state, asset, replay, recursion, or host-computation failure when applicable.

The publication must include a protocol overview, threat model, assumptions/limits register, known-failure-class matrix, and security review. Use formal language and explicitly distinguish observed implementation, inferred hypothesis, unresolved risk, and confirmed documented intent.

## RFC-to-implementation traceability

Treat an RFC as versioned intent evidence, not automatically current requirements. Split each normative, provisional, optional, deferred, parameterized, and disputed statement into an atomic requirement. Record:

- requirement text and exact source anchor;
- authority and decision maturity;
- rationale and protected asset/outcome;
- rollout stage: `MVP`, `SAFETY_PERFORMANCE`, `ADVANCED`, `DECENTRALISATION`, `FUTURE`, or `UNKNOWN`;
- implementation status: `IMPLEMENTED`, `PARTIAL`, `NOT_IMPLEMENTED`, `DEFERRED`, `SUPERSEDED`, `REJECTED`, `CONFIGURATION_DEPENDENT`, or `UNRESOLVED`;
- implementation records, test expectations, and operational dependencies;
- deviation status and whether it is authorized;
- consequence of omission or divergence;
- question requiring author confirmation.

Never report a future/optional RFC feature as an implementation defect merely because it is absent. Never mark a divergence authorized without a decision source.

For governance/treasury systems, inspect at least:

1. custody, assets, supply assumptions, payout limits, conservation, and destination binding;
2. proposal identity, content commitment/availability, type, value, recipient, replay domain, and execution uniqueness;
3. proposal, exploration, voting, cooldown, post-cooldown, cancellation, pause, and terminal transitions;
4. lifecycle-to-slot/epoch/snapshot binding and behavior across boundary slots or reconfiguration;
5. proposer eligibility, spam bond creation, custody, refund/burn/freeze policy, and failure atomicity;
6. voting eligibility, direct/delegated/self-override precedence, snapshot balance, vote type, and tally semantics;
7. nullifier uniqueness and domain separation across account, proposal, lifecycle, vote type, delegation, and network;
8. quorum, majority, eligible-supply denominator, abstention, rounding, equality boundaries, and low-participation/deadlock behavior;
9. tally completeness, ordering, duplicated/missing actions, aggregation continuity, finalization, and repeat tallying;
10. payout authorization, passed-result binding, cooldown completion, pause state, sufficient balance, recipient/value integrity, and one-time execution;
11. break-glass membership, threshold, message domain, nonce/replay, scope, transparency, recovery, rotation, and sunset path;
12. verification-key/configuration upgrade authority, initialization, permission transitions, rollback, and audit-version binding;
13. progressive fund migration, sub-treasuries, delegation, blast radius, and consistency across instances;
14. permissionless/self-hostable infrastructure claims versus practical dependencies on APIs, archives, databases, provers, operators, and availability;
15. optimistic/off-chain displays versus final provable results and user-visible stale/inconsistent state;
16. rollout, network/protocol version, deployment configuration, operational monitoring, legal controls, and off-chain procedures that code cannot enforce.
17. static capacity and liveness: batch/loop bounds, recursive aggregation depth, action volume, lifecycle deadlines, backlog/retry behavior, required services/operators, and whether source-visible limits can plausibly cover the stated participation model. Record runtime throughput as unresolved; never benchmark or generate proofs.

## Whole-protocol ZK review

Write a high-level statement for each proof before inspecting local constraints:

```text
Given public instance P and private witness W, prove relation R,
bind result O to P, and authorize state/effect E under assumptions A.
```

Then map every term to source-visible values, encodings, constraints, host computation, proof composition, verifier checks, and downstream state transitions. Produce concise pseudocode alongside the mapping.

Review these failure classes statically:

- missing constraint, equality, commitment, root, public-input, or previous-proof link;
- host witness computation mistaken for a proved relation;
- prover/verifier, stateful/stateless, or construction/verification asymmetry;
- unconstrained selector, branch, optional case, failure flag, or unsuccessful update;
- missing uniqueness, nullifier, monotonic-index, domain-separation, or replay binding;
- invalid or unverifiable initial state and permission/verification-key transition assumptions;
- canonical representation, field aliasing, signedness, range, carry, overflow, truncation, packing, or ordering errors;
- wrong variable, lower/upper bound, root, index, account, token, recipient, lifecycle, or network identifier;
- incomplete recursive continuity, merge adjacency, terminal-state, or aggregation binding;
- multiple rule sets or configuration modes that should be separated but share unsafe logic;
- liveness/completeness failures where valid inputs cannot be proved, processed, tallied, or executed;
- dependency, compiler, protocol-version, key, setup, and deployment assumptions;
- off-chain transaction construction or ordering assumptions that can cause loss, censorship, inconsistent state, or double processing.

Static inspection may label a binding `PRESENT`, `PARTIAL`, `ABSENT_CANDIDATE`, or `UNRESOLVED`; it may not claim circuit soundness or exploitability without further assurance.

## Audit finding ingestion and drift

For each supplied prior-audit item record:

- auditor, report hash, audit commit, dates, scope, exclusions, and methodology;
- original identifier, title, severity, status, affected paths, root cause, impact, and assumptions;
- remediation commit/claim and whether it intersects the current source;
- current disposition: `STILL_APPLICABLE`, `REMEDIATED_STATICALLY`, `REGRESSED_CANDIDATE`, `CODE_MOVED`, `OUT_OF_SCOPE`, or `UNRESOLVED`;
- successor behaviors/invariants/findings and author question.

Do not inherit “sound”, “fixed”, or severity labels across revisions without traceability. An audit is time-bounded, scoped evidence, not a certification. Review adjacent and downstream code because a local fix may move or transform the assumption.

## Business and implementation gap taxonomy

Classify each gap as one or more of:

- `MISSING_INTENT`: implementation exists without an authoritative business rule;
- `MISSING_IMPLEMENTATION`: current intended requirement has no implementation;
- `PARTIAL_IMPLEMENTATION`: only part of the rule or lifecycle is enforced;
- `IMPLEMENTATION_DIVERGENCE`: implemented behavior differs from current intent;
- `EXPECTATION_DIVERGENCE`: tests encode behavior different from intent or implementation;
- `UNENFORCED_POLICY`: documentation promises a rule enforced only operationally or not at all;
- `OFFCHAIN_TRUST`: safety/liveness depends on operators, services, ordering, storage, or availability;
- `CONFIGURATION_RISK`: correctness depends on deployment/network parameters or permissions;
- `MISSING_BINDING`: values are computed but not demonstrably linked to the governing rule/state/proof;
- `INCOMPLETE_FAILURE_POLICY`: rejection, rollback, retry, recovery, or terminal behavior is unclear;
- `LIVENESS_OR_SCALE_GAP`: correct behavior may not complete at required participation/data scale;
- `AUDIT_DRIFT`: current code or assumptions differ from the audited revision;
- `UNRESOLVED_AUTHORITY`: competing sources do not establish the intended rule.

Every gap includes business consequence, affected actors/assets, exact evidence, confidence, rollout relevance, and a neutral author question. Keep security findings separate from specification gaps while cross-linking them.

## Author-facing publication standard

Optimize the publication for an author who needs to validate understanding quickly:

1. Begin with a one-page executive summary: purpose, main actors/assets, principal lifecycle, critical invariants, largest gaps, and unresolved author decisions.
2. Provide a glossary before implementation detail.
3. Explain each major flow twice: a concise narrative and a Mermaid sequence/state diagram.
4. For every component show responsibility, inputs, outputs, state, permissions, errors, dependencies, invariants, tests, and gaps in a consistent table.
5. Include an RFC/audit-to-code traceability matrix and a prioritized business/implementation gap register.
6. Separate `WHAT THE SYSTEM IS FOR`, `WHAT SOURCES SAY`, `WHAT CODE IMPLEMENTS`, `WHAT TESTS EXPECT`, and `WHAT REMAINS UNCERTAIN`.
7. Put high-impact author questions in one review checklist; do not bury them in component pages.
8. Use formal language but define specialized terms and avoid audit jargon where ordinary language is clearer.

The goal is accurate comprehension and decision support. Do not maximize record count at the cost of readability; preserve exhaustive detail in YAML and present coherent business-level groupings in Markdown.
