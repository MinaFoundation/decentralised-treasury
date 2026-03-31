# @repo/indexer

Generic archive-events indexer for treasury-owner style contracts.

## What It Provides

- `ArchiveClient`: fetches archive GraphQL data (`networkState`, `events`)
- `EventsRepository`: persists normalized events + cursors
- `EventsIndexer`: polling loop for pending/canonical ingestion + orphan sweep
- `EventsApiServer`: read API over indexed events

## Event Typing Model

Event type is resolved at ingest and stored with the event row.

Resolution order:

1. archive-reported type fields (`eventType`, `eventName`, `name`, `type`)
2. encoded event-type index from `event.data[0]` using configured `knownEventTypes`

If event type cannot be resolved, ingest throws. There is no automatic
post-processing patch of `event_type`.

## Data Model

- `archive_events`
  - identity key: `(tx_hash, account_update_id, account_update_index, event_index)`
  - lifecycle fields: `status`, `pending_seen_at_height`
  - cursor fields used by API polling: `updated_at`, `id`
- `indexer_cursors`
  - cursor names:
    - `events:pending`
    - `events:canonical`

## Polling Behavior (`EventsIndexer`)

- pending sync polls `[cursor+1 .. pendingHead]`
- canonical sync polls with overlap:
  - `from = max(0, canonicalCursor - canonicalOverlapBlocks + 1)`
- orphan sweep marks old `pending` rows as `orphaned` based on canonical cursor and
  `orphanDepthBlocks`

## HTTP API (`EventsApiServer`)

- `GET /healthz`
- `GET /v1/indexer/events`

Query params:

- `limit`
- `updatedAfter`
- `eventIdAfter`
- `eventTypes` (CSV)
- `includeUnknown` (`true|false`)

Response:

- `items`: ordered by `updated_at`, then `id`
- `nextCursor`: `{ updatedAfter, eventIdAfter } | null`

Error status strategy:

- `400` for query validation errors
- `500` for repository/internal errors

## Typical Construction

`EventsIndexer.fromConfig(...)` expects:

- archive settings (`archiveNodeUrl`, contract address/token)
- DB settings (`databaseUrl`, `databaseSchema`)
- polling settings
- `knownEventTypes` (typically derived from contract class events map)

`EventsApiServer` is typically constructed with the same repository instance used by
the indexer API process.

## Development

```bash
pnpm --dir packages/indexer run check-types
pnpm --dir packages/indexer run test
```
