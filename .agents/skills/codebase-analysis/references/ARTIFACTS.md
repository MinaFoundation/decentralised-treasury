# Artifact contract

## Run layout

```text
.codebase-analysis/<scope-slug>/
├── SCOPE.yaml
├── STATUS.yaml
├── READ_ONLY_GUARD.yaml
├── MANIFEST.yaml
├── model/
│   ├── pass-1.yaml
│   ├── context.yaml
│   └── codebase.yaml
├── work-units/
│   └── WU-*.yaml
├── evidence/
│   ├── reconnaissance/*.yaml
│   ├── semantic/*.yaml
│   ├── challenge/*.yaml
│   └── contextual/*.yaml
└── publication/
    ├── README.md
    ├── SUMMARY.md
    ├── SPECIFICATION.md
    ├── CONTEXT.md
    ├── REQUIREMENTS_TRACEABILITY.md
    ├── GAP_ANALYSIS.md
    ├── AUTHOR_REVIEW.md
    ├── CAPACITY_AND_LIVENESS.md
    ├── THREAT_MODEL.md
    ├── ASSUMPTIONS_AND_LIMITS.md
    ├── SECURITY_REVIEW.md
    ├── BUSINESS_LOGIC.md
    ├── ARCHITECTURE.md
    ├── FLOWS.md
    ├── INVARIANTS.md
    ├── INPUTS_OUTPUTS.md
    ├── TEST_MAP.md
    ├── STATIC_FINDINGS.md
    ├── UNRESOLVED.md
    ├── components/*.md
    └── flows/*.md
```

Only YAML and Markdown are durable output formats. Embed Mermaid in fenced Markdown blocks; do not require separate image or Mermaid files.

## Scope and status

`SCOPE.yaml`:

```yaml
schema_version: 1
run:
  id: ""
  revision: ""
  created_utc: ""
scope:
  mode: "whole_repo | scoped"
  include: []
  exclude: []
  dependency_closure: "bounded | repository"
  scope_hash: ""
  files:
    - path: "packages/example/src/file.ts"
      role: "PRIMARY | READ_ONLY_CONTEXT | EXPANDED_SCOPE"
      sha256: ""
toolchain:
  languages: []
  typescript_version: ""
  tsconfig_paths: []
  installed_static_tools: []
hashing:
  algorithm: "sha256"
  path_encoding: "repository-relative POSIX, NFC"
  scope_hash_input: "UTF-8 lines sorted by path: role + NUL + path + NUL + file_sha256 + LF"
constraints:
  static_only: true
  outputs: ["yaml", "markdown"]
  max_active_agents_including_orchestrator: 4
  target_files_read_only: true
  permitted_repository_write_root: ".codebase-analysis/<scope-slug>"
authorities:
  documents:
    - path: "docs/example-rfc.md"
      kind: "RFC | PRIOR_AUDIT | FORUM | DESIGN | POLICY | DECISION | OTHER"
      authority: "AUTHORITATIVE_INTENT | NORMATIVE_EXPECTATION | INFORMATIVE | HISTORICAL | CONTESTED | UNKNOWN"
      applicable_paths: []
      sha256: ""
  tests_are_expectation_evidence_only: true
```

For a whole repository, use scope slug `repository-<first 12 hex of scope_hash>`; for a scoped run use `<last included path basename>-<first 12 hex>`. Resolve membership before hashing. Normalize each repository-relative path to NFC POSIX form, hash its current bytes, then hash exact UTF-8 descriptor lines in `hashing.scope_hash_input`. Include dirty and untracked scoped files by content hash; Git revision alone is insufficient. The TypeScript validator recomputes every file digest and the aggregate scope hash.

Classify every dependency edge as `PRIMARY`, `READ_ONLY_CONTEXT`, `EXPANDED_SCOPE`, or `UNRESOLVED_EXTERNAL`. Only the orchestrator may promote context into scope. Direct imports and tests may remain read-only context; they do not enlarge coverage claims unless explicitly promoted.

`STATUS.yaml` records phase, completed/stale work units, model/manifest hashes, counts by record type/status/confidence, worker ownership, conflicts, next action, and source-change detection.

`READ_ONLY_GUARD.yaml` duplicates the sorted primary/context input path and byte-hash ledger, records the sole permitted write root, and stores a check result before/after every phase. `source_mutation_detected` must remain false. A mismatch stops the run as `SOURCE_CHANGED`; agents never restore inputs.

## Work units and worker bundles

```yaml
work_unit:
  id: "WU-0123456789"
  stable_key: "work-unit:role:normalized-primary-boundary"
  role: "inventory | business | platform | semantic | challenge | security | contextual"
  pass: "PASS_1 | PASS_2"
  revision: ""
  primary_paths: []
  read_only_context_paths: []
  owned_record_ids: []
  owned_stable_key_prefixes: []
  questions: []
  output: "evidence/<phase>/WU-0123456789.yaml"
  status: "READY | RUNNING | COMPLETE | STALE | FAILED"
```

Every evidence bundle contains provenance plus a proposed patch; workers never mutate canonical YAML:

```yaml
bundle:
  schema_version: 1
  work_unit: "WU-0123456789"
  revision: ""
  scope_hash: ""
  source_hashes: {}
  role: ""
  ownership:
    primary_paths: []
    record_ids: []
  assumptions: []
  observations: []
  proposed_records: {}
  proposed_relations: []
  conflicts: []
  unresolved: []
  coverage:
    expected_paths: 0
    accounted_paths: 0
    expected_symbols: 0
    accounted_symbols: 0
```

## Canonical model envelope

```yaml
schema_version: 1
run_ref: "SCOPE.yaml"
vocabulary:
  evidence_classes:
    - DOCUMENTED_INTENT
    - TEST_EXPECTATION
    - IMPLEMENTED_STATIC
    - INFERRED_BUSINESS_RULE
    - EXTERNAL_STANDARD
    - UNRESOLVED
  confidence: [HIGH, MEDIUM, LOW]
  record_status: [CURRENT, OUT_OF_SCOPE, STALE, SUPERSEDED]
records:
  packages: []
  requirements: []
  business_rules: []
  components: []
  sources: []
  apis: []
  behaviors: []
  flows: []
  clauses: []
  invariants: []
  inputs_outputs: []
  relations: []
  tests: []
  findings: []
  security_objectives: []
  threats: []
  assumptions: []
  gaps: []
  unresolved: []
  evidence: []
  zk_statements: []
applicability:
  general: "APPLICABLE"
  blockchain: "APPLICABLE | NOT_APPLICABLE | UNCERTAIN"
  smart_contract: "APPLICABLE | NOT_APPLICABLE | UNCERTAIN"
  zero_knowledge: "APPLICABLE | NOT_APPLICABLE | UNCERTAIN"
  rationale: {}
security_review:
  methodology: "zksecurity_inspired_static_whole_system"
  protocol_overview_ids: []
  local_review_ids: []
  composed_review_ids: []
  failure_classes:
    - class: "MISSING_CHECK_OR_BINDING"
      disposition: "APPLICABLE_REVIEWED | NOT_APPLICABLE | UNRESOLVED"
      rationale: ""
      record_ids: []
coverage:
  source:
    scoped_primary_files: 0
    source_file_records: 0
    symbols_and_sites: 0
    by_significance: {}
    unresolved_source_ids: []
  tests:
    scoped_test_files: 0
    mapped_test_files: 0
    unmapped_paths: []
  platform_indicators:
    blockchain: 0
    smart_contract: 0
    zero_knowledge: 0
    source_ids: []
  zk:
    discovered_value_boundaries: 0
    represented_value_ids: []
    unresolved_value_boundaries: []
  contextual_review:
    eligible_records: 0
    reviewed_records: 0
    by_disposition: {}
    unreviewed_ids: []
  security_review:
    current_objectives: 0
    current_threats: 0
    current_assumptions: 0
    reviewed_failure_classes: 0
    unresolved_ids: []
```

## Two-pass context contract

`model/pass-1.yaml` is an immutable copy of the validated canonical model at the end of Pass 1. `model/context.yaml` is the mandatory bridge:

```yaml
schema_version: 1
scope_hash: ""
pass_1_sha256: ""
user_context_inputs:
  - path: "docs/example-rfc.md"
    sha256: ""
    kind: "RFC"
    authority: "AUTHORITATIVE_INTENT"
    applicability_ids: []
    evidence_ids: []
    audit_metadata:
      audited_revision: null
      scope_summary: null
      exclusions: []
      extracted_finding_ids: []
      no_findings_rationale: null
system:
  mission: []
  glossary: []
  actors_roles_assets: []
  authority_map: []
  components_apis: []
  lifecycle_state: []
  principal_flows: []
  global_invariants: []
  security_objectives: []
  threat_model: []
  assumptions: []
  trust_deployment: []
  blockchain_zk: []
  test_strategy: []
  decisions: []
  conflicts: []
  unresolved: []
component_index:
  - component_id: "CMP-0123456789"
    relevant_context_ids: []
    neighboring_component_ids: []
coverage:
  pass_1_record_ids: []
  represented_record_ids: []
  omitted_with_rationale: []
```

All context entries contain IDs and evidence references. The context pack must represent every current Pass-1 semantic record directly or through a component/index entry; any deliberate omission is explicit with rationale. It is orientation, not authority, and cannot replace raw anchors.

Every current final semantic record contains:

```yaml
contextual_review:
  disposition: "CONFIRMED | REFINED | CONTRADICTED | UNRESOLVED"
  pass_1_record_ids: []
  context_ids: []
  user_context_evidence_ids: []
  reviewer_work_unit_id: "WU-0123456789"
  rationale: ""
  assumptions_added: []
  assumptions_removed: []
  global_consequences: []
  replacement_ids: []
```

Pass 2 gives every current semantic Pass-1 record exactly one consistent decision. When one Pass-1 record is split into several final records, each replacement repeats the same decision identity and lists the complete replacement set; this repetition is not a second review. `REFINED` and `CONTRADICTED` records retain links to superseded Pass-1 content; `UNRESOLVED` remains visible in the publication.

## Common record fields

Every top-level canonical record has a stable ID, lowercase NFC `stable_key`, and lifecycle-only `record_status: CURRENT | OUT_OF_SCOPE | STALE | SUPERSEDED`. Semantic truth/conflict state belongs in assertions and type-specific `semantic_status`, not `record_status`.

Every semantic record contains:

```yaml
id: "BHV-0123456789"
stable_key: "behavior:component-key:semantic-slug"
title: ""
record_status: "CURRENT"
summary: ""
scope:
  components: []
  source_ids: []
anchors:
  - path: ""
    symbol: ""
    start_line: 0
    end_line: 0
assertions:
  - id: "AST-0123456789"
    stable_key: "assertion:parent-record-stable-key:semantic-slug"
    text: ""
    evidence_class: "IMPLEMENTED_STATIC"
    confidence: "MEDIUM"
    evidence_ids: []
    contradicts_assertion_ids: []
related_ids: []
assumptions: []
limitations: []
```

Do not assign one evidence class to an entire record. `assertions[]` is the unit of knowledge and may contain documented, test, implementation, inferred, external-standard, conflicting, and unresolved statements side by side.

Every `REQ`, `BR`, `CMP`, `API`, `BHV`, `FLW`, `CL`, `INV`, `IO`, `REL`, `TST`, `FND`, `SEC`, `THR`, `ASM`, `GAP`, `UNR`, and `ZKP` record has at least one assertion. Each assertion has at least one `EVD-*` reference, except an `UNRESOLVED` assertion may instead state a non-empty limitation. `PKG-*` and `SRC-*` inventory records use their required source fields and may omit assertions.

Evidence records use:

```yaml
id: "EVD-0123456789"
stable_key: "evidence:component-key:path-symbol-lines"
evidence_class: "IMPLEMENTED_STATIC"
description: ""
anchors:
  - path: "packages/example/src/file.ts"
    symbol: "Example.method"
    start_line: 1
    end_line: 3
source_sha256: ""
tool:
  name: "typescript-compiler-api | manual-static-reading | repository-document"
  version: ""
  command: ""
limitations: []
```

Evidence anchors are mandatory, repository-realpath checked, and must point to a file present in `SCOPE.yaml` as primary or read-only context. Generated/tool-only evidence without a source line uses an artifact path plus an explicit limitation.

## Requirement and gap records

Requirements are atomic and version-aware:

```yaml
id: "REQ-0123456789"
stable_key: "requirement:authority-key:semantic-slug"
record_status: "CURRENT"
title: ""
requirement_kind: "NORMATIVE | PROVISIONAL | OPTIONAL | DEFERRED | PARAMETERIZED | DISPUTED | HISTORICAL"
authority: "AUTHORITATIVE_INTENT | NORMATIVE_EXPECTATION | INFORMATIVE | HISTORICAL | CONTESTED | UNKNOWN"
rollout_stage: "MVP | SAFETY_PERFORMANCE | ADVANCED | DECENTRALISATION | FUTURE | UNKNOWN"
implementation_status: "IMPLEMENTED | PARTIAL | NOT_IMPLEMENTED | DEFERRED | SUPERSEDED | REJECTED | CONFIGURATION_DEPENDENT | UNRESOLVED"
rationale: ""
protected_assets_outcomes: []
implementation_ids: []
test_ids: []
gap_ids: []
decision_evidence_ids: []
author_question: ""
assertions: []
```

Gaps use:

```yaml
id: "GAP-0123456789"
stable_key: "gap:component-key:semantic-slug"
record_status: "CURRENT"
title: ""
gap_kinds:
  - "MISSING_INTENT | MISSING_IMPLEMENTATION | PARTIAL_IMPLEMENTATION | IMPLEMENTATION_DIVERGENCE | EXPECTATION_DIVERGENCE | UNENFORCED_POLICY | OFFCHAIN_TRUST | CONFIGURATION_RISK | MISSING_BINDING | INCOMPLETE_FAILURE_POLICY | LIVENESS_OR_SCALE_GAP | AUDIT_DRIFT | UNRESOLVED_AUTHORITY"
materiality: "LOW | MEDIUM | HIGH | CRITICAL"
affected_actor_ids: []
affected_asset_ids: []
requirement_ids: []
implementation_ids: []
test_ids: []
finding_ids: []
business_consequence: ""
rollout_relevance: []
author_question: ""
semantic_status: "OPEN | ACCEPTED | RESOLVED_STATICALLY | DISPUTED | UNRESOLVED"
assertions: []
```

An absent optional/future requirement is not automatically a gap. A deviation is accepted only when a decision source authorizes it. Security findings and specification gaps remain distinct but cross-linked.

## Mandatory security-review records

Security objectives use:

```yaml
id: "SEC-0123456789"
stable_key: "security-objective:component-key:semantic-slug"
record_status: "CURRENT"
title: ""
protected_property: ""
asset_actor_ids: []
requirement_rule_ids: []
enforcement_ids: []
invariant_ids: []
threat_ids: []
assumption_ids: []
gaps_or_unresolved_ids: []
assertions: []
```

Threats use:

```yaml
id: "THR-0123456789"
stable_key: "threat:boundary-key:semantic-slug"
record_status: "CURRENT"
title: ""
category: ""
actors: []
assets: []
entrypoints: []
trust_zones: []
preconditions: []
adverse_sequence: []
affected_objective_ids: []
affected_record_ids: []
assumption_ids: []
static_reasoning: ""
disposition: "CANDIDATE | MITIGATED_STATICALLY | PARTIALLY_MITIGATED | UNRESOLVED | NOT_APPLICABLE"
finding_ids: []
limitations: []
assertions: []
```

Assumptions use:

```yaml
id: "ASM-0123456789"
stable_key: "assumption:boundary-key:semantic-slug"
record_status: "CURRENT"
title: ""
category: "TRUST | ENVIRONMENT | DEPENDENCY | CONFIGURATION | DEPLOYMENT | OPERATOR | AVAILABILITY | PROTOCOL | CRYPTOGRAPHIC | OTHER"
source: "DOCUMENTED | IMPLEMENTATION_DEPENDENCY | TEST_FIXTURE | INFERRED | UNKNOWN"
semantic_status: "ENFORCED | RELIED_UPON | PARTIALLY_ENFORCED | UNRESOLVED | CONTRADICTED"
affected_record_ids: []
failure_consequence: ""
validation_or_enforcement_ids: []
author_question: ""
limitations: []
assertions: []
```

Every current `FND-*` additionally contains `category`, `severity`, `confidence`, `prerequisites`, `root_cause`, `impact`, `recommendation`, `scope_limitations`, and `security_objective_ids`, `threat_ids`, and `assumption_ids`. When none of those security links applies, provide `no_security_link_rationale`. Severity is `INFORMATIONAL | LOW | MEDIUM | HIGH | CRITICAL`; it is a static prioritization, not a claim of exploitability.

The security reviewer maintains a known-failure-class matrix in `SECURITY_REVIEW.md` and canonical YAML. Each required class from `GOVERNANCE-ZK-REVIEW.md` has `APPLICABLE_REVIEWED`, `NOT_APPLICABLE`, or `UNRESOLVED`, rationale, and linked record IDs. `NOT_APPLICABLE` without rationale is invalid.

When a `PRIOR_AUDIT` is supplied, each original audit item becomes or maps to a `FND-*` with `origin: PRIOR_AUDIT`, report path/hash, audited revision, original identifier/severity/status, scope/exclusions, affected paths, root cause, remediation reference, and current-revision disposition. The context input lists all extracted finding IDs. If a report contains no itemized findings, state that explicitly; never infer unpublished findings from a summary announcement.

## Source accountability

```yaml
id: "SRC-0123456789"
stable_key: "source:component-key:path#symbol"
path: ""
symbol: ""
kind: "file | declaration | callback | top_level_site | configuration | schema | generated_boundary"
visibility: "public | internal | private | not_applicable"
significance: "MEANINGFUL | SUPPORTING | INERT_OR_TYPE_ONLY | GENERATED | OUT_OF_SCOPE | UNRESOLVED_SIGNIFICANCE"
parent_ids: []
rationale: ""
source_hash: ""
```

Coverage requires exact file/symbol/site totals by significance plus a list of unresolved significance.

There is exactly one `kind: file` `SRC-*` record for every primary scoped source/test/configuration file. Its `path` and `source_hash` must equal the corresponding `SCOPE.yaml` entry. Symbols and material sites link to that file record through `parent_ids`. Context-only files may have records but do not count toward primary coverage.

## Behavior

Add actor/trigger, preconditions, domain inputs, normal outcome, failure/boundary outcomes, state/effects, permissions/assets, ordering/retry/replay, integration dependencies, and intent/expectation/implementation fields.

## Flow

```yaml
id: "FLW-0123456789"
stable_key: "flow:component-key:semantic-slug"
flow_scope: "LOCAL | CROSS_COMPONENT"
owner_component_id: "CMP-0123456789"
title: ""
trigger: ""
actors: []
entrypoints: []
steps:
  - sequence: 1
    component_id: "CMP-0123456789"
    behavior_id: "BHV-0123456789"
    operation: ""
    inputs: []
    outputs: []
    reads: []
    writes: []
    effects: []
    failure_edges: []
terminal_outcomes: []
invariant_ids: []
trust_boundaries: []
```

## Clause

Use kinds `BRANCH`, `ASSERTION`, `RETURN`, `THROW`, `CATCH`, `LOOP_PARTITION`, `MUTATION`, `EXTERNAL_CALL`, `EVENT`, `PARSE`, `DEFAULT`, `SERIALIZE`, `CONFIGURATION`, `ORDERING`, `REPLAY`, `BOUNDARY`, `PROOF`, and `AUTHORIZATION`. Record trigger, outcomes, effects, parent behavior, and static feasibility.

## Invariant

```yaml
id: "INV-0123456789"
stable_key: "invariant:component-key:semantic-slug"
category: "AUTHORIZATION | CONSERVATION | STATE | LIFECYCLE | UNIQUENESS_REPLAY | IDEMPOTENCY | ATOMIC_FAILURE | IO_CONSISTENCY | ARITHMETIC_RANGE | SERIALIZATION | RESOURCE | PROOF_CONTINUITY | COMMITMENT_BINDING | DEPENDENCY"
statement: ""
scope_ids: []
enforcement_sites: []
violation_paths: []
semantic_status: "EXPLICIT | CANDIDATE | PARTIAL | CONFLICTING | UNRESOLVED"
```

Reserve `record_status` for lifecycle. Use type-specific `semantic_status`: invariants use the values above; tests use `STATICALLY_MAPPED`, `PARTIAL_MAPPING`, `CONFLICTING`, or `UNRESOLVED`; findings use `OPEN`, `ACCEPTED`, `DISPUTED`, `RESOLVED_STATICALLY`, or `UNRESOLVED`; behaviors/flows/clauses use `SUPPORTED_STATICALLY`, `INFERRED`, `CONFLICTING`, or `UNRESOLVED`.

## Input/output and relationships

I/O records state producer/consumer, direction, type/schema, validation, default, encoding, trust, sensitivity, cardinality, range, failure behavior, and evidence. Relationship types include `CALLS`, `READS`, `WRITES`, `EMITS`, `AUTHORIZES`, `PROVES`, `VERIFIES`, `DERIVES`, `SERIALIZES`, `DESERIALIZES`, `MAY_FLOW_TO`, `DEPENDS_ON`, `IMPLEMENTS`, `TESTS`, and `BOUND_BY_CONSTRAINT`.

For `MAY_FLOW_TO`, record source, transformations, barriers/sanitizers, sink, interprocedural boundary, and precision limitations.

## Zero-knowledge binding schema

When zero knowledge is `APPLICABLE` or `UNCERTAIN`, every proof-related `IO-*` and every `ZKP-*` record must include:

```yaml
visibility: "PUBLIC | PRIVATE | HOST_ONLY | UNKNOWN"
execution_domain: "HOST | CONSTRAINT | BOTH | UNKNOWN"
name: ""
io_id: "IO-0123456789"
source_ids: []
anchors: []
encoding:
  semantic_type: ""
  field_or_byte_representation: ""
  range_or_canonicality_checks: []
binding:
  constraint_clause_ids: []
  host_effect_ids: []
  relationship_ids: []
  status: "BOUND | PARTIALLY_BOUND | HOST_EFFECT_NOT_PROVEN | UNRESOLVED"
recursion:
  previous_proof_ids: []
  public_input_continuity_ids: []
  verification_key_assumptions: []
proof_modes:
  configured_modes: []
  statically_observed_differences: []
```

`ZKP-*` records state the intended relation, public instance, private witness, constraint-producing operations, host-only computations/effects, proving/verifying boundary, recursion/previous-proof links, key/configuration assumptions, and limitations. A host callback, persistence write, hint, or witness computation is never described as proved merely because it occurs during proof construction. Use relationship type `BOUND_BY_CONSTRAINT` for explicit bindings.

Concretely, each `ZKP-*` has non-empty `values[]`, `constraint_clause_ids`, `host_effects[]`, `proving_boundary`, `verifying_boundary`, `recursion`, `proof_modes`, and `limitations`. Every value has a unique name, source anchors, a proof-related `IO-*`, and the visibility/execution/encoding/binding schema above. The statement separately lists `public_input_io_ids`, `public_output_io_ids`, and `private_input_io_ids`; use an explicit unresolved boundary when one category is genuinely absent or unknown. Each host effect has an anchor, effect text, `constraint_clause_ids`, `relationship_ids`, and `binding_status: HOST_EFFECT_NOT_PROVEN | BOUND | UNRESOLVED`; `BOUND` requires a `BOUND_BY_CONSTRAINT` relationship and exact constraint-clause IDs. Never infer a host persistence or network effect to be constraint-bound.

The inventory records platform indicators mechanically. At minimum, TypeScript scans recognize `ZkProgram`, proof classes, proof verification, `Provable.witness*`, smart-contract bases/decorators, account updates, signatures, tokens, and transaction APIs. The validator independently scans primary inputs for these indicators, reconciles the counts, and forbids `NOT_APPLICABLE` when indicators exist. Each `Provable.witness*` site has a host-effect entry; recursion/proof-verification indicators require non-empty recursion continuity metadata. Proof modes and static limitations are never empty.

## Conflict and staleness lifecycle

```yaml
id: "UNR-0123456789"
kind: "CONFLICT | DYNAMIC | EXTERNAL | GENERATED | TOOL_LIMIT | HUMAN_JUDGMENT"
affected_ids: []
competing_assertion_ids: []
reason: ""
required_context: []
record_status: "CURRENT | STALE | SUPERSEDED | OUT_OF_SCOPE"
semantic_status: "OPEN | RESOLVED | ACCEPTED_LIMITATION"
resolution:
  resolver_work_unit: null
  disposition: null
  replacement_ids: []
  resolved_utc: null
```

`MANIFEST.yaml` stores a content hash for every primary/context input and evidence/output artifact. A changed primary source stales its work unit, owned records, inbound/outbound semantic relationships, dependent flows, and publication pages. A changed context file stales only records that cite it. Preserve superseded records and bundle history.

## Tests

Test records have `source_path` and non-empty `cases[]`. Every case includes name, fixture/setup, `target_ids` (behaviors/clauses/invariants), inputs, asserted outputs/errors/effects, mocks, environment assumptions, `proof_mode`, negative/boundary `partitions`, and static gaps. Use `STATICALLY_MAPPED`, never `PASSED`, unless separate execution evidence is authorized and supplied. File-level presence alone is not a semantic test mapping.

## Findings

Use a SARIF-inspired YAML shape without emitting JSON:

```yaml
id: "FND-0123456789"
stable_key: "finding:component-key:semantic-slug"
rule_id: "QUALITY.STATE.CHECK_BEFORE_WRITE"
category: "correctness | maintainability | reliability | testability | security | documentation"
severity: "INFO | LOW | MEDIUM | HIGH | CRITICAL"
confidence: "HIGH | MEDIUM | LOW"
message: ""
locations: []
related_locations: []
code_flow: []
affected_ids: []
evidence_ids: []
impact: ""
recommendation: ""
limitations: []
```

## Publication

`SPECIFICATION.md` is the single-file overview: scope; business context; system context; components; behaviors; flows; clauses; invariants; I/O; relationships; tests; blockchain/ZK properties; findings; uncertainty; coverage; source accountability.

`CONTEXT.md` is the readable projection of `model/context.yaml`: user evidence and authority, system mission, vocabulary, actors/assets, component map, global flows/invariants, trust boundaries, conflicts, unresolved questions, and Pass-1 coverage. It must not silently resolve disagreement.

`REQUIREMENTS_TRACEABILITY.md` maps every applicable RFC/policy/decision/audit obligation to maturity, rollout stage, implementation, tests, gaps, and author questions. `GAP_ANALYSIS.md` prioritizes business and implementation gaps by consequence and confidence without presenting candidates as confirmed defects. `AUTHOR_REVIEW.md` is a concise checklist of decisions the author should confirm, grouped by business consequence rather than source file.

`CAPACITY_AND_LIVENESS.md` statically explains bounded batch sizes, recursion/aggregation steps, action volumes, lifecycle time budgets, required operators/services, failure/retry/backlog behavior, and assumptions needed to meet participation or governance criteria. Distinguish source-derived bounds from estimates and unresolved runtime measurements; do not run benchmarks or proofs.

Use formal declarative language and the required STE style in
`STE-STYLE.md`. Apply it to all author-facing YAML prose and Markdown. Do not
change YAML keys, enum values, record IDs, file paths, code identifiers, exact
evidence, or quotations. Every factual sentence includes canonical IDs or
evidence links. Mark inference explicitly. Diagrams use stable IDs and labelled
directional edges. Required Mermaid views when applicable:

For a legacy model, mark exact canonical prose as a canonical model projection.
Report its style exceptions separately. A line break does not end a sentence.
Do not report full style conformance when canonical exceptions remain.

- system context;
- package/container/component structure;
- principal runtime/business flows;
- state/lifecycle transitions;
- call/data/trust-boundary relationships;
- smart-contract or proof composition.

Do not draw a view that adds no explanatory value.

## Manifest

`MANIFEST.yaml` maps every output to revision, scope/model hash, represented IDs, and file hash. Validate:

```yaml
schema_version: 1
revision: ""
scope_hash: ""
model_sha256: ""
files:
  - path: "publication/SPECIFICATION.md"
    base: "RUN | REPOSITORY"
    kind: "publication"
    sha256: ""
    represented_ids: []
validation:
  command: ""
  completed_utc: ""
  status: "PASS | FAIL"
```

Validate:

- YAML parses;
- IDs are unique and references resolve;
- evidence anchors exist within scope;
- source-accountability counts reconcile;
- work-unit ownership does not overlap;
- Markdown links resolve;
- Mermaid fenced copies reference valid IDs;
- publication and canonical model counts/statuses agree.

The manifest is exhaustive: include every `SCOPE.yaml` file entry, every YAML evidence/model/work-unit artifact, and every publication Markdown file. `base: REPOSITORY` resolves scoped inputs from the repository root; `base: RUN` resolves analysis artifacts from the run root. Exclude `MANIFEST.yaml` itself because its own digest would be recursive.

Each Markdown content block begins with `<!-- trace: ID[, ID...] -->`. Headings, navigation, glossary definitions, and explicit methodology text may use `<!-- trace: none -->`. Put the marker in the same blank-line-delimited block as its paragraph, table, list, heading, or Mermaid fence. Use stable HTML anchors such as `<a id="bhv-0123456789"></a>` for record sections. The TypeScript validator checks every block, local links, Mermaid identifiers, and model references.
