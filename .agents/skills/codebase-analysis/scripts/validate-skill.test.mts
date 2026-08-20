import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

async function text(path: string) {
  return readFile(new URL(path, new URL('../', import.meta.url)), 'utf8');
}

test('skill frontmatter and references are valid', async () => {
  const skill = await text('SKILL.md');
  const match = skill.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, 'SKILL.md must have YAML frontmatter');
  const fields = Object.fromEntries(
    match[1].split('\n').map((line) => {
      const split = line.indexOf(':');
      assert.ok(split > 0, `invalid frontmatter line: ${line}`);
      return [line.slice(0, split), line.slice(split + 1).trim()];
    })
  );
  assert.deepEqual(Object.keys(fields).sort(), ['description', 'name']);
  assert.match(fields.name, /^[a-z0-9-]+$/);
  assert.equal(fields.name, 'codebase-analysis');
  assert.ok(fields.description.length > 40 && fields.description.length <= 1024);

  for (const path of [
    'references/ARTIFACTS.md',
    'references/METHOD.md',
    'references/GOVERNANCE-ZK-REVIEW.md',
    'references/STE-STYLE.md',
    'agents/business-analyst.toml',
    'agents/inventory-analyst.toml',
    'agents/platform-analyst.toml',
    'agents/semantic-analyst.toml',
    'agents/quality-challenger.toml',
    'agents/security-reviewer.toml',
    'agents/contextual-reviewer.toml',
    'agents/openai.yaml',
    'scripts/generate-publication.mts',
    'scripts/validate-run.test.mts',
  ]) {
    assert.ok((await stat(new URL(path, new URL('../', import.meta.url)))).isFile(), path);
  }
});

test('agent contracts are fresh and non-delegating', async () => {
  for (const name of [
    'business-analyst',
    'inventory-analyst',
    'platform-analyst',
    'semantic-analyst',
    'quality-challenger',
    'security-reviewer',
    'contextual-reviewer',
  ]) {
    const agent = await text(`agents/${name}.toml`);
    assert.match(agent, /fresh_context_required = true/);
    assert.match(agent, /delegate/i);
  }
});

test('UI metadata references the skill', async () => {
  const metadata = await text('agents/openai.yaml');
  assert.match(metadata, /display_name: "Codebase analysis"/);
  assert.match(metadata, /default_prompt: "Use \$codebase-analysis/);
  assert.match(metadata, /allow_implicit_invocation: false/);
});

test('contract fixes output formats and parallelism', async () => {
  const skill = await text('SKILL.md');
  const artifacts = await text('references/ARTIFACTS.md');
  const steStyle = await text('references/STE-STYLE.md');
  assert.match(skill, /maximum of four active local agents/i);
  assert.match(skill, /run at most three workers concurrently/i);
  assert.match(artifacts, /Only YAML and Markdown are durable output formats/);
  assert.match(skill, /Do not use Python/);
  assert.match(skill, /two mandatory passes/i);
  assert.match(skill, /Under no condition may any agent edit/i);
  assert.match(skill, /only permitted repository write root/i);
  assert.match(skill, /complete `model\/context.yaml`/i);
  assert.match(skill, /Never set `PROOFS_ENABLED`/);
  assert.match(skill, /Never create or run per-claim TypeScript verifiers/);
  assert.match(skill, /mandatory zkSecurity-inspired review method/i);
  assert.match(skill, /STE-STYLE\.md/);
  assert.match(skill, /publication style check/i);
  assert.match(artifacts, /author-facing YAML prose and Markdown/);
  assert.match(steStyle, /20 words/);
  assert.match(steStyle, /25 words/);
  assert.match(steStyle, /active voice/i);
  assert.match(steStyle, /Do not use contractions/i);
  assert.match(steStyle, /APPLIED_WITH_EXCEPTIONS/);
  assert.match(steStyle, /line break.*sentence boundary/i);
  assert.match(skill, /security-reviewer\.toml/);
  assert.ok(root.endsWith('/codebase-analysis/'));
});

test('run validator enforces closure, evidence, publication, and ZK bindings', async () => {
  const validator = await text('scripts/validate-run.test.mts');
  for (const requirement of [
    'stale aggregate scope hash',
    'duplicate current SRC file record',
    'requires assertions',
    'manifest exhaustively binds inputs and outputs',
    'missing publication/',
    'platform applicability and ZK field-level coverage are source-bound',
    'BOUND_BY_CONSTRAINT',
    'host effects',
    'configured_modes',
    'mandatory zkSecurity-inspired security review is complete and traceable',
    'known-failure-class matrix mismatch',
    'THREAT_MODEL.md',
  ]) assert.match(validator, new RegExp(requirement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
