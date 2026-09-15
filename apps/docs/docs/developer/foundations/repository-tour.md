---
title: Repository Tour
sidebar_label: Repository tour
audience: developer
page_kind: concept
---

# Repository Tour

This repository is a monorepo. One checkout contains several applications and
reusable packages, and pnpm manages them as one workspace.

You do not need to read every workspace before you make a change. First decide
whether the behavior belongs to a deployable application, a reusable package,
or more than one layer.

## Applications Compose The Product

An application has a runtime or a user interface:

| Application       | What starts from it                                  |
| ----------------- | ---------------------------------------------------- |
| `apps/cli`        | Commands for contracts, ledgers, proofs, and signing |
| `apps/api`        | API, indexer, processor, migrations, and schedulers  |
| `apps/web`        | Normal proposal and voting browser flows             |
| `apps/backoffice` | Break-glass signing and submission flows             |
| `apps/docs`       | This Docusaurus site and its content checks          |

Applications connect configuration, reusable code, and deployment concerns.
They can import domain packages.

## Packages Own Reusable Behavior

| Package                     | Main responsibility                               |
| --------------------------- | ------------------------------------------------- |
| `packages/sdk`              | Treasury domain, zkApps, proofs, ledgers, workers |
| `packages/indexer`          | Generic Archive ingestion and typed event storage |
| `packages/processor`        | Generic ordered event processing and projections  |
| `packages/ui`               | Shared React components                           |
| `packages/local-blockchain` | Local Mina and Archive development surfaces       |

The generic indexer and processor packages do not define Treasury proposal
behavior. `apps/api` supplies the Treasury event handlers and database views.

## Follow Dependency Direction

Applications compose packages. A reusable domain package must not depend on an
application runtime.

`packages/sdk` owns contract and proof behavior. `apps/cli` exposes that
behavior as commands. `apps/api` uses SDK types and events to build service
flows. Browser applications consume APIs and shared UI components.

When a dependency starts to point in the opposite direction, move the shared
type or behavior to the package that can own it without importing the
application.

## Start From One User Result

Suppose you need to change how a proposal appears after creation.

1. Read the user flow in `apps/web/features/proposals/`.
2. Find the App API route and proposal response in `apps/api/src/`.
3. Find the projection handler in `apps/api/src/processors/proposals/`.
4. Find the event type in `packages/sdk/src/provable/events/`.
5. Continue into the contract only if the on-chain event or state must change.

This outside-in path prevents an interface change from becoming an accidental
protocol change.

## Know The Main Repository Files

| File or directory     | Purpose                                  |
| --------------------- | ---------------------------------------- |
| `package.json`        | Root commands and pinned package manager |
| `pnpm-workspace.yaml` | Workspace membership                     |
| `.nvmrc`              | Node.js version                          |
| `devops/`             | Compose, images, Helm, and runbooks      |
| `DEMO.md`             | Source for the full local flow           |
| `AGENTS.md`           | Repository work instructions             |

Use the [package reference](../reference/packages.md) for commands and links.
Next, read [Mina, o1js, and proofs](mina-o1js-and-proofs.md).

## Sources

- `pnpm-workspace.yaml`
- `package.json`
- `.nvmrc`
- `apps/`
- `packages/`
- `devops/`
