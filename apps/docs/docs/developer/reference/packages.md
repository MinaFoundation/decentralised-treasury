---
title: Workspace And Package Reference
sidebar_label: Workspaces and packages
audience: developer
page_kind: reference
---

# Workspace And Package Reference

The monorepo becomes easier to navigate when you know whether a change belongs
to a deployable application or a reusable domain package. This map gives each
workspace a clear home and points to its main development path.

## Applications

| Workspace         | Responsibility                                                          | Developer page                                   |
| ----------------- | ----------------------------------------------------------------------- | ------------------------------------------------ |
| `apps/api`        | Compose indexer, processor, APIs, workers, migrations, and projections. | [API runtime](../apps/api-runtime.md)            |
| `apps/cli`        | Provide contract, ledger, proof, signing, and utility commands.         | [CLI development](../operations/cli.md)          |
| `apps/web`        | Provide normal Treasury browser workflows.                              | [Web application](../apps/web-app.md)            |
| `apps/backoffice` | Provide break-glass browser workflows.                                  | [Backoffice](../apps/backoffice.md)              |
| `apps/docs`       | Build and validate User, Operator, and Developer documentation.         | [Documentation development](../documentation.md) |

## Domain Packages

| Workspace                   | Responsibility                                                      | Main development command                        |
| --------------------------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| `packages/sdk`              | Contracts, ZkPrograms, ledgers, storage, services, and workers.     | `pnpm --dir packages/sdk run test:all`          |
| `packages/indexer`          | Archive ingestion, event storage, cursors, and event API.           | `pnpm --dir packages/indexer run test:unit`     |
| `packages/processor`        | Event consumption, routing, offsets, and generated projection APIs. | `pnpm --dir packages/processor run test:unit`   |
| `packages/ui`               | Shared Treasury, wallet, and primitive React components.            | `pnpm --dir packages/ui run storybook`          |
| `packages/local-blockchain` | Local Mina, Archive, admin, and transaction simulation.             | `pnpm --dir packages/local-blockchain run test` |

## Configuration Packages

| Workspace                    | Responsibility                    |
| ---------------------------- | --------------------------------- |
| `packages/eslint-config`     | Shared ESLint configurations.     |
| `packages/typescript-config` | Shared TypeScript configurations. |

## Dependency Direction

Applications can compose domain packages. Domain packages must not import an
application runtime.

`packages/sdk` owns Treasury domain and provable code. The indexer and processor
packages remain generic; `apps/api` supplies Treasury-specific composition.

`packages/ui` owns shared presentation. Browser data fetching and state remain
in the application that uses the component.

## Workspace Commands

```bash
pnpm check-types
pnpm lint
pnpm build
```

Use the [testing guide](../testing.md) for package and integration commands.

## Sources

- `pnpm-workspace.yaml`
- `package.json`
- `apps/api/README.md`
- `apps/backoffice/README.md`
- `apps/cli/README.md`
- `apps/docs/README.md`
- `apps/web/README.md`
- `packages/sdk/README.md`
- `packages/indexer/README.md`
- `packages/processor/README.md`
- `packages/ui/README.md`
- `packages/local-blockchain/README.md`
- `packages/eslint-config/README.md`
- `packages/typescript-config/README.md`
