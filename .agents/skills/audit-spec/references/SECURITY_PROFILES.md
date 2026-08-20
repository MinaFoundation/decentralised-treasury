# Audit-spec security profiles

Select only profiles applicable to the recorded scope. Profiles guide threat discovery and coverage; they are not evidence of repository behavior.

## Core application

Cover authentication and authorization, sensitive data, state consistency, input boundaries, parsing and serialization, external calls, configuration, error handling, concurrency, retry, replay, dependency assumptions, deployment, and operational trust.

## Blockchain and smart contract

Cover assets and conservation, privileged roles and permissions, account/identity/token binding, state preconditions and postconditions, transaction atomicity, ordering/front-running/replay, upgrade/configuration authority, cross-contract calls, events versus state, off-chain actors, network/finality assumptions, economic incentives, denial of service, and proof-enabled versus proof-disabled behavior when applicable.

## Zero-knowledge and cryptographic systems

Maintain coverage across these layers when present:

- application/business rule and integration;
- state-transition or contract logic;
- circuit/constraint logic;
- witness generation and hint/computation logic;
- frontend/compiler and arithmetization assumptions;
- proof composition/recursion and public-input continuity;
- prover, verifier, transcript and backend assumptions;
- serialization, domain separation, commitments, hashes and key material;
- deployment, configuration and operational integration.

Challenge soundness, completeness and privacy/zero-knowledge separately. Check underconstraint, overconstraint, incorrect witness computation, missing public/private input binding, unconstrained selection, field/range/canonical-representation errors, root/witness/commitment mismatch, recursive-proof discontinuity, replay/nullifier/uniqueness failure, authorization/permission mismatch, failure atomicity, unsafe defaults, proof-mode differences, and integration behavior around proof acceptance or rejection.

## Assurance techniques

For every material threat, select the strongest available repository-local deterministic TypeScript technique: exact example or counterexample, boundary partitions, seeded generation, state-machine sequences, differential oracle, metamorphic relation, structural proof, or representative integration execution. Record finite bounds and unresolved limits. External static, symbolic, fuzzing, or formal tools may corroborate only when already installed and reproducible; they do not replace required TypeScript evidence.
