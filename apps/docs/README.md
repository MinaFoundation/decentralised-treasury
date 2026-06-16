# Docs App

Docusaurus documentation site for the decentralized treasury monorepo.

The app builds an audience-first Docusaurus content tree from repository docs, READMEs, and specs. Source material stays close to the code that owns it; `apps/docs` publishes stable `/user`, `/developer`, and `/specs` routes with navigation and a visual shell that follows the `apps/web` Mina treasury palette.

The site is organized as layered documentation:

- user-facing docs translate treasury concepts, lifecycle, voting, outcomes, safety, and trust into product language,
- developer docs explain implementation, operations, testing, debugging, and maintenance,
- specs provide the conceptual and contractual source material behind both layers.

## Run

From repo root:

```bash
pnpm --dir apps/docs run dev
```

Default local URL: `http://localhost:3001`

The dev and build scripts run `pnpm run sync` first.

## Sync Content

```bash
pnpm --dir apps/docs run sync
```

This refreshes `apps/docs/docs/` from source docs, specs, READMEs, and generated audience pages. The generated directory is not the authoring location for docs.

## Build and Start

```bash
pnpm --dir apps/docs run build
pnpm --dir apps/docs run start
```

## Quality Checks

```bash
pnpm --dir apps/docs run check-types
pnpm --dir apps/docs run lint
```

## Dependencies

- Docusaurus 3
- React 18
