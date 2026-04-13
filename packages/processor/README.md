# @repo/processor

Event processor runtime that consumes typed indexer events and writes projection
tables.

## What It Provides

- `EventsProcessor`: polling processor loop with persisted offset cursor
- `EventProcessorRouter`: dispatches events to typed handlers
- `IndexerEventsApiClient`: fetches events page-by-page from indexer API
- `ProcessorCrudApiServer`: optional generated CRUD API for projection entities

## Processing Model

`EventsProcessor` flow per poll:

1. read offset from `processor_offsets` by `processorName`
2. fetch events from indexer API using cursor:
   - `updatedAfter`
   - `eventIdAfter`
3. dispatch each event through `EventProcessorRouter` inside one DB transaction
4. upsert processor offset to the last processed event in that batch

Important behavior:

- processor fetches with `includeUnknown=false`
- processor does not mutate `event_type` in indexer after processing
- if no handlers are registered, processor processes nothing

## Offset / Cursor Semantics

Cursor uses `(updated_at, id)` ordering from indexer API for stable incremental
consumption without missing equal-timestamp rows.

## Processor CRUD API

`ProcessorCrudApiServer` builds a NestJS API using `@dataui/crud-typeorm` from
projection entity classes.

Default behavior from `fromConfig(...)`:

- route prefix: `processor`
- read-only CRUD routes (mutating CRUD endpoints excluded)
- `GET /<prefix>/healthz`
- generated entity routes, e.g. `ProposalEntity` -> `GET /<prefix>/proposals`

You can construct it with either:

- database connection config (`databaseUrl`, `databaseSchema`), or
- an initialized external `DataSource` (used in tests/e2e)

## Handler Contract

A handler implements:

- `eventType`: declared target event type
- `tryHandle(event, manager): Promise<boolean>`

Router behavior:

- try typed handler first when `event.eventType` matches
- then try other handlers as fallback

## Development

```bash
pnpm --dir packages/processor run check-types
pnpm --dir packages/processor run test
```
