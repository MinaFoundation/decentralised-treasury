---
title: Documentation Development
sidebar_label: Documentation development
audience: developer
page_kind: procedure
---

# Documentation Development

The documentation site uses Docusaurus. Its main content has three audiences:
User, Operator, and Developer.

Good documentation should sound like a knowledgeable person helping another
person complete a task. It must still be exact about commands, state, and risk.

## Select The Audience

| Audience  | Content                                                                               |
| --------- | ------------------------------------------------------------------------------------- |
| User      | Participation, interfaces, lifecycle results, and trust choices.                      |
| Operator  | Configuration, deployment, reconciliation, failure response, and live infrastructure. |
| Developer | Implementation, local development, component design, tests, and source maps.          |

Do not copy a production procedure into the Developer section. Link to the
Operator procedure and explain the development boundary.

## Write For A Person

- Start with the result that the reader can achieve.
- Give enough context to explain why a step or check matters.
- Address the reader directly when this makes an instruction clearer.
- Use natural transitions such as “When,” “If,” and “After.”
- Prefer short paragraphs with one connected idea.
- Keep technical terms, command names, field names, and exact values unchanged.

Avoid stock openings such as “Use this page to” or “This section contains.”
Do not add casual filler, jokes, or marketing language. A natural voice comes
from clear context and useful guidance, not from extra words.

## Page Metadata

Each main page starts with these fields:

```yaml
---
title: Page title
sidebar_label: Sidebar title
audience: developer
page_kind: concept
---
```

Select the page type before you write:

| Page type    | One job                                                              |
| ------------ | -------------------------------------------------------------------- |
| `navigation` | Help the reader select a path.                                       |
| `overview`   | Give a short summary without becoming a tutorial or reference.       |
| `quickstart` | Produce the first useful result through the shortest supported path. |
| `concept`    | Explain one subject from basic terms and build a mental model.       |
| `procedure`  | Help the reader complete one detailed task safely.                   |
| `reference`  | Supply exact facts that the reader can look up.                      |

Every non-navigation page ends with a `Sources` section.

## Build A Learning Path

Do not put the summary, quickstart, full explanation, and exact reference on
one page. These reading modes serve different needs.

For each main audience:

1. Make the audience index a short path selector.
2. Put the short system summary on an overview page.
3. Put the shortest supported working flow on a quickstart page.
4. Explain unfamiliar terms on foundation concept pages before detailed work.
5. Keep commands and controlled actions in procedure pages.
6. Keep exhaustive facts in reference pages.

Start a concept page with the question that the concept answers. Define a term
before you use it to explain another term. Use one small example when the
relationship is difficult to see.

## Generated Pages

The full local demo is generated from root `DEMO.md`. Generate it after you
change the source procedure:

```bash
pnpm --dir apps/docs run generate:developer-guides
```

The Kubernetes pages are generated from `devops/runbooks`:

```bash
pnpm --dir apps/docs run generate:runbooks
```

Do not edit a generated page directly. Change its source or generator.

## Run The Site

```bash
pnpm docs:dev
```

Open `http://127.0.0.1:3300/decentralised-treasury/`.

## Check The Documentation

Run the complete check from the repository root:

```bash
pnpm docs:check
```

The check validates generated content, links, routes, source paths, CLI
reference coverage, TypeScript, and the production build.

Use these narrower commands during editing:

```bash
pnpm --dir apps/docs run validate:developer-guides
pnpm --dir apps/docs run validate:docs
pnpm --dir apps/docs run validate:coverage
pnpm --dir apps/docs run check-types
pnpm --dir apps/docs run build
```

## Source Document Policy

The [source document map](reference/source-documents.md) records how repository
Markdown relates to the published sections. Update that page when you add a
new product README or runbook.

Repository analysis records and agent instructions are not product pages.
Convert applicable conclusions into audience-specific content before publication.

## Sources

- `apps/docs/README.md`
- `apps/docs/package.json`
- `apps/docs/docusaurus.config.ts`
- `apps/docs/sidebars.ts`
- `apps/docs/scripts/validate-docs.mjs`
- `apps/docs/scripts/generate-developer-guides.mjs`
- `apps/docs/scripts/generate-infrastructure-runbooks.mjs`
