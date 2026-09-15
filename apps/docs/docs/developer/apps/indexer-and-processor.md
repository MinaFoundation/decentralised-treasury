---
title: Indexer And Processor
sidebar_label: Indexer and processor
audience: developer
page_kind: concept
---

# Indexer And Processor

A Mina event passes through two stages before it appears in the application.
The indexer turns Archive responses into durable typed events, and the
processor turns those events into Treasury projections.

## Indexer Flow

1. Read pending or canonical Archive ranges.
2. Resolve each contract event discriminator.
3. Store accepted events and rejected observations.
4. Update the matching cursor in the same transaction.
5. Recheck overlap ranges and retire old pending branches.

The preferred API cursor is `change_sequence`. It increases for inserts and
semantic updates.

Event identity uses the transaction hash, account-update identity, account-update
index, and event index. `block_event_index` records contract order inside one
block.

## Rejection Behavior

A malformed observation does not change an accepted event type. The indexer
stores the rejection and continues with other valid observations.

An unresolved observation blocks readiness until an operator resolves its
source or closes the rejection. Read the
[Indexer API](../../operate/api/indexer-api.md) for status fields.

## Processor Flow

1. Read the processor offset.
2. Request typed events after that offset.
3. dispatch one event to its handler;
4. write the projection and new offset in one transaction;
5. continue in source order.

One failing event blocks later events. A bounded successor check can retire an
old immutable version. Otherwise, an explicit retry is required.

## Projection Ownership

Proposal handlers in `apps/api` own Treasury-specific projections. The generic
processor package owns polling, routing, offsets, retries, and CRUD server
construction.

Projection tables are read models. Contract state and Archive records remain
separate sources.

## Development Commands

```bash
pnpm --dir packages/indexer run check-types
pnpm --dir packages/indexer run test:unit
pnpm --dir packages/indexer run test:coverage

pnpm --dir packages/processor run check-types
pnpm --dir packages/processor run test:unit
pnpm --dir packages/processor run test:coverage
```

Schema changes need an additive API migration before deployment.

## Sources

- `packages/indexer/README.md`
- `packages/indexer/src/`
- `packages/processor/README.md`
- `packages/processor/src/`
- `apps/api/src/processors/proposals/`
- `apps/api/src/db/migrations/`
