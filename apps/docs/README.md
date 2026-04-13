# Docs App

Next.js documentation site for this monorepo.

## Run

From repo root:

```bash
pnpm --dir apps/docs run dev
```

Default local URL: `http://localhost:3001`

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

- Next.js 15
- React 19
- shared UI from `@repo/ui`
