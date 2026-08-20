import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

assert.ok(process.env.CODEBASE_ANALYSIS_RUN, 'set CODEBASE_ANALYSIS_RUN');
const runRoot = resolve(process.env.CODEBASE_ANALYSIS_RUN);

async function findRepositoryRoot(start: string): Promise<string> {
  let cursor = start;
  while (true) {
    try {
      await stat(join(cursor, '.git'));
      return cursor;
    } catch {}
    const parent = dirname(cursor);
    assert.notEqual(parent, cursor, 'run root is not inside a Git repository');
    cursor = parent;
  }
}

const repositoryRoot = await findRepositoryRoot(runRoot);
assert.ok(runRoot === repositoryRoot || runRoot.startsWith(`${repositoryRoot}${sep}`), 'run root escapes repository');

async function yamlParser(): Promise<(value: string) => any> {
  try {
    const packageName = 'yaml';
    const module: any = await import(packageName);
    if (typeof module.parse === 'function') return module.parse;
  } catch {}
  const packageStore = join(repositoryRoot, 'node_modules', '.pnpm');
  let entries: string[] = [];
  try {
    entries = (await readdir(packageStore)).filter((entry) => entry.startsWith('yaml@')).sort().reverse();
  } catch {}
  for (const entry of entries) {
    try {
      const modulePath = join(packageStore, entry, 'node_modules', 'yaml', 'dist', 'index.js');
      const module: any = await import(pathToFileURL(modulePath).href);
      if (typeof module.parse === 'function') return module.parse;
    } catch {}
  }
  throw new Error('no installed YAML parser; preflight must fail without adding a dependency');
}

const parseYaml = await yamlParser();
const idSource = '(?:PKG|REQ|BR|CMP|SRC|API|BHV|FLW|CL|INV|IO|REL|TST|FND|SEC|THR|ASM|GAP|UNR|EVD|ZKP|AST)-[A-F0-9]{10,}';
const canonicalId = new RegExp(`\\b${idSource}\\b`, 'g');
const canonicalIdExact = new RegExp(`^${idSource}$`);
const recordGroups = ['packages', 'requirements', 'business_rules', 'components', 'sources', 'apis', 'behaviors', 'flows', 'clauses', 'invariants', 'inputs_outputs', 'relations', 'tests', 'findings', 'security_objectives', 'threats', 'assumptions', 'gaps', 'unresolved', 'evidence', 'zk_statements'];
const semanticGroups = new Set(recordGroups.filter((group) => !['packages', 'sources', 'evidence'].includes(group)));
const prefixByGroup: Record<string, string> = { packages: 'PKG', requirements: 'REQ', business_rules: 'BR', components: 'CMP', sources: 'SRC', apis: 'API', behaviors: 'BHV', flows: 'FLW', clauses: 'CL', invariants: 'INV', inputs_outputs: 'IO', relations: 'REL', tests: 'TST', findings: 'FND', security_objectives: 'SEC', threats: 'THR', assumptions: 'ASM', gaps: 'GAP', unresolved: 'UNR', evidence: 'EVD', zk_statements: 'ZKP' };

async function filesBelow(root: string, suffix?: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(path: string) {
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && (!suffix || child.endsWith(suffix))) output.push(child);
    }
  }
  await visit(root);
  return output.sort();
}

function walk(value: any, callback: (value: any, key: string | null) => void, key: string | null = null) {
  callback(value, key);
  if (Array.isArray(value)) for (const child of value) walk(child, callback, key);
  else if (value && typeof value === 'object') for (const [childKey, child] of Object.entries(value)) walk(child, callback, childKey);
}

function sha256(value: string | Buffer) { return createHash('sha256').update(value).digest('hex'); }
function normalizedPath(path: string) { return path.normalize('NFC').replaceAll('\\', '/').replace(/^\.\//, ''); }
async function safeRepositoryPath(path: string) {
  const lexical = resolve(repositoryRoot, path);
  assert.ok(lexical === repositoryRoot || lexical.startsWith(`${repositoryRoot}${sep}`), `path escapes repository: ${path}`);
  const actual = await realpath(lexical);
  const rootActual = await realpath(repositoryRoot);
  assert.ok(actual === rootActual || actual.startsWith(`${rootActual}${sep}`), `realpath escapes repository: ${path}`);
  return actual;
}

const scopePath = join(runRoot, 'SCOPE.yaml');
const scope = parseYaml(await readFile(scopePath, 'utf8'));
const guard = parseYaml(await readFile(join(runRoot, 'READ_ONLY_GUARD.yaml'), 'utf8'));
const pass1Path = join(runRoot, 'model', 'pass-1.yaml');
const pass1Bytes = await readFile(pass1Path);
const pass1 = parseYaml(pass1Bytes.toString('utf8'));
const contextPath = join(runRoot, 'model', 'context.yaml');
const contextBytes = await readFile(contextPath);
const contextModel = parseYaml(contextBytes.toString('utf8'));
const modelPath = join(runRoot, 'model', 'codebase.yaml');
const model = parseYaml(await readFile(modelPath, 'utf8'));
const scopeEntries: any[] = scope?.scope?.files ?? [];
const primaryEntries = scopeEntries.filter((entry) => ['PRIMARY', 'EXPANDED_SCOPE'].includes(entry.role));
const scopedPaths = new Set(scopeEntries.map((entry) => normalizedPath(entry.path)));
const recordsByGroup = new Map<string, any[]>();
const modelIds = new Set<string>();
const evidenceIds = new Set<string>();
const stableKeys = new Set<string>();

for (const group of recordGroups) {
  const records = model?.records?.[group];
  assert.ok(Array.isArray(records), `model.records.${group} must be an array`);
  recordsByGroup.set(group, records);
  for (const record of records) {
    assert.ok(record && typeof record === 'object', `${group} contains a non-record`);
    assert.match(record.id ?? '', canonicalIdExact, `${group} has invalid or missing ID`);
    assert.ok(record.id.startsWith(`${prefixByGroup[group]}-`), `${record.id} has wrong prefix for ${group}`);
    assert.ok(!modelIds.has(record.id), `duplicate canonical ID ${record.id}`);
    modelIds.add(record.id);
    assert.equal(typeof record.stable_key, 'string', `${record.id} lacks stable_key`);
    const stable = record.stable_key.normalize('NFC');
    assert.equal(stable, stable.toLowerCase(), `${record.id} stable_key must be lowercase NFC`);
    assert.ok(!stableKeys.has(stable), `duplicate stable_key ${stable}`);
    stableKeys.add(stable);
    const digest = sha256(stable).slice(0, 10).toUpperCase();
    assert.ok(record.id.startsWith(`${prefixByGroup[group]}-${digest}`), `ID does not match stable_key: ${record.id}`);
    assert.ok(['CURRENT', 'OUT_OF_SCOPE', 'STALE', 'SUPERSEDED'].includes(record.record_status), `${record.id} has invalid lifecycle status`);
    if (semanticGroups.has(group) && record.record_status === 'CURRENT') {
      assert.ok(Array.isArray(record.assertions) && record.assertions.length > 0, `${record.id} requires assertions`);
      for (const assertion of record.assertions) {
        assert.match(assertion.id ?? '', /^AST-[A-F0-9]{10,}$/, `${record.id} assertion lacks canonical AST ID`);
        assert.ok(typeof assertion.stable_key === 'string' && assertion.stable_key === assertion.stable_key.normalize('NFC').toLowerCase(), `${assertion.id} lacks lowercase stable_key`);
        assert.ok(!stableKeys.has(assertion.stable_key), `duplicate stable_key ${assertion.stable_key}`);
        stableKeys.add(assertion.stable_key);
        assert.ok(assertion.id.startsWith(`AST-${sha256(assertion.stable_key).slice(0, 10).toUpperCase()}`), `${assertion.id} does not match stable_key`);
        assert.ok(typeof assertion.text === 'string' && assertion.text.trim(), `${assertion.id} lacks text`);
        assert.ok(['DOCUMENTED_INTENT', 'TEST_EXPECTATION', 'IMPLEMENTED_STATIC', 'INFERRED_BUSINESS_RULE', 'EXTERNAL_STANDARD', 'UNRESOLVED'].includes(assertion.evidence_class), `${assertion.id} invalid evidence class`);
        assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(assertion.confidence), `${assertion.id} invalid confidence`);
        const evidence = assertion.evidence_ids ?? [];
        assert.ok(evidence.length > 0 || (assertion.evidence_class === 'UNRESOLVED' && (record.limitations ?? []).length > 0), `${assertion.id} needs evidence or unresolved limitation`);
      }
    }
    if (group === 'evidence') evidenceIds.add(record.id);
  }
}

walk(model.records, (value, key) => {
  if (key === 'id' && typeof value === 'string') {
    assert.match(value, canonicalIdExact, `malformed nested ID ${value}`);
    if (value.startsWith('AST-')) {
      assert.ok(!modelIds.has(value), `duplicate assertion ID ${value}`);
      modelIds.add(value);
    }
  }
});

test('all YAML parses and canonical references resolve', async () => {
  for (const file of await filesBelow(runRoot, '.yaml')) {
    const content = await readFile(file, 'utf8');
    assert.doesNotThrow(() => parseYaml(content), relative(runRoot, file));
  }
  const serialized = JSON.stringify(model);
  for (const id of serialized.match(canonicalId) ?? []) assert.ok(modelIds.has(id), `unresolved canonical reference ${id}`);
  for (const records of recordsByGroup.values()) for (const record of records) for (const assertion of record.assertions ?? []) {
    for (const id of assertion.evidence_ids ?? []) assert.ok(evidenceIds.has(id), `${assertion.id} references missing evidence ${id}`);
  }
});

test('scope closure and source accountability reconcile', async () => {
  assert.ok(scopeEntries.length > 0, 'SCOPE.yaml has no resolved files');
  const descriptor: string[] = [];
  for (const entry of [...scopeEntries].sort((a, b) => normalizedPath(a.path) < normalizedPath(b.path) ? -1 : normalizedPath(a.path) > normalizedPath(b.path) ? 1 : 0)) {
    assert.ok(['PRIMARY', 'READ_ONLY_CONTEXT', 'EXPANDED_SCOPE'].includes(entry.role), `invalid scope role ${entry.role}`);
    const path = normalizedPath(entry.path);
    assert.equal(path, entry.path, `scope path is not normalized: ${entry.path}`);
    const digest = sha256(await readFile(await safeRepositoryPath(path)));
    assert.equal(entry.sha256, digest, `stale scope file hash: ${path}`);
    descriptor.push(`${entry.role}\0${path}\0${digest}\n`);
  }
  assert.equal(scope.scope.scope_hash, sha256(descriptor.join('')), 'stale aggregate scope hash');
  assert.equal(guard.scope_hash, scope.scope.scope_hash, 'read-only guard scope hash mismatch');
  assert.equal(guard.permitted_repository_write_root, normalizedPath(relative(repositoryRoot, runRoot)), 'read-only guard permits a different write root');
  assert.equal(guard.source_mutation_detected, false, 'read-only guard reports source mutation');
  const guarded = new Map((guard.inputs ?? []).map((entry: any) => [normalizedPath(entry.path), entry.sha256]));
  for (const entry of scopeEntries) assert.equal(guarded.get(normalizedPath(entry.path)), entry.sha256, `read-only guard omits or mismatches ${entry.path}`);
  assert.equal(guarded.size, scopeEntries.length, 'read-only guard contains unexpected inputs');

  const fileRecords = (recordsByGroup.get('sources') ?? []).filter((record) => record.kind === 'file' && record.record_status === 'CURRENT');
  const primaryPaths = new Set(primaryEntries.map((entry) => normalizedPath(entry.path)));
  const recorded = new Map<string, any>();
  for (const record of fileRecords) {
    const path = normalizedPath(record.path);
    assert.ok(!recorded.has(path), `duplicate current SRC file record: ${path}`);
    recorded.set(path, record);
  }
  for (const entry of primaryEntries) {
    const record = recorded.get(normalizedPath(entry.path));
    assert.ok(record, `primary file lacks SRC file record: ${entry.path}`);
    assert.equal(record.source_hash, entry.sha256, `SRC hash mismatch: ${entry.path}`);
  }
  for (const path of recorded.keys()) assert.ok(scopedPaths.has(path), `SRC file outside scope: ${path}`);
  assert.equal(model.coverage?.source?.scoped_primary_files, primaryPaths.size, 'primary coverage count mismatch');
  assert.equal(fileRecords.filter((record) => primaryPaths.has(normalizedPath(record.path))).length, primaryPaths.size, 'source file record coverage mismatch');
  assert.equal(model.coverage?.source?.source_file_records, primaryPaths.size, 'reported source file count mismatch');
  const activeSources = (recordsByGroup.get('sources') ?? []).filter((record) => record.record_status === 'CURRENT');
  const symbolSiteCount = activeSources.filter((record) => record.kind !== 'file').length;
  assert.equal(model.coverage?.source?.symbols_and_sites, symbolSiteCount, 'symbol/site coverage mismatch');
  const significance: Record<string, number> = {};
  for (const record of activeSources) significance[record.significance] = (significance[record.significance] ?? 0) + 1;
  assert.deepEqual(model.coverage?.source?.by_significance, significance, 'significance totals mismatch');
  const unresolvedSources = activeSources.filter((record) => record.significance === 'UNRESOLVED_SIGNIFICANCE').map((record) => record.id).sort();
  assert.deepEqual([...(model.coverage?.source?.unresolved_source_ids ?? [])].sort(), unresolvedSources, 'unresolved source list mismatch');
  const primaryTests = primaryEntries.filter((entry) => /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.path));
  assert.equal(model.coverage?.tests?.scoped_test_files, primaryTests.length, 'scoped test count mismatch');
  const mappedTestPaths = new Set((recordsByGroup.get('tests') ?? []).filter((record) => record.record_status === 'CURRENT' && record.source_path).map((record) => normalizedPath(record.source_path)));
  assert.equal(model.coverage?.tests?.mapped_test_files, mappedTestPaths.size, 'mapped test count mismatch');
  for (const path of mappedTestPaths) assert.ok(primaryTests.some((entry) => normalizedPath(entry.path) === path), `TST maps non-primary test ${path}`);
  assert.equal(mappedTestPaths.size + (model.coverage?.tests?.unmapped_paths ?? []).length, primaryTests.length, 'test mapping coverage does not reconcile');
  assert.equal((model.coverage?.tests?.unmapped_paths ?? []).length, 0, 'final run contains unmapped test files');
  for (const record of (recordsByGroup.get('tests') ?? []).filter((item) => item.record_status === 'CURRENT')) {
    assert.ok((record.cases ?? []).length > 0, `${record.id} lacks test cases`);
    for (const item of record.cases) {
      assert.ok(item.name && (item.target_ids ?? []).length > 0 && (item.assertions ?? []).length > 0, `${record.id} has an unmapped case`);
      assert.ok(Array.isArray(item.partitions) && item.proof_mode, `${record.id}/${item.name} lacks partitions/proof mode`);
    }
  }
});

test('requirements and business/implementation gaps are traceable', () => {
  const requirements = recordsByGroup.get('requirements') ?? [];
  const gaps = new Map((recordsByGroup.get('gaps') ?? []).map((record) => [record.id, record]));
  for (const record of requirements.filter((item) => item.record_status === 'CURRENT')) {
    assert.ok(['NORMATIVE', 'PROVISIONAL', 'OPTIONAL', 'DEFERRED', 'PARAMETERIZED', 'DISPUTED', 'HISTORICAL'].includes(record.requirement_kind), `${record.id} invalid requirement kind`);
    assert.ok(record.authority && record.rollout_stage && record.implementation_status, `${record.id} incomplete traceability`);
    for (const id of record.gap_ids ?? []) assert.ok(gaps.has(id), `${record.id} references missing gap ${id}`);
    if (['PARTIAL', 'NOT_IMPLEMENTED', 'CONFIGURATION_DEPENDENT', 'UNRESOLVED'].includes(record.implementation_status) && !['OPTIONAL', 'DEFERRED', 'HISTORICAL'].includes(record.requirement_kind)) assert.ok((record.gap_ids ?? []).length > 0, `${record.id} implementation status requires a visible gap`);
    if (record.implementation_status === 'IMPLEMENTED') assert.ok((record.implementation_ids ?? []).length > 0, `${record.id} IMPLEMENTED lacks implementation mapping`);
  }
  for (const record of gaps.values()) if (record.record_status === 'CURRENT') {
    assert.ok((record.gap_kinds ?? []).length > 0 && record.materiality && record.business_consequence && record.author_question, `${record.id} incomplete gap record`);
    assert.ok(['OPEN', 'ACCEPTED', 'RESOLVED_STATICALLY', 'DISPUTED', 'UNRESOLVED'].includes(record.semantic_status), `${record.id} invalid gap status`);
  }
});

test('Pass 2 reinterprets every Pass-1 semantic record with global context', async () => {
  assert.equal(contextModel.schema_version, 1);
  assert.equal(contextModel.scope_hash, scope.scope.scope_hash, 'context pack scope mismatch');
  assert.equal(contextModel.pass_1_sha256, sha256(pass1Bytes), 'context pack does not bind Pass 1');
  for (const key of ['mission', 'glossary', 'actors_roles_assets', 'authority_map', 'components_apis', 'lifecycle_state', 'principal_flows', 'global_invariants', 'security_objectives', 'threat_model', 'assumptions', 'trust_deployment', 'blockchain_zk', 'test_strategy', 'decisions', 'conflicts', 'unresolved']) assert.ok(Array.isArray(contextModel.system?.[key]), `context pack lacks system.${key}`);
  assert.ok((contextModel.system?.mission ?? []).length > 0, 'context pack lacks system mission');
  assert.ok((contextModel.system?.components_apis ?? []).length > 0, 'context pack lacks component/API map');
  const pass1Ids = new Set<string>();
  for (const group of semanticGroups) for (const record of pass1?.records?.[group] ?? []) if (record.record_status === 'CURRENT') pass1Ids.add(record.id);
  const represented = new Set(contextModel.coverage?.represented_record_ids ?? []);
  const omitted = new Set((contextModel.coverage?.omitted_with_rationale ?? []).map((item: any) => item.id));
  assert.deepEqual(new Set(contextModel.coverage?.pass_1_record_ids ?? []), pass1Ids, 'context pack Pass-1 universe mismatch');
  for (const id of pass1Ids) assert.ok(represented.has(id) || omitted.has(id), `context pack omits ${id}`);
  for (const item of contextModel.coverage?.omitted_with_rationale ?? []) assert.ok(item.rationale, `context omission ${item.id} lacks rationale`);

  const authorities = new Map((scope.authorities?.documents ?? []).map((item: any) => [normalizedPath(item.path), item]));
  for (const input of contextModel.user_context_inputs ?? []) {
    const authority: any = authorities.get(normalizedPath(input.path));
    assert.ok(authority, `unregistered user context ${input.path}`);
    assert.equal(input.sha256, authority.sha256, `user context hash mismatch ${input.path}`);
    assert.equal(input.authority, authority.authority, `user context authority mismatch ${input.path}`);
    assert.ok((input.evidence_ids ?? []).length > 0, `user context ${input.path} lacks evidence mapping`);
    if (input.kind === 'PRIOR_AUDIT') {
      const extracted = input.audit_metadata?.extracted_finding_ids ?? [];
      assert.ok(extracted.length > 0 || input.audit_metadata?.no_findings_rationale, `prior audit ${input.path} lacks extracted findings or rationale`);
      for (const id of extracted) {
        const finding = (recordsByGroup.get('findings') ?? []).find((record) => record.id === id);
        assert.ok(finding?.origin === 'PRIOR_AUDIT', `prior audit item ${id} is missing or has wrong origin`);
      }
    }
  }
  assert.equal((contextModel.user_context_inputs ?? []).length, authorities.size, 'not every registered user context reached the context pack');
  const pass1Components = new Set((pass1?.records?.components ?? []).filter((record: any) => record.record_status === 'CURRENT').map((record: any) => record.id));
  const indexedComponents = new Set((contextModel.component_index ?? []).map((item: any) => item.component_id));
  assert.deepEqual(indexedComponents, pass1Components, 'context pack component index mismatch');

  const reviewedPass1 = new Map<string, string>();
  let eligible = 0;
  const dispositions: Record<string, number> = {};
  for (const group of semanticGroups) for (const record of recordsByGroup.get(group) ?? []) if (record.record_status === 'CURRENT') {
    eligible++;
    const review = record.contextual_review;
    assert.ok(review && ['CONFIRMED', 'REFINED', 'CONTRADICTED', 'UNRESOLVED'].includes(review.disposition), `${record.id} lacks Pass-2 disposition`);
    assert.ok(review.reviewer_work_unit_id && review.rationale && Array.isArray(review.assumptions_added) && Array.isArray(review.assumptions_removed) && Array.isArray(review.global_consequences), `${record.id} has incomplete contextual review`);
    assert.ok((review.pass_1_record_ids ?? []).length > 0, `${record.id} contextual review lacks Pass-1 lineage`);
    for (const id of review.pass_1_record_ids) {
      assert.ok(pass1Ids.has(id), `${record.id} cites unknown Pass-1 record ${id}`);
      const identity = JSON.stringify([review.disposition, review.reviewer_work_unit_id, review.rationale, [...(review.replacement_ids ?? [])].sort()]);
      if (reviewedPass1.has(id)) assert.equal(reviewedPass1.get(id), identity, `Pass-1 record has inconsistent repeated decision: ${id}`);
      else reviewedPass1.set(id, identity);
    }
    assert.ok((review.context_ids ?? []).length > 0, `${record.id} contextual review lacks global context`);
    dispositions[review.disposition] = (dispositions[review.disposition] ?? 0) + 1;
  }
  assert.deepEqual(new Set(reviewedPass1.keys()), pass1Ids, 'Pass-2 coverage does not exactly cover Pass 1');
  assert.equal(model.coverage?.contextual_review?.eligible_records, eligible, 'contextual eligible count mismatch');
  assert.equal(model.coverage?.contextual_review?.reviewed_records, eligible, 'contextual reviewed count mismatch');
  assert.deepEqual(model.coverage?.contextual_review?.by_disposition, dispositions, 'contextual disposition counts mismatch');
  assert.deepEqual(model.coverage?.contextual_review?.unreviewed_ids ?? [], [], 'unreviewed semantic records remain');
});

test('anchors are exact, scoped, and repository-contained', async () => {
  const anchors: any[] = [];
  walk(model, (value, key) => { if (key === 'anchors' && Array.isArray(value)) anchors.push(...value); });
  for (const anchor of anchors) {
    assert.ok(anchor?.path && Number.isInteger(anchor.start_line) && Number.isInteger(anchor.end_line), 'anchor requires path/start_line/end_line');
    const path = normalizedPath(anchor.path);
    assert.ok(scopedPaths.has(path) || path.startsWith(`${normalizedPath(relative(repositoryRoot, runRoot))}/`), `anchor not in scope/artifacts: ${path}`);
    const content = await readFile(await safeRepositoryPath(path), 'utf8');
    const lines = content.split(/\r?\n/).length;
    assert.ok(anchor.start_line >= 1 && anchor.start_line <= lines, path);
    assert.ok(anchor.end_line >= anchor.start_line && anchor.end_line <= lines, path);
  }
});

test('work-unit ownership is disjoint and auditable', async () => {
  const pathOwners = new Map<string, string>();
  const recordOwners = new Map<string, string>();
  for (const file of await filesBelow(join(runRoot, 'work-units'), '.yaml')) {
    const unit = (parseYaml(await readFile(file, 'utf8'))).work_unit;
    assert.match(unit.id ?? '', /^WU-[A-F0-9]{10,}$/, `${basename(file)} invalid work-unit ID`);
    for (const rawPath of unit.primary_paths ?? []) {
      const path = normalizedPath(rawPath);
      assert.ok(scopedPaths.has(path), `${unit.id} primary path outside scope: ${path}`);
      assert.ok(!pathOwners.has(path), `${path} owned by ${pathOwners.get(path)} and ${unit.id}`);
      pathOwners.set(path, unit.id);
    }
    for (const id of unit.owned_record_ids ?? []) {
      assert.ok(!recordOwners.has(id), `${id} owned by ${recordOwners.get(id)} and ${unit.id}`);
      recordOwners.set(id, unit.id);
    }
    assert.ok(unit.output, `${unit.id} lacks output bundle path`);
    const output = resolve(runRoot, unit.output);
    assert.ok(output.startsWith(`${runRoot}${sep}`), `${unit.id} output escapes run root`);
    assert.ok((await stat(output)).isFile(), `${unit.id} output is not a file`);
  }
});

test('mandatory zkSecurity-inspired security review is complete and traceable', () => {
  const objectives = (recordsByGroup.get('security_objectives') ?? []).filter((record) => record.record_status === 'CURRENT');
  const threats = (recordsByGroup.get('threats') ?? []).filter((record) => record.record_status === 'CURRENT');
  const assumptions = (recordsByGroup.get('assumptions') ?? []).filter((record) => record.record_status === 'CURRENT');
  const findings = (recordsByGroup.get('findings') ?? []).filter((record) => record.record_status === 'CURRENT');
  assert.ok(objectives.length > 0, 'security review lacks current SEC objectives');
  assert.ok(threats.length > 0, 'security review lacks current THR hypotheses');
  assert.ok(assumptions.length > 0, 'security review lacks current ASM assumptions');

  for (const record of objectives) {
    assert.ok(record.protected_property && (record.asset_actor_ids ?? []).length > 0, `${record.id} lacks protected property/assets`);
    assert.ok((record.enforcement_ids ?? []).length + (record.gaps_or_unresolved_ids ?? []).length > 0, `${record.id} lacks enforcement or visible gap`);
    for (const id of [...(record.requirement_rule_ids ?? []), ...(record.enforcement_ids ?? []), ...(record.invariant_ids ?? []), ...(record.threat_ids ?? []), ...(record.assumption_ids ?? []), ...(record.gaps_or_unresolved_ids ?? [])]) assert.ok(modelIds.has(id), `${record.id} references missing ${id}`);
  }
  for (const record of threats) {
    assert.ok(record.category && (record.actors ?? []).length > 0 && (record.assets ?? []).length > 0, `${record.id} lacks category/actors/assets`);
    assert.ok((record.entrypoints ?? []).length > 0 && (record.preconditions ?? []).length > 0 && (record.adverse_sequence ?? []).length > 0, `${record.id} lacks a reviewable adverse sequence`);
    assert.ok((record.affected_objective_ids ?? []).length > 0 && (record.affected_record_ids ?? []).length > 0 && record.static_reasoning, `${record.id} lacks objective/record mapping or reasoning`);
    assert.ok(['CANDIDATE', 'MITIGATED_STATICALLY', 'PARTIALLY_MITIGATED', 'UNRESOLVED', 'NOT_APPLICABLE'].includes(record.disposition), `${record.id} invalid threat disposition`);
    for (const id of [...record.affected_objective_ids, ...record.affected_record_ids, ...(record.assumption_ids ?? []), ...(record.finding_ids ?? [])]) assert.ok(modelIds.has(id), `${record.id} references missing ${id}`);
  }
  for (const record of assumptions) {
    assert.ok(['TRUST', 'ENVIRONMENT', 'DEPENDENCY', 'CONFIGURATION', 'DEPLOYMENT', 'OPERATOR', 'AVAILABILITY', 'PROTOCOL', 'CRYPTOGRAPHIC', 'OTHER'].includes(record.category), `${record.id} invalid assumption category`);
    assert.ok(['DOCUMENTED', 'IMPLEMENTATION_DEPENDENCY', 'TEST_FIXTURE', 'INFERRED', 'UNKNOWN'].includes(record.source), `${record.id} invalid assumption source`);
    assert.ok(['ENFORCED', 'RELIED_UPON', 'PARTIALLY_ENFORCED', 'UNRESOLVED', 'CONTRADICTED'].includes(record.semantic_status), `${record.id} invalid assumption status`);
    assert.ok((record.affected_record_ids ?? []).length > 0 && record.failure_consequence, `${record.id} lacks affected records/failure consequence`);
    for (const id of [...record.affected_record_ids, ...(record.validation_or_enforcement_ids ?? [])]) assert.ok(modelIds.has(id), `${record.id} references missing ${id}`);
  }
  for (const record of findings) {
    assert.ok(record.category && ['INFORMATIONAL', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(record.severity), `${record.id} lacks category/severity`);
    assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(record.confidence), `${record.id} invalid finding confidence`);
    assert.ok(Array.isArray(record.prerequisites) && record.root_cause && record.impact && record.recommendation && Array.isArray(record.scope_limitations), `${record.id} incomplete root-cause finding`);
    const links = [...(record.security_objective_ids ?? []), ...(record.threat_ids ?? []), ...(record.assumption_ids ?? [])];
    assert.ok(links.length > 0 || record.no_security_link_rationale, `${record.id} lacks security links or rationale`);
    for (const id of links) assert.ok(modelIds.has(id), `${record.id} references missing ${id}`);
  }

  const requiredClasses = [
    'MISSING_CHECK_OR_BINDING', 'STATE_OR_FAILURE_POLICY', 'IDENTITY_OR_PRIVILEGE', 'REPLAY_ORDER_OR_CONCURRENCY',
    'ARITHMETIC_OR_ENCODING', 'UNTRUSTED_DATA_FLOW', 'PRODUCER_CONSUMER_ASYMMETRY', 'DEPENDENCY_OR_CONFIGURATION',
    'INFORMATION_EXPOSURE', 'RESOURCE_OR_LIVENESS', 'OBSERVABILITY_OR_RECOVERY', 'TEST_ORACLE_BLIND_SPOT',
    'REQUIREMENT_OR_AUDIT_DRIFT', 'SMART_CONTRACT_OR_ZK'
  ];
  assert.equal(model.security_review?.methodology, 'zksecurity_inspired_static_whole_system');
  const matrix = model.security_review?.failure_classes ?? [];
  assert.deepEqual(new Set(matrix.map((item: any) => item.class)), new Set(requiredClasses), 'known-failure-class matrix mismatch');
  for (const item of matrix) {
    assert.ok(['APPLICABLE_REVIEWED', 'NOT_APPLICABLE', 'UNRESOLVED'].includes(item.disposition) && item.rationale, `failure class ${item.class} incomplete`);
    for (const id of item.record_ids ?? []) assert.ok(modelIds.has(id), `failure class ${item.class} references missing ${id}`);
  }
  for (const key of ['protocol_overview_ids', 'local_review_ids', 'composed_review_ids']) {
    assert.ok((model.security_review?.[key] ?? []).length > 0, `security review lacks ${key}`);
    for (const id of model.security_review[key]) assert.ok(modelIds.has(id), `security review ${key} references missing ${id}`);
  }
  assert.equal(model.coverage?.security_review?.current_objectives, objectives.length, 'security objective count mismatch');
  assert.equal(model.coverage?.security_review?.current_threats, threats.length, 'threat count mismatch');
  assert.equal(model.coverage?.security_review?.current_assumptions, assumptions.length, 'assumption count mismatch');
  assert.equal(model.coverage?.security_review?.reviewed_failure_classes, requiredClasses.length, 'failure-class count mismatch');
});

test('platform applicability and ZK field-level coverage are source-bound', async () => {
  const allowedApplicability = ['APPLICABLE', 'NOT_APPLICABLE', 'UNCERTAIN'];
  assert.equal(model.applicability?.general, 'APPLICABLE');
  for (const key of ['blockchain', 'smart_contract', 'zero_knowledge']) assert.ok(allowedApplicability.includes(model.applicability?.[key]), `invalid applicability.${key}`);
  const indicators = { blockchain: 0, smart_contract: 0, zero_knowledge: 0, witness: 0, recursion: 0, proofMode: 0 };
  const witnessSites = new Set<string>();
  for (const entry of primaryEntries) {
    const content = await readFile(await safeRepositoryPath(entry.path), 'utf8');
    indicators.zero_knowledge += [...content.matchAll(/\b(?:ZkProgram|SelfProof|DynamicProof|Provable\.(?:witness|witnessAsync)|\.verify\s*\()/g)].length;
    indicators.witness += [...content.matchAll(/\bProvable\.(?:witness|witnessAsync)\s*\(/g)].length;
    for (const match of content.matchAll(/\bProvable\.(?:witness|witnessAsync)\s*\(/g)) witnessSites.add(`${normalizedPath(entry.path)}:${content.slice(0, match.index).split(/\r?\n/).length}`);
    indicators.recursion += [...content.matchAll(/\b(?:SelfProof|DynamicProof)|\.verify\s*\(/g)].length;
    indicators.smart_contract += [...content.matchAll(/\b(?:SmartContract|AccountUpdate|@method)\b|\bpragma\s+solidity\b/g)].length;
    indicators.blockchain += [...content.matchAll(/\b(?:AccountUpdate|PublicKey|Signature|TokenId|transaction|blockchain)\b/g)].length;
    indicators.proofMode += [...content.matchAll(/\bPROOFS_ENABLED\b|proofsEnabled\s*:/g)].length;
  }
  for (const key of ['blockchain', 'smart_contract', 'zero_knowledge'] as const) {
    assert.equal(model.coverage?.platform_indicators?.[key], indicators[key], `${key} indicator count mismatch`);
    if (indicators[key] > 0) assert.notEqual(model.applicability[key], 'NOT_APPLICABLE', `${key} indicators forbid NOT_APPLICABLE`);
  }
  const zkRelevant = indicators.zero_knowledge > 0 || ['APPLICABLE', 'UNCERTAIN'].includes(model.applicability.zero_knowledge);
  if (!zkRelevant) return;
  const zk = (recordsByGroup.get('zk_statements') ?? []).filter((item) => item.record_status === 'CURRENT');
  assert.ok(zk.length > 0, 'zero-knowledge applicability requires current ZKP records');
  const io = new Map((recordsByGroup.get('inputs_outputs') ?? []).map((record) => [record.id, record]));
  const relations = new Map((recordsByGroup.get('relations') ?? []).map((record) => [record.id, record]));
  const representedValues = new Set<string>();
  let representedHostEffects = 0;
  const representedHostSites = new Set<string>();
  for (const record of zk) {
    assert.ok((record.values ?? []).length > 0, `${record.id} lacks field-level values`);
    for (const value of record.values) {
      assert.ok(typeof value.name === 'string' && value.name.trim(), `${record.id} value lacks name`);
      assert.ok(!representedValues.has(value.name), `duplicate ZK value name ${value.name}`);
      representedValues.add(value.name);
      assert.ok((value.source_ids ?? []).length > 0 && (value.anchors ?? []).length > 0, `${record.id}/${value.name} lacks sources/anchors`);
      assert.ok(io.get(value.io_id)?.proof_related === true, `${record.id}/${value.name} lacks proof-related IO record`);
      assert.ok(['PUBLIC', 'PRIVATE', 'HOST_ONLY', 'UNKNOWN'].includes(value.visibility), `${record.id} invalid visibility`);
      assert.ok(['HOST', 'CONSTRAINT', 'BOTH', 'UNKNOWN'].includes(value.execution_domain), `${record.id} invalid execution domain`);
      assert.ok(value.encoding?.semantic_type && value.encoding?.field_or_byte_representation, `${record.id} value lacks encoding`);
      assert.ok(['BOUND', 'PARTIALLY_BOUND', 'HOST_EFFECT_NOT_PROVEN', 'UNRESOLVED'].includes(value.binding?.status), `${record.id} invalid binding status`);
      for (const id of value.binding?.constraint_clause_ids ?? []) assert.ok(id.startsWith('CL-') && modelIds.has(id), `${record.id} invalid constraint clause ${id}`);
      for (const id of value.binding?.relationship_ids ?? []) assert.equal(relations.get(id)?.type, 'BOUND_BY_CONSTRAINT', `${record.id} binding relation is not BOUND_BY_CONSTRAINT: ${id}`);
      assert.ok((value.binding.constraint_clause_ids ?? []).length + (value.binding.host_effect_ids ?? []).length + (value.binding.relationship_ids ?? []).length > 0 || value.binding.status === 'UNRESOLVED', `${record.id} value lacks binding evidence`);
      if (value.binding.status === 'BOUND') assert.ok((value.binding.constraint_clause_ids ?? []).length > 0 && (value.binding.relationship_ids ?? []).length > 0, `${record.id}/${value.name} BOUND lacks clause and relationship evidence`);
    }
    for (const category of ['public_input_io_ids', 'public_output_io_ids', 'private_input_io_ids']) {
      assert.ok(Array.isArray(record[category]), `${record.id} lacks ${category}`);
      for (const id of record[category]) assert.ok(io.get(id)?.proof_related === true, `${record.id} ${category} has invalid IO ${id}`);
    }
    const categorized = new Set([...record.public_input_io_ids, ...record.public_output_io_ids, ...record.private_input_io_ids]);
    for (const value of record.values) if (value.visibility === 'PUBLIC' || value.visibility === 'PRIVATE') assert.ok(categorized.has(value.io_id), `${record.id}/${value.name} missing from interface category`);
    assert.ok((record.constraint_clause_ids ?? []).length > 0, `${record.id} lacks statement constraint clauses`);
    for (const id of record.constraint_clause_ids) assert.ok(id.startsWith('CL-') && modelIds.has(id), `${record.id} invalid statement clause ${id}`);
    assert.ok(record.proving_boundary && record.verifying_boundary, `${record.id} lacks proving/verifying boundaries`);
    assert.ok(Array.isArray(record.host_effects) && record.host_effects.length > 0, `${record.id} lacks host_effects`);
    representedHostEffects += record.host_effects.length;
    for (const effect of record.host_effects) {
      assert.ok((effect.anchors ?? []).length > 0 && effect.effect, `${record.id} host effect lacks anchor/text`);
      for (const anchor of effect.anchors ?? []) representedHostSites.add(`${normalizedPath(anchor.path)}:${anchor.start_line}`);
      assert.ok(['HOST_EFFECT_NOT_PROVEN', 'BOUND', 'UNRESOLVED'].includes(effect.binding_status), `${record.id} invalid host effect status`);
      if (effect.binding_status === 'BOUND') {
        assert.ok((effect.constraint_clause_ids ?? []).length > 0 && (effect.relationship_ids ?? []).length > 0, `${record.id} bound host effect lacks binding evidence`);
        for (const id of effect.constraint_clause_ids) assert.ok(id.startsWith('CL-') && modelIds.has(id), `${record.id} invalid host-effect clause ${id}`);
        for (const id of effect.relationship_ids) assert.equal(relations.get(id)?.type, 'BOUND_BY_CONSTRAINT', `${record.id} host effect relation is not BOUND_BY_CONSTRAINT`);
      }
    }
    assert.ok(record.recursion && record.proof_modes && (record.proof_modes.configured_modes ?? []).length > 0, `${record.id} lacks proof-mode fields`);
    assert.ok(record.proof_modes.configured_modes.includes('STATIC_ONLY'), `${record.id} must preserve static-only analysis mode`);
    if (indicators.proofMode > 0) assert.ok(record.proof_modes.configured_modes.some((mode: string) => /PROOFS_ENABLED/.test(mode)), `${record.id} omits source-visible proof mode`);
    if (indicators.recursion > 0) assert.ok((record.recursion.previous_proof_ids ?? []).length + (record.recursion.public_input_continuity_ids ?? []).length > 0, `${record.id} lacks recursion continuity`);
    assert.ok(Array.isArray(record.limitations) && record.limitations.length > 0, `${record.id} requires static-analysis limitations`);
  }
  assert.ok(representedHostEffects >= indicators.witness, `host effects ${representedHostEffects} do not cover ${indicators.witness} witness sites`);
  for (const site of witnessSites) assert.ok(representedHostSites.has(site), `unmapped witness host site ${site}`);
  assert.deepEqual(new Set(model.coverage?.zk?.represented_value_ids ?? []), new Set([...representedValues]), 'ZK value coverage list mismatch');
  assert.equal(model.coverage?.zk?.discovered_value_boundaries, representedValues.size + (model.coverage?.zk?.unresolved_value_boundaries ?? []).length, 'ZK value boundary coverage does not reconcile');
  for (const record of io.values()) if (record.proof_related === true && record.record_status === 'CURRENT') {
    assert.ok(['PUBLIC', 'PRIVATE', 'HOST_ONLY', 'UNKNOWN'].includes(record.visibility), `${record.id} invalid proof IO visibility`);
    assert.ok(['HOST', 'CONSTRAINT', 'BOTH', 'UNKNOWN'].includes(record.execution_domain), `${record.id} invalid proof IO execution domain`);
    assert.ok(record.encoding?.semantic_type && record.encoding?.field_or_byte_representation, `${record.id} proof IO lacks encoding`);
    assert.ok(['BOUND', 'PARTIALLY_BOUND', 'HOST_EFFECT_NOT_PROVEN', 'UNRESOLVED'].includes(record.binding?.status), `${record.id} invalid proof IO binding`);
    assert.ok((record.anchors ?? []).length > 0, `${record.id} proof IO lacks source anchor`);
    assert.ok([...representedValues].some((name) => zk.some((statement) => statement.values.some((value: any) => value.name === name && value.io_id === record.id))), `${record.id} is not linked from a ZKP value`);
  }
});

test('Markdown blocks, links, Mermaid, and IDs are traceable', async () => {
  const publication = join(runRoot, 'publication');
  for (const required of ['README.md', 'SUMMARY.md', 'SPECIFICATION.md', 'CONTEXT.md', 'REQUIREMENTS_TRACEABILITY.md', 'GAP_ANALYSIS.md', 'AUTHOR_REVIEW.md', 'CAPACITY_AND_LIVENESS.md', 'THREAT_MODEL.md', 'ASSUMPTIONS_AND_LIMITS.md', 'SECURITY_REVIEW.md', 'BUSINESS_LOGIC.md', 'ARCHITECTURE.md', 'FLOWS.md', 'INVARIANTS.md', 'INPUTS_OUTPUTS.md', 'TEST_MAP.md', 'STATIC_FINDINGS.md', 'UNRESOLVED.md']) assert.ok((await stat(join(publication, required))).isFile(), `missing publication/${required}`);
  for (const file of await filesBelow(publication, '.md')) {
    const content = await readFile(file, 'utf8');
    const blocks = content.split(/\r?\n\s*\r?\n/).filter((block) => block.trim());
    for (const block of blocks) {
      assert.match(block.trimStart(), /^<!-- trace: (?:none|[^>]+) -->/, `${relative(runRoot, file)} has untraced block: ${block.slice(0, 40)}`);
      const marker = block.match(/^\s*<!-- trace: ([^>]+) -->/);
      if (marker?.[1].trim() !== 'none') assert.match(marker?.[1] ?? '', new RegExp(idSource), `${basename(file)} has noncanonical trace marker`);
      for (const id of marker?.[1].match(canonicalId) ?? []) assert.ok(modelIds.has(id), `${basename(file)} trace: ${id}`);
      for (const id of block.match(canonicalId) ?? []) assert.ok(modelIds.has(id), `${basename(file)} content: ${id}`);
      if (/```mermaid/.test(block)) {
        const diagram = block.slice(block.indexOf('```mermaid'));
        for (const line of diagram.split(/\r?\n/).slice(1, -1).filter((line) => /-->|---|\[|\(|\{/.test(line))) {
          assert.match(line, new RegExp(idSource), `${basename(file)} Mermaid line lacks canonical ID: ${line}`);
        }
      }
    }
    for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|#)/.test(target)) continue;
      const path = resolve(dirname(file), target.split('#')[0]);
      await stat(path);
    }
  }
});

test('manifest exhaustively binds inputs and outputs', async () => {
  const status = parseYaml(await readFile(join(runRoot, 'STATUS.yaml'), 'utf8'));
  const workerCount = status?.topology?.worker_count ?? 0;
  if (workerCount > 0) assert.ok((await filesBelow(join(runRoot, 'work-units'), '.yaml')).length > 0, 'worker topology lacks work-unit files');
  assert.ok((await filesBelow(join(runRoot, 'evidence'), '.yaml')).length > 0, 'run lacks durable evidence bundles');
  const manifestPath = join(runRoot, 'MANIFEST.yaml');
  const manifest = parseYaml(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.scope_hash, scope.scope.scope_hash);
  assert.equal(manifest.model_sha256, sha256(await readFile(modelPath)), 'stale model_sha256');
  assert.equal(manifest.validation?.status, 'PASS');
  const represented = new Set<string>();
  for (const entry of manifest.files ?? []) {
    assert.ok(['RUN', 'REPOSITORY'].includes(entry.base), `manifest entry lacks valid base: ${entry.path}`);
    const base = entry.base === 'RUN' ? runRoot : repositoryRoot;
    const path = resolve(base, entry.path);
    assert.ok(path === base || path.startsWith(`${base}${sep}`), `manifest path escapes base: ${entry.path}`);
    assert.equal(entry.sha256, sha256(await readFile(path)), `stale manifest hash: ${entry.path}`);
    represented.add(`${entry.base}:${normalizedPath(entry.path)}`);
    for (const id of entry.represented_ids ?? []) assert.ok(modelIds.has(id), `${entry.path}: ${id}`);
  }
  for (const entry of scopeEntries) assert.ok(represented.has(`REPOSITORY:${normalizedPath(entry.path)}`), `manifest omits scoped input ${entry.path}`);
  for (const path of [...await filesBelow(runRoot, '.yaml'), ...await filesBelow(join(runRoot, 'publication'), '.md')]) {
    if (path === manifestPath) continue;
    const rel = normalizedPath(relative(runRoot, path));
    assert.ok(represented.has(`RUN:${rel}`), `manifest omits run artifact ${rel}`);
  }
});
