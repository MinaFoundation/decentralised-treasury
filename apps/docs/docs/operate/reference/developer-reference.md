---
title: Developer Reference
sidebar_label: Developer reference
sidebar_position: 14
audience: operator
page_kind: reference
---

# Developer reference

Use this page to find the package that owns an implementation area.

## Applications

| Workspace | Responsibility |
| --- | --- |
| `apps/api` | Composes the App API, Indexer API, Processor API, event handlers, workers, and migrations. |
| `apps/web` | Provides normal proposal, vote, and execution workflows. |
| `apps/backoffice` | Provides break-glass signing and submission workflows. |
| `apps/cli` | Provides deployment, ledger, proof, transaction, and scheduler commands. |
| `apps/docs` | Publishes the Learn, Operate, and Review documentation. |

## Domain packages

| Workspace | Responsibility |
| --- | --- |
| `packages/sdk` | Smart contracts, ZkPrograms, ledgers, storage, services, signing, and proving. |
| `packages/indexer` | Archive GraphQL ingestion, cursors, events, and Indexer API. |
| `packages/processor` | Event processing, offsets, handler routing, and projection API support. |
| `packages/ui` | Shared treasury and wallet user interface components. |
| `packages/local-blockchain` | Local Mina-like GraphQL and Archive-compatible development services. |

Applications compose domain packages. The SDK does not own HTTP routes or deployment identity.

## Source map

| Area | Path |
| --- | --- |
| Contracts | `packages/sdk/src/provable/contracts/` |
| Proof programs | `packages/sdk/src/provable/` |
| Ledgers | `packages/sdk/src/ledgers/` |
| SQLite adapters | `packages/sdk/src/storage/` and `packages/sdk/src/services/sqlite/` |
| Tracing and proving | `packages/sdk/src/proving/` |
| CLI commands | `apps/cli/src/commands/` |
| API routes and handlers | `apps/api/src/` |
| Indexer core | `packages/indexer/src/` |
| Processor core | `packages/processor/src/` |
| Web features | `apps/web/features/` |
| Backoffice features | `apps/backoffice/features/` |
| Shared UI | `packages/ui/src/` |

## Local development

Install repository dependencies:

~~~bash
pnpm install
~~~

Create one environment family:

~~~bash
pnpm env:bootstrap local-blockchain
~~~

Use package scripts from each `package.json`. Use the Compose commands in `devops/TESTNET.md` for the integrated stack.

Do not enable `PROOFS_ENABLED=true` for a fast local interface test. Enable it only for a real proof test.

## Tests

Use the narrowest applicable test command before a full workspace check.

| Scope | Main source |
| --- | --- |
| SDK contracts and proof programs | `packages/sdk/test/` |
| CLI interfaces and transaction builders | `apps/cli/test/` |
| API routes and projections | `apps/api/test/` |
| Indexer ingestion | `packages/indexer/test/` |
| Processor engine | `packages/processor/test/` |
| Web features | Tests next to `apps/web/features/` |
| Backoffice features | Tests next to `apps/backoffice/features/` |

Proof tests can use substantial time and memory. Check the package scripts before you enable proofs.

## Change rules

- Keep protocol constants and verification-key configuration synchronized.
- Add a source test for each changed state transition.
- Add an API test for each changed route or response field.
- Update the CLI command index when a `.command(...)` declaration changes.
- Update the environment index when a runtime field changes.
- Update the event page when `TreasuryOwnerSmartContract.events` changes.
- Rebuild browser proof configuration after an affected circuit change.

## Related reference

- [Protocol behavior](./protocol-behavior)
- [CLI command index](./cli-commands)
- [Environment field index](./environment-fields)
- [Events](./events)

## Sources

- `pnpm-workspace.yaml`
- `package.json`
- `apps/api/package.json`
- `apps/web/package.json`
- `apps/backoffice/package.json`
- `apps/cli/package.json`
- `apps/docs/package.json`
- `packages/sdk/package.json`
- `packages/indexer/package.json`
- `packages/processor/package.json`
- `packages/ui/package.json`
- `packages/local-blockchain/package.json`
- `DEMO.md`
- `devops/TESTNET.md`
- `README.md`
