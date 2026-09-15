---
title: Developer API Route Map
sidebar_label: API route map
audience: developer
page_kind: reference
---

# Developer API Route Map

When an endpoint gives an unexpected result, first identify which API owns it.
The application stack has three HTTP APIs, each with a separate process, port,
and route owner.

## Process Map

| API           | Native port | Proxy port | Main route groups                                                                 |
| ------------- | ----------: | ---------: | --------------------------------------------------------------------------------- |
| App API       |      `4000` |     `4100` | Proposal content, proposal aggregation, staking and voting ledger reads.          |
| Indexer API   |      `4001` |     `4101` | Events, ingestion status, rejections, health, and readiness.                      |
| Processor API |      `4002` |     `4102` | Proposals, votes, nullifiers, tallies, executions, status, health, and readiness. |

The web-origin Compose paths are `/api`, `/indexer`, and `/processor`.

## App API Ownership

The App API owns Treasury-specific aggregation. It combines Processor API
projections with proposal content and lifecycle ledger access.

Main source areas:

- `apps/api/src/proposal-content-routes.ts`;
- `apps/api/src/proposal-aggregate-routes.ts`;
- `apps/api/src/staking-ledger/`;
- `apps/api/src/voting-ledger/`.

## Indexer API Ownership

The generic indexer package owns event and status behavior. `apps/api` supplies
the configured contract and database runtime.

## Processor API Ownership

The processor package builds read-only CRUD routes from projection entities.
Treasury projection entities and handlers remain in `apps/api`.

## Complete API Reference

- [App API](../../operate/api/app-api.md)
- [Indexer API](../../operate/api/indexer-api.md)
- [Processor API](../../operate/api/processor-api.md)

These pages define query parameters, response fields, status behavior, and
error responses.

## Sources

- `apps/api/README.md`
- `apps/api/src/app-api.ts`
- `apps/api/src/indexer-api.ts`
- `apps/api/src/processor-api.ts`
- `packages/indexer/src/`
- `packages/processor/src/`
