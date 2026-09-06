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
2. fetch events from the indexer API with `changeSequenceAfter`
3. dispatch one event through `EventProcessorRouter` in one DB transaction
4. update the processor offset in the same transaction
5. repeat for the remaining events in the page

Important behavior:

- processor fetches with `includeUnknown=false`
- processor does not mutate `event_type` in indexer after processing
- if no handlers are registered, processor processes nothing
- one failed event cannot roll back an earlier successful event in the page
- one event gets five total attempts with exponential backoff
- a failed current event blocks later processing
- on each poll, one configured page is checked for a newer immutable version of
  the same Archive event; when found, the old failure becomes `superseded` and
  normal ordered processing resumes without moving the offset during the check
- a blocked event that has no proved successor requires `retryBlockedEvent()`
- indexer and database failures do not consume event attempts
- poll ticks refresh the runtime heartbeat while an event or retry wait is active
- `stop()` waits for active work; the application owns process signal handling

## Offset / Cursor Semantics

The active cursor uses the indexer's monotonic `change_sequence`. The legacy
`last_seen_updated_at` and `last_seen_event_id` fields remain in
`processor_offsets` for migration and status API compatibility.

The processor writes event failures to `processor_event_failures` and lifecycle
health to `processor_runtime_status`. A blocked failure is not retried by the
polling loop. The processor can retire it only when a bounded source scan proves
that the same Archive event ID has a greater change sequence and unchanged event
type, transaction identity, and raw contract payload. The scan does not advance
the offset, so intervening events remain ordered and unprocessed until normal
processing resumes. If the successor is outside that one-page bound, an operator
must call `retryBlockedEvent()` explicitly. The retry method can run as a
one-shot operation: it initializes and closes its data source when the polling
loop is not already running.

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
pnpm --dir packages/processor run test:unit
pnpm --dir packages/processor run test:coverage
```
