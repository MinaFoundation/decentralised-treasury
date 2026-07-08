---
title: API Runtime
sidebar_label: API Runtime
---

The API app runs five cooperating processes: indexer worker, processor worker, indexer API, processor API, and app API.

## Runtime Surfaces

- **Indexer worker** polls Archive and writes typed events.
- **Indexer API** serves event and status endpoints.
- **Processor worker** consumes indexed events and writes projections.
- **Processor API** serves projection reads.
- **App API** serves treasury-specific routes such as proposal content and ledger witnesses.

## Operational Dependencies

- Mina archive endpoint,
- Postgres database,
- treasury owner contract address and token id,
- lifecycle SQLite files for staking/voting ledger witness endpoints.

## Source Material

- `apps/api/README.md`
- `apps/api/src/indexer.ts`
- `apps/api/src/processor.ts`
- `apps/api/src/app-api.ts`
