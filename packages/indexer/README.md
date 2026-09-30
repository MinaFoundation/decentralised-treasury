# @repo/indexer

Generic archive-events indexer for treasury-owner style contracts.

## What It Provides

- `ArchiveClient`: fetches archive GraphQL data (`networkState`, `blocks`, `events`)
- `EventsRepository`: persists normalized events + cursors
- `EventsIndexer`: polling loop for pending/canonical ingestion + orphan sweep
- `EventsApiServer`: read API over indexed events

## Event Typing Model

Event type is resolved at ingest and stored with the event row.

For a contract with multiple event types, the o1js discriminator in
`event.data[0]` is authoritative. The configured event names use the same
`Array.prototype.sort()` lexical order as o1js. For a contract with one event
type, o1js does not add a discriminator.

The indexer keeps `raw_event_data` unchanged. It does not remove the
discriminator. A malformed event or an event with an unresolved type goes to
`archive_event_rejections`. Other valid observations in the range continue.

## Data Model

- `archive_events`
  - identity key: `(tx_hash, account_update_index, event_index)`
  - block identity evidence: `global_slot_since_genesis`, `state_hash`,
    `parent_hash`, and `chain_status` when supplied by Archive
  - lifecycle fields: `status`, `pending_seen_at_height`
  - same-block contract-order field: `block_event_index`
  - preferred API cursor: monotonic bigint `change_sequence`, represented as a
    decimal string
  - transition API cursor: `updated_at`, `id`
- `archive_event_rejections`
  - durable malformed or unresolved observations, reason, occurrence count,
    source position, and exact raw observation
- `indexer_cursors`
  - cursor names:
    - `events:pending`
    - `events:canonical`
- `indexer_runtime_status`
  - last start, success, or failure state for each polling operation

`EventsRepository.getOperationalStatus()` reports unresolved rejection and
failed-operation details for readiness checks. After operator review and source
correction, `resolveRejection(id)` closes one rejection. A later occurrence of
the same invalid observation reopens it.

## Polling Behavior (`EventsIndexer`)

- pending sync validates and refreshes the entire pending branch on each poll
- canonical sync polls with overlap:
  - `from = max(0, canonicalCursor - canonicalOverlapBlocks + 1)`
- orphan sweep marks old `pending` rows as `orphaned` based on canonical cursor and
  `orphanDepthBlocks`
- a complete pending refresh retires every prior pending identity absent from the selected branch
- newly canonical observations retire the old pending selection until the next complete pending refresh
- only an explicit Archive `events` array is a complete snapshot; a null or
  absent collection fails the range fetch
- invalid observations reject the complete pending replacement; the prior snapshot remains intact
- accepted events, rejection rows, and a range cursor commit in one transaction
- cursor height advances monotonically when concurrent workers finish out of order
- an observation that changes an existing transaction event's immutable type or
  contract event data goes to `archive_event_rejections`
- startup rejects if an initial sync fails
- shutdown waits for active sync and sweep operations before it closes storage

`block_event_index` records same-block contract order from the Archive
transaction sequence, the account-update position, and the event index. This
order matches the tuple used to order reducer actions. Legacy Archive responses
and test fixtures can omit the transaction sequence. For such a block, the
indexer uses response order for all events in that block. It does not mix the
two order sources. If only part of a block has transaction sequence metadata,
the indexer quarantines that block. The stored block identity fields support branch-aware
reconciliation, but they do not select a branch by themselves.

The Archive transaction sequence is observation metadata. A later observation
can add it to a legacy stored event when the event identity, type, and contract
data are unchanged. This update stores the metadata and advances the event
change sequence, which lets consumers replay the corrected order.

## HTTP API (`EventsApiServer`)

- `GET /healthz`
- `GET /events`

Query params:

- `limit`
- `changeSequenceAfter` (preferred explicit mode)
- `updatedAfter`
- `eventIdAfter`
- `eventTypes` (CSV)
- `includeUnknown` (`true|false`)

Response:

- explicit `changeSequenceAfter` requests order by `change_sequence` and return
  `{ changeSequenceAfter } | null`
- requests without a cursor, and requests with both legacy fields, order by
  `updated_at`, then `id`, and return `{ updatedAfter, eventIdAfter } | null`
- new and legacy cursor fields cannot be mixed

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
pnpm --dir packages/indexer run test:unit
pnpm --dir packages/indexer run test:coverage
```

Production requires an additive database migration. It must create the two new
tables, add and backfill `block_event_index` and `change_sequence`, create the
`archive_event_change_sequence_seq` sequence and indexes, and install the
commit-order trigger that assigns `change_sequence` on inserts and semantic
updates. Do not deploy this package before that migration is applied.

### Selected Archive branch and stable event identity

Pending ingestion reads complete block ancestry, including blocks without Treasury events.
It validates every parent back to the latest canonical block and checks the tip again after fetching events.
It publishes the new pending set atomically and retires the previous branch.
Canonical observations retain priority. Projection checks also reject known conflicts among pending facts.

Archive API `0.0.9` requires `ENABLE_BLOCK_TRANSACTION_DETAILS=true` to return parent hashes from `blocks`.
Its event query filters tied tips independently. The indexer therefore uses canonical events only while maximum-height pending tips are tied.
The existing indexer status reports this ambiguity as a failed pending operation.
The next poll restores pending projection after one complete, stable tip is available.
Missing ancestry or an Archive change during a read also prevents pending publication.
This fallback does not implement an externally pinned best-tip event query.

Event identity is `(txHash, accountUpdateIndex, eventIndex)`.
`accountUpdateId` is Archive metadata and can change after an Archive rebuild.
Re-reading renumbered records updates the same event instead of creating another projection effect.
Immutable payload conflicts remain rejected.
