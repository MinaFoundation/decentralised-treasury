import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type O = Record<string, any>;
type Column = { heading: string; value: (record: O) => unknown };
type StyleIssue = { file: string; line: number; location: 'PROSE' | 'TABLE_CELL'; kind: 'CONTRACTION' | 'LONG_DESCRIPTION' | 'LONG_INSTRUCTION'; words: number; text: string };
type TechnicalValueException = { file: string; line: number; record_id?: string; field?: string; kind: StyleIssue['kind']; words: number; text: string };

const ID_SOURCE = '(?:PKG|REQ|BR|CMP|SRC|API|BHV|FLW|CL|INV|IO|REL|TST|FND|SEC|THR|ASM|GAP|UNR|EVD|ZKP|AST)-[A-F0-9]{10,}';
const ID = new RegExp(`^${ID_SOURCE}$`);
const ID_GLOBAL = new RegExp(ID_SOURCE, 'g');
const HASH_GLOBAL = /\b[a-f0-9]{40,64}\b/gi;
const URL_GLOBAL = /https?:\/\/\S+/gi;
const GROUPS = [
  'packages', 'requirements', 'business_rules', 'components', 'sources', 'apis', 'behaviors', 'flows', 'clauses',
  'invariants', 'inputs_outputs', 'relations', 'tests', 'findings', 'security_objectives', 'threats', 'assumptions',
  'gaps', 'unresolved', 'evidence', 'zk_statements',
] as const;
const SEMANTIC_GROUPS = GROUPS.filter((group) => !['packages', 'sources', 'evidence'].includes(group));
const GROUP_TITLES: Record<string, string> = {
  requirements: 'Requirements', business_rules: 'Business rules', components: 'Components', apis: 'APIs', behaviors: 'Behaviors',
  flows: 'Flows', clauses: 'Clauses', invariants: 'Invariants', inputs_outputs: 'Inputs and outputs', relations: 'Relationships',
  tests: 'Tests', findings: 'Findings', security_objectives: 'Security objectives', threats: 'Threats', assumptions: 'Assumptions',
  gaps: 'Gaps', unresolved: 'Unresolved records', zk_statements: 'Zero-knowledge statements',
};
const TOP_LEVEL_FILES = [
  'README.md', 'index.md', 'SUMMARY.md', 'SPECIFICATION.md', 'CONTEXT.md', 'REQUIREMENTS_TRACEABILITY.md',
  'GAP_ANALYSIS.md', 'AUTHOR_REVIEW.md', 'CAPACITY_AND_LIVENESS.md', 'THREAT_MODEL.md', 'ASSUMPTIONS_AND_LIMITS.md',
  'SECURITY_REVIEW.md', 'BUSINESS_LOGIC.md', 'ARCHITECTURE.md', 'FLOWS.md', 'INVARIANTS.md', 'INPUTS_OUTPUTS.md',
  'TEST_MAP.md', 'STATIC_FINDINGS.md', 'UNRESOLVED.md',
];
const CONTEXT_SECTIONS = [
  'mission', 'glossary', 'actors_roles_assets', 'authority_map', 'components_apis', 'lifecycle_state', 'principal_flows',
  'global_invariants', 'security_objectives', 'threat_model', 'assumptions', 'trust_deployment', 'blockchain_zk',
  'test_strategy', 'decisions', 'conflicts', 'unresolved',
];
const CONTEXT_TITLES: Record<string, string> = {
  mission: 'Mission', glossary: 'Glossary', actors_roles_assets: 'Actors, roles, and assets', authority_map: 'Authority map',
  components_apis: 'Components and APIs', lifecycle_state: 'Lifecycle and state model', principal_flows: 'Principal flows',
  global_invariants: 'Global invariant candidates', security_objectives: 'Security objectives', threat_model: 'Threat model',
  assumptions: 'Assumptions', trust_deployment: 'Trust and deployment boundaries',
  blockchain_zk: 'Blockchain and zero-knowledge model', test_strategy: 'Static test strategy', decisions: 'Decisions and competing interpretations',
  conflicts: 'Preserved conflicts', unresolved: 'Unresolved context',
};

const parseArgs = () => {
  const values = process.argv.slice(2);
  if (values.length !== 6 || values.some((value, index) => index % 2 === 0 && !['--model', '--context', '--out'].includes(value))) {
    throw new Error('usage: generate-publication.mts --model FILE --context FILE --out /tmp/NEW_DIRECTORY');
  }
  const parsed: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) parsed[values[index]] = values[index + 1];
  if (!parsed['--model'] || !parsed['--context'] || !parsed['--out']) throw new Error('model, context, and output are required');
  return parsed;
};

const args = parseArgs();
const modelPath = resolve(args['--model']);
const contextPath = resolve(args['--context']);
const out = resolve(args['--out']);
if (!existsSync(modelPath) || !existsSync(contextPath)) throw new Error('model and context files must exist');
if (extname(modelPath) !== '.yaml' || extname(contextPath) !== '.yaml') throw new Error('model and context inputs must be YAML files');
if (dirname(out) !== '/tmp' || existsSync(out)) throw new Error('output must be a new direct child directory of /tmp');

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const pnpm = join(repository, 'node_modules/.pnpm');
const yamlInstalls = readdirSync(pnpm).filter((name) => name.startsWith('yaml@2.')).sort();
if (yamlInstalls.length !== 1) throw new Error(`expected one installed YAML 2 package, found ${yamlInstalls.length}`);
const yamlModule = join(pnpm, yamlInstalls[0], 'node_modules/yaml/dist/index.js');
if (!existsSync(yamlModule)) throw new Error(`installed YAML module is missing: ${yamlModule}`);
const YAML: any = await import(pathToFileURL(yamlModule).href);

const model = YAML.parse(readFileSync(modelPath, 'utf8')) as O;
const context = YAML.parse(readFileSync(contextPath, 'utf8')) as O;
const runRoot = resolve(dirname(modelPath), '..');
const publicationPath = relative(repository, join(runRoot, 'publication')).replaceAll(sep, '/');
const scopePath = join(runRoot, 'SCOPE.yaml');
if (!existsSync(scopePath)) throw new Error(`scope file is missing: ${scopePath}`);
const scope = YAML.parse(readFileSync(scopePath, 'utf8')) as O;
const records = model.records as O;
for (const group of GROUPS) if (!Array.isArray(records?.[group])) throw new Error(`model.records.${group} must be an array`);
if (context.scope_hash !== scope.scope?.scope_hash) throw new Error('context and scope hashes do not match');
for (const key of CONTEXT_SECTIONS) if (!Array.isArray(context.system?.[key])) throw new Error(`context.system.${key} must be an array`);

const current = (group: string) => (records[group] as O[]).filter((record) => record.record_status === 'CURRENT');
const allRecords = Object.values(records).flat() as O[];
const byId = new Map<string, O>(allRecords.map((record) => [record.id, record]));
const modelIds = new Set<string>(allRecords.map((record) => record.id));
for (const record of allRecords) for (const assertion of record.assertions ?? []) modelIds.add(assertion.id);
const semantic = SEMANTIC_GROUPS.flatMap(current);
const eligibleIds = new Set(semantic.map((record) => record.id));

const allowedReviews = new Set(['CONFIRMED', 'REFINED', 'CONTRADICTED', 'UNRESOLVED']);
for (const record of semantic) {
  const review = record.contextual_review;
  if (!allowedReviews.has(review?.disposition) || !review?.rationale || !review?.reviewer_work_unit_id || !(review.pass_1_record_ids?.length > 0) || !(review.context_ids?.length > 0)) {
    throw new Error(`record ${record.id} has no complete Pass-2 review`);
  }
}
const reportedReview = model.coverage?.contextual_review;
if (reportedReview?.eligible_records !== semantic.length || reportedReview?.reviewed_records !== semantic.length || (reportedReview?.unreviewed_ids ?? []).length !== 0) {
  throw new Error(`Pass-2 coverage does not match ${semantic.length} current semantic records`);
}
const phase6 = model.phase_6_integration;
const phase6Reviews = Array.isArray(phase6?.reviews) ? phase6.reviews : [];
const phase6Roles = new Set(phase6Reviews.map((entry: O) => entry.reviewer_role));
if (phase6?.status !== 'COMPLETE' || !['business', 'challenge', 'security'].every((role) => phase6Roles.has(role))) {
  throw new Error('Phase 6 must contain complete business, challenge, and security reviews');
}
const phase7 = model.phase_7_traceability_corrections;
if (phase7?.status !== 'COMPLETE' || phase7.semantic_assertion_changes !== 0 || phase7.effective_conclusion_changes !== 0 || phase7.contextual_review_changes !== 0) {
  throw new Error('Phase 7 must preserve assertions, conclusions, and contextual reviews');
}

const arr = (value: unknown): any[] => Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
const unique = <T,>(values: T[]) => [...new Set(values)];
const clean = (value: unknown) => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').replaceAll('|', '\\|').trim();
const idsIn = (value: unknown) => unique((JSON.stringify(value).match(ID_GLOBAL) ?? []).filter((id) => modelIds.has(id)));
const title = (record: O) => clean(record.title || record.name || record.term || record.question || record.reason || record.message || record.statement || record.rule || record.protected_property || record.intended_relation || record.business_consequence || record.failure_consequence || record.stable_key || record.id);
const conclusion = (record: O) => clean(record.effective_static_conclusion || record.effective_conclusion || record.summary || record.statement || record.rule || record.protected_property || record.intended_relation || record.message || record.business_consequence || record.failure_consequence || record.reason || record.assertions?.[0]?.text || 'The YAML model contains the full record.');
const status = (record: O) => clean(record.semantic_status || record.implementation_status || record.disposition || record.severity || record.category || record.kind || record.flow_scope || record.record_status);
const firstAnchor = (record: O) => {
  const anchor = arr(record.anchors)[0];
  if (anchor?.path) return `${anchor.path}:${anchor.start_line ?? '?'}-${anchor.end_line ?? '?'}`;
  return clean(record.source_path || record.path);
};
const compact = (value: unknown): string => {
  if (value == null || value === '') return 'None recorded.';
  if (typeof value !== 'object') return clean(value);
  if (Array.isArray(value)) return value.length ? value.map(compact).join('<br>') : 'None recorded.';
  const object = value as O;
  const key = ['id', 'title', 'name', 'term', 'statement', 'property', 'objective', 'threat', 'assumption', 'boundary', 'role', 'asset', 'state_model', 'transition', 'decision', 'issue', 'question', 'matter', 'reason', 'conclusion', 'rationale', 'operation'].find((candidate) => object[candidate] != null);
  if (key) return clean(object[key]);
  const refs = idsIn(object);
  return refs.length ? refs.join(', ') : clean(Object.keys(object).join(', '));
};
const mermaid = (value: unknown) => clean(value).replaceAll('"', '&quot;').replaceAll('|', '&#124;').replaceAll('[', '(').replaceAll(']', ')');
const htmlAnchor = (id: string) => `<a id="${id.toLowerCase()}"></a>`;
const marker = (ids: string[]) => `<!-- trace: ${unique(ids.filter((id) => ID.test(id) && modelIds.has(id))).join(', ') || 'none'} -->`;
const block = (ids: string[], content: string) => `${marker(unique([...ids, ...idsIn(content)]))}\n${content.trim()}`;
const document = (blocks: string[]) => `${blocks.filter(Boolean).join('\n\n')}\n`;
const technicalValuePrefix = '[Exact technical value; STE length exception] ';
const instructionStart = /^(?:please\s+)?(?:ask|check|compare|confirm|decide|define|explain|inspect|keep|map|measure|open|provide|read|record|resolve|review|run|select|state|test|treat|use|verify|do\b)/i;
const contraction = /\b(?:ain't|aren't|can't|couldn't|didn't|doesn't|don't|hadn't|hasn't|haven't|he'll|he's|here's|how's|i'd|i'll|i'm|i've|isn't|it's|let's|mightn't|mustn't|shan't|she'll|she's|shouldn't|that's|there's|they'd|they'll|they're|they've|wasn't|we'd|we'll|we're|we've|weren't|what's|where's|who's|won't|wouldn't|you'd|you'll|you're|you've)\b/i;
const textSentences = (value: string) => value
  // A <br> controls page layout. It does not end a sentence.
  .replace(/<br>/g, ' ')
  .replace(ID_GLOBAL, '')
  .replace(HASH_GLOBAL, '')
  .replace(URL_GLOBAL, '')
  .replace(/`[^`]*`/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/^[-*]\s+/, '')
  .trim()
  .split(/(?<=[.!?])\s+/)
  .map((part) => part.trim())
  .filter(Boolean);
const valueStyleKinds = (value: string): { kind: StyleIssue['kind']; words: number; text: string }[] => textSentences(value).flatMap((sentence) => {
  const words = sentence.match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  const kinds: StyleIssue['kind'][] = [];
  if (contraction.test(sentence)) kinds.push('CONTRACTION');
  const limit = instructionStart.test(sentence) ? 20 : 25;
  if (words > limit) kinds.push(limit === 20 ? 'LONG_INSTRUCTION' : 'LONG_DESCRIPTION');
  return kinds.map((kind) => ({ kind, words, text: sentence }));
});
const tableCell = (value: unknown) => {
  const source = compact(value);
  // Technical prose is evidence. The generator must not rewrite it by a general
  // rule, because that could change a technical condition or conclusion.
  // The visible label makes each such exception clear to the reader.
  return valueStyleKinds(source).length ? `${technicalValuePrefix}${source}` : source;
};
const table = (headers: string[], rows: unknown[][]) => [
  `| ${headers.join(' | ')} |`,
  `| ${headers.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${row.map(tableCell).join(' | ')} |`),
].join('\n');
const list = (items: unknown[]) => items.length ? items.map((item) => `- ${compact(item)}`).join('\n') : '- None recorded.';
const specLink = (record: O, fromChild = false) => `[${record.id}](${fromChild ? '../' : ''}SPECIFICATION.md#${record.id.toLowerCase()})`;
const evidenceCell = (record: O) => {
  const assertions = arr(record.assertions).map((assertion: O) => assertion.id);
  const evidence = unique(arr(record.assertions).flatMap((assertion: O) => arr(assertion.evidence_ids)));
  return `${assertions.length} assertion(s): ${assertions.join(', ') || 'none'}<br>Evidence: ${evidence.join(', ') || 'none'}`;
};
const reviewCell = (record: O, includeRationale = false) => {
  const review = record.contextual_review;
  return includeRationale ? `${review.disposition}. ${clean(review.rationale)}` : review.disposition;
};
const rowsFor = (items: O[], columns: Column[]) => items.map((record) => columns.map((column) => column.value(record)));
const recordTable = (items: O[], columns: Column[]) => table(columns.map((column) => column.heading), rowsFor(items, columns));
const basicColumns = (fromChild = false): Column[] => [
  { heading: 'ID', value: (record) => specLink(record, fromChild) },
  { heading: 'Topic', value: title },
  { heading: 'Status', value: status },
  { heading: 'Static conclusion', value: conclusion },
  { heading: 'Pass 2', value: (record) => reviewCell(record) },
];
const traceIds = (items: O[]) => unique(items.flatMap((record) => [record.id, ...idsIn(record)]));

const packages = current('packages');
const components = current('components');
const flows = current('flows');
const relations = current('relations');
const findings = current('findings');
const gaps = current('gaps');
const unresolved = current('unresolved');
const localFlows = flows.filter((flow) => flow.flow_scope === 'LOCAL');
const crossFlows = flows.filter((flow) => flow.flow_scope === 'CROSS_COMPONENT');
const resolvedFinding = (record: O) => ['RESOLVED_STATICALLY', 'ACCEPTED'].includes(record.semantic_status) || record.current_revision_disposition === 'REMEDIATED_STATICALLY';
const actionableFindings = findings.filter((record) => !resolvedFinding(record));
const resolvedFindings = findings.filter(resolvedFinding);
const actionableGaps = gaps.filter((record) => !['RESOLVED_STATICALLY', 'ACCEPTED'].includes(record.semantic_status));
const severityRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4, INFORMATIONAL: 4 };
actionableFindings.sort((left, right) => (severityRank[left.severity] ?? 9) - (severityRank[right.severity] ?? 9) || left.id.localeCompare(right.id));
actionableGaps.sort((left, right) => (severityRank[left.materiality] ?? 9) - (severityRank[right.materiality] ?? 9) || left.id.localeCompare(right.id));
const counts = Object.fromEntries(GROUPS.map((group) => [group, current(group).length]));

const packageDiagram = ['```mermaid', 'flowchart TB'];
for (const [index, item] of packages.entries()) packageDiagram.push(`  P${index}["${mermaid(title(item))} ${item.id}"]`);
for (const [index, component] of components.entries()) {
  packageDiagram.push(`  C${index}["${mermaid(title(component))} ${component.id}"]`);
  if (packages[0]) packageDiagram.push(`  P0 -->|"contains ${component.id}"| C${index}`);
}
packageDiagram.push('```');

const contextSubjects = arr(context.system.actors_roles_assets).flatMap((entry: O) => [...arr(entry.actors), ...arr(entry.assets)]).filter((entry: O) => idsIn(entry).length);
const systemDiagram = ['```mermaid', 'flowchart LR'];
if (packages[0]) systemDiagram.push(`  SYS["${mermaid(title(packages[0]))} ${packages[0].id}"]`);
for (const [index, subject] of contextSubjects.entries()) {
  const trace = idsIn(subject)[0];
  systemDiagram.push(`  U${index}["${mermaid(compact(subject))} ${trace}"]`);
  if (packages[0]) systemDiagram.push(`  U${index} ---|"context ${trace}"| SYS`);
}
systemDiagram.push('```');

const lifecycleEntry = arr(context.system.lifecycle_state).find((entry: O) => /->/.test(entry.state_model ?? ''));
const lifecycleTrace = idsIn(lifecycleEntry)[0];
const lifecycleStates = lifecycleEntry ? String(lifecycleEntry.state_model).split(/\s*->\s*/).map(clean) : [];
const lifecycleDiagram = lifecycleStates.length > 1 ? [
  '```mermaid', 'flowchart LR',
  ...lifecycleStates.map((state, index) => `  L${index}["${mermaid(state)} ${lifecycleTrace}"]`),
  ...lifecycleStates.slice(1).map((_state, index) => `  L${index} -->|"transition ${lifecycleTrace}"| L${index + 1}`),
  '```',
].join('\n') : '';

const principalFlowDiagram = ['```mermaid', 'flowchart LR'];
for (const [index, component] of components.entries()) principalFlowDiagram.push(`  PC${index}["${mermaid(title(component))} ${component.id}"]`);
for (const [index, flow] of flows.entries()) {
  principalFlowDiagram.push(`  PF${index}["${mermaid(title(flow))} ${flow.id}"]`);
  const ownerIndex = components.findIndex((component) => component.id === flow.owner_component_id);
  if (ownerIndex >= 0) principalFlowDiagram.push(`  PC${ownerIndex} -->|"owns ${flow.id}"| PF${index}`);
}
principalFlowDiagram.push('```');

const diagramRelations = relations.filter((relation) => ID.test(relation.from_id ?? '') && ID.test(relation.to_id ?? '') && ['CALLS', 'READS', 'WRITES', 'MAY_FLOW_TO', 'AUTHORIZES', 'DEPENDS_ON', 'PROVES', 'VERIFIES', 'BOUND_BY_CONSTRAINT'].includes(relation.type || relation.relation_type));
const relationNodes = unique(diagramRelations.flatMap((relation) => [relation.from_id, relation.to_id]));
const relationDiagram = ['```mermaid', 'flowchart LR'];
for (const [index, id] of relationNodes.entries()) relationDiagram.push(`  R${index}["${mermaid(title(byId.get(id) ?? { id, title: id }))} ${id}"]`);
for (const relation of diagramRelations) relationDiagram.push(`  R${relationNodes.indexOf(relation.from_id)} -->|"${mermaid(relation.type || relation.relation_type)} ${relation.id}"| R${relationNodes.indexOf(relation.to_id)}`);
relationDiagram.push('```');
const proofRelations = diagramRelations.filter((relation) => ['PROVES', 'VERIFIES', 'BOUND_BY_CONSTRAINT'].includes(relation.type || relation.relation_type) || relation.from_id?.startsWith('ZKP-') || relation.to_id?.startsWith('ZKP-'));
const proofNodes = unique(proofRelations.flatMap((relation) => [relation.from_id, relation.to_id]));
const proofDiagram = ['```mermaid', 'flowchart LR'];
for (const [index, id] of proofNodes.entries()) proofDiagram.push(`  Z${index}["${mermaid(title(byId.get(id) ?? { id, title: id }))} ${id}"]`);
for (const relation of proofRelations) proofDiagram.push(`  Z${proofNodes.indexOf(relation.from_id)} -->|"${mermaid(relation.type || relation.relation_type)} ${relation.id}"| Z${proofNodes.indexOf(relation.to_id)}`);
proofDiagram.push('```');

const flowDiagram = (flow: O) => {
  const steps = arr(flow.steps);
  const lines = ['```mermaid', 'flowchart LR'];
  for (const [index, step] of steps.entries()) {
    const trace = step.behavior_id || step.component_id || flow.id;
    lines.push(`  S${index}["${index + 1}. ${mermaid(step.operation)} ${trace}"]`);
    if (index) lines.push(`  S${index - 1} -->|"next ${flow.id}"| S${index}`);
  }
  for (const [index, outcome] of arr(flow.terminal_outcomes).entries()) {
    lines.push(`  O${index}["${mermaid(outcome)} ${flow.id}"]`);
    if (steps.length) lines.push(`  S${steps.length - 1} -->|"outcome ${flow.id}"| O${index}`);
  }
  lines.push('```');
  return lines.join('\n');
};

const contextRows = (entries: O[]) => entries.map((entry) => {
  const subjectKey = ['statement', 'term', 'component', 'state_model', 'transition', 'competing_interpretation', 'name', 'property', 'objective', 'threat', 'assumption', 'boundary', 'classification', 'decision', 'issue', 'question'].find((key) => entry?.[key] != null);
  const subject = subjectKey ? entry[subjectKey] : compact(entry);
  const qualifier = [entry.evidence_class, entry.authority, entry.status, entry.semantic_status, entry.trusted_or_enforced, entry.unresolved].filter(Boolean).map(clean).join('; ');
  return [subject, qualifier || 'See the canonical context record.', arr(entry.refs).join(', ')];
});

const docs = new Map<string, string>();
const put = (path: string, blocks: string[]) => {
  if (docs.has(path) || posix.isAbsolute(path) || path.split('/').includes('..') || !path.endsWith('.md')) throw new Error(`unsafe or duplicate publication path: ${path}`);
  docs.set(path, document(blocks));
};
const section = (heading: string, items: O[], columns = basicColumns()) => block(traceIds(items), `## ${heading}\n${recordTable(items, columns)}`);

put('README.md', [
  block([], '# Static Codebase Analysis'),
  block(semantic.map((record) => record.id), 'This publication explains the pinned source model. The YAML model is authoritative.'),
  block([...actionableFindings.map((record) => record.id), ...actionableGaps.map((record) => record.id)], 'The analysis is static. It does not prove runtime behavior, deployed state, test results, cryptographic soundness, or exploitability.'),
  block([], 'The generator applies a limited style check. The check is not an ASD-STE100 certification.'),
  block([], 'Tables can show exact technical values that exceed the sentence limits. The exception label identifies each value.'),
  block([], '## Preview\nRun the local preview server from the repository root.'),
  block([], `\`\`\`bash\nnode --experimental-strip-types .agents/skills/codebase-analysis/scripts/preview-publication.mts ${publicationPath}\n\`\`\``),
  block([], 'Open `http://127.0.0.1:3000`. The server renders Mermaid diagrams when the CDN is available.'),
  block([], 'You can also use **Markdown: Open Preview** in VS Code.'),
  block([], `## Pages\n${list(TOP_LEVEL_FILES.filter((path) => !['README.md', 'index.md'].includes(path)).map((path) => `[${path.replace('.md', '').replaceAll('_', ' ')}](${path})`))}`),
  block([], `Pinned revision: \`${clean(scope.run?.revision)}\`. Scope hash: \`${clean(scope.scope?.scope_hash)}\`.`),
]);
put('index.md', [
  block([], '# Static Codebase Analysis'),
  block([], 'Use the summary first. Use the specification for the complete semantic index.'),
  block([], list(['[Executive summary](SUMMARY.md)', '[Comprehensive specification](SPECIFICATION.md)', '[Author review](AUTHOR_REVIEW.md)', '[Page index](README.md)'])),
]);

const phase6Priorities = arr(phase6.aggregate_author_priorities);
const phase6LaterAssurance = arr(phase6.aggregate_later_assurance);
put('SUMMARY.md', [
  block(semantic.map((record) => record.id), '# Executive Summary'),
  block(components.map((record) => record.id), `The model has ${counts.components} components, ${counts.apis} APIs, ${counts.behaviors} behaviors, ${localFlows.length} local flows and ${crossFlows.length} cross-component flows.`),
  block([...actionableFindings.map((record) => record.id), ...actionableGaps.map((record) => record.id), ...unresolved.map((record) => record.id)], `The model has ${actionableFindings.length} actionable findings, ${resolvedFindings.length} resolved findings, ${actionableGaps.length} actionable gaps, and ${unresolved.length} unresolved records.`),
  block(idsIn(context.system.mission), `## What the system is for\n${table(['Statement', 'Class or authority', 'Trace'], contextRows(arr(context.system.mission)))}`),
  block(idsIn(context.system.glossary), `## Glossary\n${table(['Term', 'Meaning or class', 'Trace'], contextRows(arr(context.system.glossary)))}`),
  block(idsIn(context.system.actors_roles_assets), `## Principal actors and protected assets\n${table(['Actor or asset', 'Role or status', 'Trace'], contextRows(arr(context.system.actors_roles_assets).flatMap((entry: O) => [...arr(entry.actors), ...arr(entry.assets)])))}`),
  block(idsIn(context.system.lifecycle_state), `## Principal lifecycle\n${table(['State model', 'Class or status', 'Trace'], contextRows(arr(context.system.lifecycle_state)))}`),
  block(idsIn(context.system.global_invariants), `## Critical invariant candidates\n${table(['Property', 'Class or status', 'Trace'], contextRows(arr(context.system.global_invariants)))}`),
  block(idsIn(phase6Reviews), `## Orthogonal whole-system challenge\n${table(['Review', 'Disposition', 'Reviewed records', 'Qualifications', 'Limits'], phase6Reviews.map((entry: O) => [entry.reviewer_role, entry.review?.overall_disposition, entry.review?.reviewed_universe?.semantic_records_reviewed, arr(entry.review?.qualifications).length, compact(entry.review?.limitations)]))}`),
  block(idsIn(phase7), `## Guarded traceability corrections after QA challenge\n${table(['Status', 'Changed records', 'Changed fields', 'Assertion changes', 'Conclusion changes', 'Review changes'], [[phase7.status, phase7.changed_record_count, phase7.changed_field_count, phase7.semantic_assertion_changes, phase7.effective_conclusion_changes, phase7.contextual_review_changes]])}`),
  block(idsIn(phase6Priorities), `## Highest-priority author decisions from the whole-system challenge\n${table(['Priority', 'Decision', 'Records', 'Question'], phase6Priorities.map((entry: O) => [entry.priority || entry.materiality || 'UNRANKED', entry.title, arr(entry.record_ids).join(', '), entry.question]))}`),
  section('Current actionable findings', actionableFindings, basicColumns()),
  section('Actionable gaps', actionableGaps, basicColumns()),
  section('Unresolved boundaries', unresolved, basicColumns()),
  block(components.map((record) => record.id), `## Component pages\n${list(components.map((record) => `[${title(record)} — ${record.id}](components/${record.id}.md#${record.id.toLowerCase()})`))}`),
  block(flows.map((record) => record.id), `## Flow pages\n${list(flows.map((record) => `[${title(record)} — ${record.id}](flows/${record.id}.md#${record.id.toLowerCase()})`))}`),
]);

const contextBlocks = [
  block(idsIn(context.user_context_inputs), '# Global System Context'),
  block(idsIn(context.user_context_inputs), `## User-supplied context and authority\n${table(['Path', 'Kind', 'Authority', 'Hash', 'Trace'], arr(context.user_context_inputs).map((entry: O) => [entry.path, entry.kind, entry.authority, entry.sha256, [...arr(entry.applicability_ids), ...arr(entry.evidence_ids)].join(', ')]))}`),
];
for (const key of CONTEXT_SECTIONS) contextBlocks.push(block(idsIn(context.system[key]), `## ${CONTEXT_TITLES[key]}\n${table(['Topic', 'Class or status', 'Trace'], contextRows(arr(context.system[key])))}`));
contextBlocks.push(block(idsIn(context.component_index), `## Component-to-context index\n${table(['Component', 'Context', 'Neighbors'], arr(context.component_index).map((entry: O) => [entry.component_id, arr(entry.relevant_context_ids).join(', '), arr(entry.neighboring_component_ids).join(', ')]))}`));
contextBlocks.push(block(idsIn(context.coverage), `## Pass-1 context coverage\n${table(['Pass-1 records', 'Represented records', 'Explained omissions'], [[arr(context.coverage?.pass_1_record_ids).length, arr(context.coverage?.represented_record_ids).length, compact(context.coverage?.omitted_with_rationale)]])}`));
put('CONTEXT.md', contextBlocks);

put('ARCHITECTURE.md', [
  block([...packages.map((record) => record.id), ...idsIn(contextSubjects)], `# Architecture\n${systemDiagram.join('\n')}`),
  block([...packages.map((record) => record.id), ...components.map((record) => record.id)], `## Packages and components\n${packageDiagram.join('\n')}`),
  block(flows.map((record) => record.id), `## Principal flows\n${principalFlowDiagram.join('\n')}`),
  block(traceIds(diagramRelations), `## Call, data, and trust relationships\n${relationDiagram.join('\n')}`),
  block(traceIds(proofRelations), `## Proof composition\n${proofDiagram.join('\n')}`),
  section('Components', components),
  section('APIs', current('apis')),
]);

const phase6Business = phase6Reviews.find((entry: O) => entry.reviewer_role === 'business');
put('BUSINESS_LOGIC.md', [
  block([...current('requirements'), ...current('business_rules'), ...current('behaviors')].map((record) => record.id), '# Business Logic'),
  block(idsIn(phase6Business), `## Whole-system business review\n${table(['Disposition', 'Reviewed records', 'Qualifications', 'Limits'], [[phase6Business?.review?.overall_disposition, phase6Business?.review?.reviewed_universe?.semantic_records_reviewed, arr(phase6Business?.review?.qualifications).length, compact(phase6Business?.review?.limitations)]])}`),
  section('Requirements', current('requirements')),
  section('Business rules', current('business_rules')),
  section('Behaviors', current('behaviors')),
]);

put('REQUIREMENTS_TRACEABILITY.md', [
  block(current('requirements').map((record) => record.id), '# Requirements Traceability'),
  block(traceIds(current('requirements')), recordTable(current('requirements'), [
    { heading: 'ID', value: (record) => specLink(record) }, { heading: 'Requirement', value: title },
    { heading: 'Kind', value: (record) => record.requirement_kind }, { heading: 'Authority', value: (record) => record.authority },
    { heading: 'Rollout', value: (record) => record.rollout_stage }, { heading: 'Implementation', value: (record) => record.implementation_status },
    { heading: 'Code', value: (record) => arr(record.implementation_ids).join(', ') }, { heading: 'Tests', value: (record) => arr(record.test_ids).join(', ') },
    { heading: 'Gaps', value: (record) => arr(record.gap_ids).join(', ') }, { heading: 'Author question', value: (record) => record.author_question },
  ])),
]);

const flowBlocks = [
  block(flows.map((record) => record.id), '# Flows'),
  block(flows.map((record) => record.id), `The model has ${localFlows.length} local flows and ${crossFlows.length} cross-component flows.`),
  ...(lifecycleDiagram ? [block(idsIn(lifecycleEntry), `## Lifecycle view\n${lifecycleDiagram}`)] : []),
  block(flows.map((record) => record.id), `## Principal flow view\n${principalFlowDiagram.join('\n')}`),
  section('Flow index', flows),
];
for (const flow of flows) flowBlocks.push(block([flow.id, ...idsIn(flow.steps), ...idsIn(flow.terminal_outcomes)], `## ${title(flow)} — ${flow.id}\n${flowDiagram(flow)}`));
put('FLOWS.md', flowBlocks);

put('INVARIANTS.md', [
  block(current('invariants').map((record) => record.id), '# Invariant Candidates'),
  block(current('invariants').map((record) => record.id), 'These records state static candidates. Runtime execution and proof verification remain outside this analysis.'),
  section('Invariant index', current('invariants'), [
    { heading: 'ID', value: (record) => specLink(record) }, { heading: 'Category', value: (record) => record.category },
    { heading: 'Statement', value: (record) => record.statement }, { heading: 'Status', value: (record) => record.semantic_status },
    { heading: 'Enforcement', value: (record) => arr(record.enforcement_sites).join(', ') }, { heading: 'Violation paths', value: (record) => arr(record.violation_paths).join(', ') },
    { heading: 'Pass 2', value: (record) => reviewCell(record) },
  ]),
]);

put('INPUTS_OUTPUTS.md', [
  block([...current('inputs_outputs'), ...relations].map((record) => record.id), '# Inputs, Outputs, and Relationships'),
  section('Inputs and outputs', current('inputs_outputs'), [
    { heading: 'ID', value: (record) => specLink(record) }, { heading: 'Name', value: title },
    { heading: 'Direction', value: (record) => record.direction }, { heading: 'Domain', value: (record) => record.execution_domain },
    { heading: 'Type', value: (record) => record.type_schema }, { heading: 'Validation', value: (record) => compact(record.validation) },
    { heading: 'Pass 2', value: (record) => reviewCell(record) },
  ]),
  section('Relationships', relations, [
    { heading: 'ID', value: (record) => specLink(record) }, { heading: 'Type', value: (record) => record.type || record.relation_type },
    { heading: 'From', value: (record) => record.from_id }, { heading: 'To', value: (record) => record.to_id },
    { heading: 'Precision', value: (record) => record.precision }, { heading: 'Pass 2', value: (record) => reviewCell(record) },
  ]),
]);

put('TEST_MAP.md', [
  block(current('tests').map((record) => record.id), '# Static Test Map'),
  block(current('tests').map((record) => record.id), 'The analysis read tests as expectation evidence. It did not run tests or target code.'),
  section('Test suites', current('tests'), [
    { heading: 'ID', value: (record) => specLink(record) }, { heading: 'Suite', value: title },
    { heading: 'Source', value: (record) => record.source_path }, { heading: 'Cases', value: (record) => arr(record.cases).length },
    { heading: 'Targets', value: (record) => arr(record.target_ids).join(', ') }, { heading: 'Proof mode', value: (record) => record.proof_mode },
    { heading: 'Status', value: (record) => record.semantic_status }, { heading: 'Pass 2', value: (record) => reviewCell(record) },
  ]),
  block(idsIn(phase6LaterAssurance), `## Prioritized later assurance plan\n${table(['Review', 'Activity', 'Records', 'Required evidence'], phase6LaterAssurance.map((entry: O) => [entry.reviewer_role, entry.title || entry.activity || entry.kind || entry.conclusion, arr(entry.record_ids).join(', '), entry.expected_evidence || entry.required || entry.rationale || entry.question]))}`),
]);

put('STATIC_FINDINGS.md', [
  block(findings.map((record) => record.id), '# Static Findings'),
  block(actionableFindings.map((record) => record.id), 'Severity depends on the listed prerequisites. Static analysis does not show runtime exploitability.'),
  section('Actionable findings', actionableFindings, [
    { heading: 'ID', value: (record) => specLink(record) }, { heading: 'Severity', value: (record) => record.severity },
    { heading: 'Confidence', value: (record) => record.confidence }, { heading: 'Finding', value: title },
    { heading: 'Prerequisites', value: (record) => compact(record.prerequisites) }, { heading: 'Root cause', value: (record) => record.root_cause },
    { heading: 'Impact', value: (record) => record.impact }, { heading: 'Recommendation', value: (record) => record.recommendation },
    { heading: 'Limits', value: (record) => compact(record.scope_limitations) },
  ]),
  section('Resolved or remediated findings', resolvedFindings),
]);

put('GAP_ANALYSIS.md', [
  block(gaps.map((record) => record.id), '# Business and Implementation Gaps'),
  section('Gap register', gaps, [
    { heading: 'ID', value: (record) => specLink(record) }, { heading: 'Materiality', value: (record) => record.materiality },
    { heading: 'Kinds', value: (record) => arr(record.gap_kinds).join(', ') }, { heading: 'Gap', value: title },
    { heading: 'Consequence', value: (record) => record.business_consequence }, { heading: 'Question', value: (record) => record.author_question },
    { heading: 'Status', value: (record) => record.semantic_status }, { heading: 'Pass 2', value: (record) => reviewCell(record) },
  ]),
]);

put('UNRESOLVED.md', [
  block(unresolved.map((record) => record.id), '# Unresolved Boundaries'),
  section('Unresolved register', unresolved, [
    { heading: 'ID', value: (record) => specLink(record) }, { heading: 'Kind', value: (record) => record.kind },
    { heading: 'Boundary', value: title }, { heading: 'Reason', value: (record) => record.reason },
    { heading: 'Required context', value: (record) => compact(record.required_context) }, { heading: 'Pass 2', value: (record) => reviewCell(record, true) },
  ]),
]);

const questions = [
  ...phase6Priorities.map((entry: O) => ({ id: idsIn(entry)[0], priority: entry.priority || entry.materiality, topic: entry.title, consequence: entry.rationale, question: entry.question })),
  ...current('requirements').filter((record) => record.author_question).map((record) => ({ id: record.id, priority: record.rollout_stage, topic: title(record), consequence: record.rationale, question: record.author_question })),
  ...actionableGaps.filter((record) => record.author_question).map((record) => ({ id: record.id, priority: record.materiality, topic: title(record), consequence: record.business_consequence, question: record.author_question })),
  ...current('assumptions').filter((record) => record.author_question).map((record) => ({ id: record.id, priority: record.semantic_status, topic: title(record), consequence: record.failure_consequence, question: record.author_question })),
];
put('AUTHOR_REVIEW.md', [
  block(questions.map((entry) => entry.id).filter(Boolean), '# Author Review'),
  block(idsIn(phase6Priorities), `## Prioritized decisions from fresh whole-system review\n${table(['Priority', 'Decision', 'Records', 'Question'], phase6Priorities.map((entry: O) => [entry.priority || entry.materiality || 'UNRANKED', entry.title, arr(entry.record_ids).join(', '), entry.question]))}`),
  block(idsIn(phase7.residual_unresolved), `## Residual traceability or fixture limits after guarded correction\n${table(['Work unit', 'Residual limit'], arr(phase7.residual_unresolved).map((entry: O) => [entry.work_unit, compact(entry)]))}`),
  block(questions.map((entry) => entry.id).filter(Boolean), `## Decision checklist\n${table(['Priority or stage', 'Record', 'Topic', 'Consequence', 'Question'], questions.map((entry) => [entry.priority, entry.id, entry.topic, entry.consequence, entry.question]))}`),
  block(idsIn(context.system.conflicts), `## Preserved conflicts\n${table(['Conflict', 'Trace'], contextRows(arr(context.system.conflicts)).map((row) => [row[0], row[2]]))}`),
]);

const capacityRecords = semantic.filter((record) => /availability|capacity|liveness|resource|throughput|batch|recurs|action volume|deadline|retry|backlog|expiry|operator|proof job|atomic|recovery|duration|slot/i.test(JSON.stringify(record)));
put('CAPACITY_AND_LIVENESS.md', [
  block(capacityRecords.map((record) => record.id), '# Capacity and Liveness'),
  block(idsIn(context.system.lifecycle_state), `## Lifecycle limits\n${table(['State or transition', 'Class or status', 'Trace'], contextRows(arr(context.system.lifecycle_state)))}`),
  section('Proof statements', current('zk_statements'), [
    { heading: 'ID', value: (record) => specLink(record) }, { heading: 'Statement', value: title },
    { heading: 'Relation', value: (record) => record.intended_relation }, { heading: 'Values', value: (record) => arr(record.values).length },
    { heading: 'Constraint clauses', value: (record) => arr(record.constraint_clause_ids).join(', ') }, { heading: 'Limits', value: (record) => compact(record.limitations) },
  ]),
  section('Capacity and liveness records', capacityRecords),
  block([], '## Static-only limits\nThe analysis did not run benchmarks, target TypeScript, tests, proofs, chains, or applications. Runtime throughput, proof latency, backlog capacity, retry safety, and deadline fit remain unresolved measurements.'),
]);

put('THREAT_MODEL.md', [
  block(current('threats').map((record) => record.id), '# Whole-System Threat Model'),
  section('Threats and adverse states', current('threats'), [
    { heading: 'ID', value: (record) => specLink(record) }, { heading: 'Category', value: (record) => record.category },
    { heading: 'Threat', value: title }, { heading: 'Preconditions', value: (record) => compact(record.preconditions) },
    { heading: 'Reasoning', value: (record) => record.static_reasoning }, { heading: 'Disposition', value: (record) => record.disposition },
    { heading: 'Limits', value: (record) => compact(record.limitations) },
  ]),
]);
put('ASSUMPTIONS_AND_LIMITS.md', [
  block(current('assumptions').map((record) => record.id), '# Assumptions and Limits'),
  section('Assumption register', current('assumptions'), [
    { heading: 'ID', value: (record) => specLink(record) }, { heading: 'Category', value: (record) => record.category },
    { heading: 'Assumption', value: title }, { heading: 'Source', value: (record) => record.source },
    { heading: 'Status', value: (record) => record.semantic_status }, { heading: 'Failure consequence', value: (record) => record.failure_consequence },
    { heading: 'Question', value: (record) => record.author_question },
  ]),
  block([], '## Workflow limit\nThis analysis used pinned files and supplied context. It did not execute target code, tests, builds, proofs, chains, or applications. Runtime, deployment, dependency, protocol, proof-system, and cryptographic behavior remains outside this static result.'),
]);

const phase6Security = phase6Reviews.find((entry: O) => entry.reviewer_role === 'security');
put('SECURITY_REVIEW.md', [
  block([...current('security_objectives'), ...current('threats'), ...current('assumptions')].map((record) => record.id), '# Static Whole-System Security Review'),
  block(idsIn(phase6Security), `## Fresh cross-component security/trust challenge\n${table(['Disposition', 'Reviewed records', 'Qualifications', 'Limits'], [[phase6Security?.review?.overall_disposition, phase6Security?.review?.reviewed_universe?.semantic_records_reviewed, arr(phase6Security?.review?.qualifications).length, compact(phase6Security?.review?.limitations)]])}`),
  section('Security objectives', current('security_objectives')),
  block(idsIn(model.security_review), `## Known failure classes\n${table(['Failure class', 'Disposition', 'Rationale', 'Records'], arr(model.security_review?.failure_classes).map((entry: O) => [entry.class, entry.disposition, entry.rationale, arr(entry.record_ids).join(', ')]))}`),
  block(traceIds(proofRelations), `## Proof and constraint composition\n${proofDiagram.join('\n')}`),
  block([], '## Assurance limit\nThis review is static. It is not a penetration test, formal proof, runtime verification, audit certification, or cryptographic certification.'),
]);

const specificationBlocks = [
  block(semantic.map((record) => record.id), '# Comprehensive Static Specification'),
  block(semantic.map((record) => record.id), `This file indexes all ${semantic.length} current semantic records. The YAML model remains authoritative for full fields, assertions, evidence, and superseded history.`),
  block([], `## Scope\n${table(['Mode', 'Include', 'Exclude', 'Closure', 'Revision', 'Scope hash'], [[scope.scope?.mode, compact(scope.scope?.include), compact(scope.scope?.exclude), scope.scope?.dependency_closure, scope.run?.revision, scope.scope?.scope_hash]])}`),
  block(idsIn(context.system.glossary), `## Glossary\n${table(['Term', 'Meaning or class', 'Trace'], contextRows(arr(context.system.glossary)))}`),
  block(idsIn(model.coverage), `## Coverage\n${table(['Area', 'Count or status'], [['Current semantic records', semantic.length], ['Primary files', model.coverage?.source?.scoped_primary_files], ['Source records', model.coverage?.source?.source_file_records], ['Mapped test files', model.coverage?.tests?.mapped_test_files], ['Pass-2 reviewed', model.coverage?.contextual_review?.reviewed_records], ['Security objectives', model.coverage?.security_review?.current_objectives], ['Threats', model.coverage?.security_review?.current_threats], ['Assumptions', model.coverage?.security_review?.current_assumptions]])}`),
  block([...packages.map((record) => record.id), ...idsIn(contextSubjects)], `## System context\n${systemDiagram.join('\n')}`),
  block([...packages.map((record) => record.id), ...components.map((record) => record.id)], `## Package and component view\n${packageDiagram.join('\n')}`),
  block(flows.map((record) => record.id), `## Principal flow view\n${principalFlowDiagram.join('\n')}`),
  ...(lifecycleDiagram ? [block(idsIn(lifecycleEntry), `## Lifecycle view\n${lifecycleDiagram}`)] : []),
  block(traceIds(diagramRelations), `## Relationship view\n${relationDiagram.join('\n')}`),
  block(traceIds(proofRelations), `## Proof composition view\n${proofDiagram.join('\n')}`),
  block(idsIn(phase6), `## Phase-6 integration\n${table(['Status', 'Method', 'Business review', 'Challenge review', 'Security review'], [[phase6.status, phase6.methodology, phase6Roles.has('business'), phase6Roles.has('challenge'), phase6Roles.has('security')]])}`),
  block(idsIn(phase7), `## Phase-7 guarded traceability correction\n${table(['Status', 'Changed records', 'Changed fields', 'Assertion changes', 'Conclusion changes', 'Review changes'], [[phase7.status, phase7.changed_record_count, phase7.changed_field_count, phase7.semantic_assertion_changes, phase7.effective_conclusion_changes, phase7.contextual_review_changes]])}`),
  block(packages.map((record) => record.id), `## Package accountability\n${table(['ID', 'Package', 'Root', 'Manifest', 'Significance'], packages.map((record) => [`${htmlAnchor(record.id)}${record.id}`, title(record), record.root, record.manifest_path, record.significance]))}`),
  block(current('sources').map((record) => record.id), `## Source accountability\n${table(['ID', 'Path', 'Symbol', 'Kind', 'Significance', 'Parent', 'Hash'], current('sources').map((record) => [`${htmlAnchor(record.id)}${record.id}`, record.path, record.symbol, record.kind, record.significance, arr(record.parent_ids).join(', '), record.source_hash]))}`),
];
for (const group of SEMANTIC_GROUPS) {
  const items = current(group);
  specificationBlocks.push(block(traceIds(items), `## ${GROUP_TITLES[group]}\n${table(['ID', 'Topic', 'Status', 'Static conclusion', 'Pass 2', 'Assertions and evidence', 'Source'], items.map((record) => [`${htmlAnchor(record.id)}${record.id}`, title(record), status(record), conclusion(record), reviewCell(record), evidenceCell(record), firstAnchor(record)]))}`));
}
specificationBlocks.push(block([], '## Static-only boundary\nThe specification does not claim target execution, runtime correctness, deployed-state correctness, proof soundness, cryptographic soundness, or audit certification. Use the unresolved and assumption registers for the exact limits.'));
put('SPECIFICATION.md', specificationBlocks);

for (const component of components) {
  const related = semantic.filter((record) => record.id !== component.id && idsIn(record).includes(component.id));
  const relatedBy = (group: string) => related.filter((record) => current(group).some((candidate) => candidate.id === record.id));
  const inputOutput = relatedBy('inputs_outputs');
  const componentRelations = relatedBy('relations');
  const permissionIds = unique([
    ...componentRelations.filter((record) => (record.type || record.relation_type) === 'AUTHORIZES').map((record) => record.id),
    ...relatedBy('clauses').filter((record) => record.kind === 'AUTHORIZATION').map((record) => record.id),
  ]);
  const errorIds = relatedBy('clauses').filter((record) => ['THROW', 'CATCH', 'ASSERTION'].includes(record.kind) || /fail|error|reject/i.test(JSON.stringify(record))).map((record) => record.id);
  put(`components/${component.id}.md`, [
    block([component.id], `${htmlAnchor(component.id)}\n# ${title(component)} — ${component.id}`),
    block([component.id, ...idsIn(component)], `## Component summary\n${table(['Responsibility', 'Source paths', 'Static conclusion', 'Pass 2'], [[title(component), compact(component.primary_paths), conclusion(component), reviewCell(component, true)]])}`),
    block([component.id, ...inputOutput.map((record) => record.id)], `## Inputs and outputs\n${table(['Direction', 'Records'], [['Inputs', inputOutput.filter((record) => /input|read|consume/i.test(record.direction ?? '')).map((record) => specLink(record, true)).join(', ')], ['Outputs', inputOutput.filter((record) => /output|write|produce|emit/i.test(record.direction ?? '')).map((record) => specLink(record, true)).join(', ')]])}`),
    block([component.id, ...permissionIds, ...errorIds], `## State, permissions, and errors\n${table(['Topic', 'Records'], [['State and invariants', relatedBy('invariants').map((record) => specLink(record, true)).join(', ')], ['Permissions', permissionIds.join(', ')], ['Errors and rejection paths', errorIds.join(', ')]])}`),
    block([component.id, ...related.map((record) => record.id)], `## Dependencies, tests, and open matters\n${table(['Topic', 'Records'], [['Dependencies and relations', componentRelations.map((record) => specLink(record, true)).join(', ')], ['Tests', relatedBy('tests').map((record) => specLink(record, true)).join(', ')], ['Findings', relatedBy('findings').map((record) => specLink(record, true)).join(', ')], ['Gaps', relatedBy('gaps').map((record) => specLink(record, true)).join(', ')], ['Unresolved', relatedBy('unresolved').map((record) => specLink(record, true)).join(', ')]])}`),
    block([component.id, ...related.map((record) => record.id)], `## Related semantic records\n${table(['ID', 'Type', 'Topic'], related.map((record) => [specLink(record, true), record.id.split('-')[0], title(record)]))}`),
  ]);
}

for (const flow of flows) {
  const relatedIds = unique(idsIn(flow).filter((id) => id !== flow.id && eligibleIds.has(id)));
  const referring = semantic.filter((record) => record.id !== flow.id && idsIn(record).includes(flow.id));
  const related = unique([...relatedIds, ...referring.map((record) => record.id)]).map((id) => byId.get(id)).filter(Boolean) as O[];
  const openFlowRecords = related.filter((record) => ['FND', 'GAP', 'UNR'].includes(record.id.split('-')[0]));
  put(`flows/${flow.id}.md`, [
    block([flow.id], `${htmlAnchor(flow.id)}\n# ${title(flow)} — ${flow.id}`),
    block([flow.id, ...idsIn(flow)], `## Flow summary\n${table(['Scope', 'Owner', 'Trigger', 'Static conclusion', 'Pass 2'], [[flow.flow_scope, flow.owner_component_id, flow.trigger, conclusion(flow), reviewCell(flow, true)]])}`),
    block([flow.id, ...idsIn(flow.steps), ...idsIn(flow.terminal_outcomes)], flowDiagram(flow)),
    block([flow.id, ...idsIn(flow.steps)], `## Ordered steps\n${table(['Step', 'Operation', 'Component', 'Behavior', 'Inputs', 'Outputs', 'Failure edges'], arr(flow.steps).map((step: O) => [step.sequence, step.operation, step.component_id, step.behavior_id, compact(step.inputs), compact(step.outputs), compact(step.failure_edges)]))}`),
    block([flow.id, ...idsIn(flow)], `## Outcomes and controls\n${table(['Topic', 'Value'], [['Terminal outcomes', compact(flow.terminal_outcomes)], ['Invariants', arr(flow.invariant_ids).join(', ')], ['Trust boundaries', compact(flow.trust_boundaries)]])}`),
    block([flow.id, ...related.map((record) => record.id)], `## Related semantic records\n${table(['ID', 'Type', 'Topic'], related.map((record) => [specLink(record, true), record.id.split('-')[0], title(record)]))}`),
    block([flow.id, ...openFlowRecords.map((record) => record.id)], `## Open review items\n${openFlowRecords.length ? table(['ID', 'Type', 'Topic', 'Status'], openFlowRecords.map((record) => [specLink(record, true), record.id.split('-')[0], title(record), status(record)])) : 'None recorded.'}`),
  ]);
}

const expectedPaths = [
  ...TOP_LEVEL_FILES,
  ...components.map((record) => `components/${record.id}.md`),
  ...flows.map((record) => `flows/${record.id}.md`),
].sort();
const actualPaths = [...docs.keys()].sort();
if (expectedPaths.length !== 51 || actualPaths.length !== 51 || JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) {
  throw new Error(`publication contract requires 51 Markdown files; expected ${expectedPaths.length}, generated ${actualPaths.length}`);
}
const allMarkdown = [...docs.values()].join('\n');
const missingSemantic = semantic.map((record) => record.id).filter((id) => !allMarkdown.includes(id));
const missingAnchors = semantic.map((record) => record.id).filter((id) => !docs.get('SPECIFICATION.md')?.includes(htmlAnchor(id)));
if (missingSemantic.length || missingAnchors.length) throw new Error(`semantic publication coverage failed: missing=${missingSemantic.join(',')}; anchors=${missingAnchors.join(',')}`);

for (const [sourcePath, markdown] of docs) {
  for (const match of markdown.matchAll(/\]\(([^)]+\.md)(#[^)]+)?\)/g)) {
    const target = posix.normalize(posix.join(posix.dirname(sourcePath), match[1]));
    if (!docs.has(target)) throw new Error(`broken local link in ${sourcePath}: ${match[0]}`);
  }
}

const styleIssues: StyleIssue[] = [];
const technicalValueExceptions: TechnicalValueException[] = [];
const inspectStyleText = (path: string, line: number, location: StyleIssue['location'], value: string, recordId?: string, field?: string) => {
  const isDeclaredTechnicalValue = location === 'TABLE_CELL' && value.startsWith(technicalValuePrefix);
  const source = isDeclaredTechnicalValue ? value.slice(technicalValuePrefix.length) : value;
  for (const issue of valueStyleKinds(source)) {
    if (isDeclaredTechnicalValue) {
      technicalValueExceptions.push({ file: path, line, record_id: recordId, field, ...issue });
    } else {
      styleIssues.push({ file: path, line, location, ...issue });
    }
  }
};
for (const [path, markdown] of docs) {
  let inFence = false;
  let tableHeaders: string[] | undefined;
  const markdownLines = markdown.split('\n');
  for (const [lineIndex, rawLine] of markdownLines.entries()) {
    if (rawLine.trim().startsWith('```')) { inFence = !inFence; continue; }
    const trimmed = rawLine.trim();
    if (inFence || !trimmed || trimmed.startsWith('<!--') || trimmed.startsWith('#') || trimmed.startsWith('<a ')) { tableHeaders = undefined; continue; }
    if (trimmed.startsWith('|')) {
      if (/^\|(?:\s*:?-+:?\s*\|)+$/.test(trimmed)) continue;
      const cells = trimmed.slice(1, -1).split(/(?<!\\)\|/);
      const nextLine = markdownLines[lineIndex + 1]?.trim() ?? '';
      if (/^\|(?:\s*:?-+:?\s*\|)+$/.test(nextLine)) {
        tableHeaders = cells.map((cell) => clean(cell));
        continue;
      }
      const recordId = (cells.join(' ').match(ID_GLOBAL) ?? [])[0];
      for (const [cellIndex, cell] of cells.entries()) inspectStyleText(path, lineIndex + 1, 'TABLE_CELL', cell.trim(), recordId, tableHeaders?.[cellIndex]);
    } else {
      tableHeaders = undefined;
      inspectStyleText(path, lineIndex + 1, 'PROSE', trimmed);
    }
  }
}

if (styleIssues.length) {
  throw new Error(`publication has ${styleIssues.length} unapproved STE-style issue(s): ${JSON.stringify(styleIssues.slice(0, 10))}`);
}

mkdirSync(out, { recursive: false, mode: 0o700 });
for (const [relativePath, markdown] of docs) {
  const destination = resolve(out, relativePath);
  if (!destination.startsWith(`${out}${sep}`)) throw new Error(`output escaped the publication directory: ${relativePath}`);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, markdown, { encoding: 'utf8', flag: 'wx' });
}

console.log(JSON.stringify({
  out,
  markdown_files: docs.size,
  semantic_records_indexed: semantic.length,
  components: components.length,
  flows: flows.length,
  actionable_findings: actionableFindings.length,
  actionable_gaps: actionableGaps.length,
  unresolved: unresolved.length,
  style_report: {
    kind: 'advisory heuristic; not ASD-STE100 certification',
    status: styleIssues.length
      ? 'VIOLATIONS'
      : technicalValueExceptions.length
        ? 'APPLIED_WITH_EXCEPTIONS'
        : 'APPLIED',
    authored_reader_prose_checks: styleIssues.length === 0 ? 'NO_VIOLATIONS' : 'VIOLATIONS',
    result: styleIssues.length === 0
      ? 'The authored reader prose follows the configured checks. Declared exact technical values remain visible and can exceed the limits.'
      : 'The generated prose has unapproved style violations.',
    descriptive_limit_words: 25,
    instruction_limit_words: 20,
    contractions_flagged: styleIssues.filter((issue) => issue.kind === 'CONTRACTION').length,
    long_descriptions_flagged: styleIssues.filter((issue) => issue.kind === 'LONG_DESCRIPTION').length,
    long_instructions_flagged: styleIssues.filter((issue) => issue.kind === 'LONG_INSTRUCTION').length,
    table_cell_contractions_flagged: styleIssues.filter((issue) => issue.location === 'TABLE_CELL' && issue.kind === 'CONTRACTION').length,
    table_cell_long_descriptions_flagged: styleIssues.filter((issue) => issue.location === 'TABLE_CELL' && issue.kind === 'LONG_DESCRIPTION').length,
    table_cell_long_instructions_flagged: styleIssues.filter((issue) => issue.location === 'TABLE_CELL' && issue.kind === 'LONG_INSTRUCTION').length,
    declared_exact_technical_value_exception_occurrences: technicalValueExceptions.length,
    declared_exact_technical_value_distinct_normalized_sentences: unique(technicalValueExceptions.map((issue) => `${issue.kind}:${issue.text}`)).length,
    declared_exact_technical_value_contractions: technicalValueExceptions.filter((issue) => issue.kind === 'CONTRACTION').length,
    declared_exact_technical_value_long_descriptions: technicalValueExceptions.filter((issue) => issue.kind === 'LONG_DESCRIPTION').length,
    declared_exact_technical_value_long_instructions: technicalValueExceptions.filter((issue) => issue.kind === 'LONG_INSTRUCTION').length,
    violation_sample: styleIssues.slice(0, 20),
    technical_value_exception_sample: technicalValueExceptions.slice(0, 20),
  },
}, null, 2));
