---
title: Developer Commands And Environment
sidebar_label: Commands and environment
audience: developer
page_kind: reference
---

# Developer Commands And Environment

This is a quick path to the commands you will use most often. Follow the linked
guides when you need the full procedure, command options, or field definitions.

Read [Required command tools](../local-development/tools.md) before using these commands.
The environment loader `dotenvx` requires a separate installation.

## Setup And Workspace

```bash
nvm install
nvm use
corepack enable
CI=true pnpm install --frozen-lockfile

pnpm check-types
pnpm lint
pnpm build
```

## Local Environment

```bash
pnpm env:bootstrap local-blockchain
pnpm local-blockchain:start
pnpm local-blockchain:up:build
pnpm local-blockchain:logs
pnpm local-blockchain:down
pnpm local-blockchain:reset
```

Read the [full local demo](../local-development/full-local-demo.md) before you
start the complete lifecycle.

## CLI

```bash
pnpm run cli -- --help
pnpm run cli -- <COMMAND> --help
```

Use the [CLI command index](../../operate/reference/cli-commands.md) for every
command, option, environment mapping, and default.

## Application Development

```bash
pnpm --dir apps/api run dev
pnpm --dir apps/web run dev
pnpm --dir apps/backoffice run dev
pnpm --dir apps/docs run dev
pnpm --dir packages/ui run storybook
```

## Tests

```bash
pnpm test:backend
pnpm test:backend:postgres
pnpm test:backend:e2e:local-blockchain
pnpm compose:test
pnpm compose:e2e
pnpm docs:check
```

Read the [testing strategy](../testing.md) for scope and limitations.

## Main Environment Groups

| Group         | Fields                                                   |
| ------------- | -------------------------------------------------------- |
| Mina          | `MINA_NODE_URL`, `MINA_NETWORK_ID`                       |
| Archive       | `ARCHIVE_NODE_URL`                                       |
| Contracts     | Treasury Owner, Pause Controller, and participant values |
| Lifecycle     | `TREASURY_DEPLOYED_AT_SLOT`, `LIFECYCLE_PERIOD_DURATION` |
| Database      | `DATABASE_URL`, `DATABASE_SCHEMA`                        |
| Local storage | `SQLITE_DATA_DIRECTORY`                                  |
| Proof mode    | `PROOFS_ENABLED` and browser proof values                |
| Worker        | Redis, queue, attempts, backoff, and timeout values      |
| Browser       | `NEXT_PUBLIC_*` endpoints and contract configuration     |

Use [Environment configuration](../local-development/environment.md) for the
family model. Use the [environment field index](../../operate/reference/environment-fields.md)
for the complete field reference.

## Development And Test Fields

These values control local builds or test output. They do not select Treasury authorization rules.

| Field                           | Default                            | Purpose                                                                                                          |
| ------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `BACKOFFICE_BUILD_DIR`          | `.next`                            | Next.js output directory for Backoffice. E2E runs can select a separate directory for each proof mode.           |
| `E2E_BROWSER_COVERAGE`          | Disabled unless exactly `true`     | Enables source maps in the configured web and Backoffice worker loaders for browser coverage collection.         |
| `BROWSER_COVERAGE_DEPENDENCIES` | No external module lookup override | Directory whose package context resolves coverage conversion dependencies instead of the default script context. |

Use the test runner's assigned directories. Do not point simultaneous builds at the same output directory.
Leave coverage settings unset for normal application builds unless you need coverage output.

## Sources

- `package.json`
- `apps/api/package.json`
- `apps/backoffice/package.json`
- `apps/cli/package.json`
- `apps/docs/package.json`
- `apps/web/package.json`
- `packages/sdk/package.json`
- `packages/ui/package.json`
- `devops/scripts/bootstrap-env.mjs`
