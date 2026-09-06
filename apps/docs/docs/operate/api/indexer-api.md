---
title: Indexer API
sidebar_label: Indexer API
sidebar_position: 3
audience: operator
page_kind: reference
---

# Indexer API

The Indexer API publishes typed event rows and indexer progress.
It listens on container port `4001` by default.

Use `http://127.0.0.1:4101` for the local direct proxy.
Use `/indexer` below the web origin for same-origin requests.

## Route summary

| Method | Direct path | Same-origin path   |
| ------ | ----------- | ------------------ |
| `GET`  | `/healthz`  | `/indexer/healthz` |
| `GET`  | `/readyz`   | `/indexer/readyz`  |
| `GET`  | `/events`   | `/indexer/events`  |
| `GET`  | `/status`   | `/indexer/status`  |

## Health

### `GET /healthz`

Direct request: `GET http://127.0.0.1:4101/healthz`.
Same-origin request: `GET /indexer/healthz`.

The route has no parameters or body.

Response `200`:

```json
{
  "ok": true
}
```

This response only means that the Indexer API process responds.
It does not query Postgres or Archive GraphQL.

## Readiness

### `GET /readyz`

Direct request: `GET http://127.0.0.1:4101/readyz`.
Same-origin request: `GET /indexer/readyz`.

The route queries Archive GraphQL and the indexer operation records.
The indexer is ready only when these conditions are true:

- no event rejection is unresolved;
- no indexer operation failed;
- all required indexer operations have records;
- no required indexer operation record is stale.

The required operations are the pending scan, the canonical scan, and the orphan sweep.
Response `200` uses the detailed status model from `GET /status`.
Response `503` uses that model with `ok=false` and `ready=false`.

A dependency failure returns this response with status `503`:

```json
{
  "ok": false,
  "error": "Service unavailable"
}
```

## Read indexed events

### `GET /events`

Direct request: `GET http://127.0.0.1:4101/events`.
Same-origin request: `GET /indexer/events`.

Query parameters:

| Name                  | Required | Default                  | Meaning                                             |
| --------------------- | -------- | ------------------------ | --------------------------------------------------- |
| `changeSequenceAfter` | No       | Compatibility scan mode  | Return rows with a larger change sequence.          |
| `eventTypes`          | No       | Empty list               | Comma-separated event types.                        |
| `includeUnknown`      | No       | `true`                   | Include rows with event type `unknown`.             |
| `limit`               | No       | `API_PAGE_LIMIT_DEFAULT` | Positive page size, capped at `API_PAGE_LIMIT_MAX`. |

Set `changeSequenceAfter=0` on the first request of a new scan.
The route then orders rows by `changeSequence` in ascending order.
Use `nextCursor.changeSequenceAfter` in the next request.

The API keeps an old cursor mode for compatibility when this parameter is absent.
New clients must use the change-sequence cursor.
Pass all required event types as one comma-separated value.

The event-type filter has these exact cases:

| `eventTypes` | `includeUnknown` | Result type filter             |
| ------------ | ---------------- | ------------------------------ |
| Non-empty    | `true`           | Specified types and `unknown`. |
| Non-empty    | `false`          | Specified types only.          |
| Empty        | `true`           | `unknown` only.                |
| Empty        | `false`          | Empty result.                  |

The current indexer rejects an event when it cannot resolve a configured type.
The `unknown` filter remains available for existing or generic repository rows.

Response `200`:

```json
{
  "items": [
    {
      "id": "121",
      "changeSequence": "145",
      "status": "canonical",
      "pendingSeenAtHeight": 420010,
      "blockHeight": 420000,
      "blockTimestamp": "2026-08-01T12:00:00.000Z",
      "globalSlotSinceGenesis": 1400000,
      "stateHash": "3NKBlockStateHash",
      "parentHash": "3NKParentStateHash",
      "chainStatus": "canonical",
      "eventType": "proposalCreated",
      "txHash": "5JuTransactionHash",
      "accountUpdateId": "3",
      "accountUpdateIndex": 0,
      "eventIndex": 0,
      "blockEventIndex": 4,
      "rawEventData": {
        "accountUpdateId": "3",
        "data": ["0", "123", "456"],
        "eventType": "proposalCreated",
        "transactionInfo": {
          "hash": "5JuTransactionHash",
          "sequenceNumber": 2,
          "zkappAccountUpdateIds": [3]
        }
      },
      "indexedAt": "2026-08-01T12:00:05.000Z",
      "updatedAt": "2026-08-01T12:01:00.000Z"
    }
  ],
  "nextCursor": {
    "changeSequenceAfter": "145"
  }
}
```

`nextCursor.changeSequenceAfter` equals the last returned `changeSequence`.
It is `null` only when the response has no items.

The presence of `nextCursor` does not prove that another page exists.
Request the next page until `items` is empty.

Response fields:

| Field                    | Type                 | Meaning                                                       |
| ------------------------ | -------------------- | ------------------------------------------------------------- |
| `id`                     | string               | Stable Postgres event identifier.                             |
| `changeSequence`         | string               | Monotonic sequence for each insert or material row change.    |
| `status`                 | string               | `pending`, `canonical`, or `orphaned`.                        |
| `pendingSeenAtHeight`    | number or `null`     | Height when the indexer first saw the row as pending.         |
| `blockHeight`            | number or `null`     | Event block height.                                           |
| `blockTimestamp`         | ISO string or `null` | Event block time when Archive supplies it.                    |
| `globalSlotSinceGenesis` | number or `null`     | Archive global slot for the event block.                      |
| `stateHash`              | string or `null`     | State hash for the event block.                               |
| `parentHash`             | string or `null`     | Parent state hash for the event block.                        |
| `chainStatus`            | string or `null`     | Archive chain-status value for the event block.               |
| `eventType`              | string               | Resolved contract event name.                                 |
| `txHash`                 | string               | Mina transaction hash.                                        |
| `accountUpdateId`        | string               | Archive account-update identifier.                            |
| `accountUpdateIndex`     | number               | Account-update position in the transaction.                   |
| `eventIndex`             | number               | Event position in the account update.                         |
| `blockEventIndex`        | number               | Stable source position of the event in its block observation. |
| `rawEventData`           | object               | Archive event payload.                                        |
| `indexedAt`              | ISO string           | Initial Postgres insert time.                                 |
| `updatedAt`              | ISO string           | Last material event-row update time.                          |

The event identity uses `txHash`, `accountUpdateId`, `accountUpdateIndex`, and `eventIndex`.
The block identity fields let the processor detect conflicting or disconnected observations.
The indexer uses the Archive transaction sequence to calculate `blockEventIndex` when it is available.

Pending and canonical rows both enter the active processor projection.
An orphaned row is rollback input and is not active projection data.

Additional status codes:

- `400` for an invalid limit, boolean, or change-sequence cursor;
- `500` when the repository query fails.

## Read indexer progress

### `GET /status`

Direct request: `GET http://127.0.0.1:4101/status`.
Same-origin request: `GET /indexer/status`.

The route has no parameters or body.
It queries Archive GraphQL heads and stored Postgres cursors.

Response `200`:

```json
{
  "ok": true,
  "ready": true,
  "archive": {
    "canonicalMaxBlockHeight": 420100,
    "pendingMaxBlockHeight": 420125
  },
  "pendingCursor": 420120,
  "canonicalCursor": 420095,
  "remainingPendingBlocks": 5,
  "remainingCanonicalBlocks": 5,
  "rejections": {
    "total": 0,
    "unresolved": 0
  },
  "runtime": {
    "operations": [
      {
        "operationName": "events:pending",
        "state": "succeeded",
        "updatedAt": "2026-08-01T12:01:00.000Z",
        "lastStartedAt": "2026-08-01T12:00:59.000Z",
        "lastSucceededAt": "2026-08-01T12:01:00.000Z",
        "lastFailedAt": null,
        "lastError": null
      },
      {
        "operationName": "events:canonical",
        "state": "succeeded",
        "updatedAt": "2026-08-01T12:01:00.000Z",
        "lastStartedAt": "2026-08-01T12:00:59.000Z",
        "lastSucceededAt": "2026-08-01T12:01:00.000Z",
        "lastFailedAt": null,
        "lastError": null
      },
      {
        "operationName": "events:orphan-sweep",
        "state": "succeeded",
        "updatedAt": "2026-08-01T12:01:00.000Z",
        "lastStartedAt": "2026-08-01T12:00:59.000Z",
        "lastSucceededAt": "2026-08-01T12:01:00.000Z",
        "lastFailedAt": null,
        "lastError": null
      }
    ],
    "failedOperations": [],
    "missingOperations": [],
    "staleOperations": [],
    "maxAgeMs": 30000
  }
}
```

Response fields:

| Field                             | Type             | Meaning                                           |
| --------------------------------- | ---------------- | ------------------------------------------------- |
| `ok`                              | boolean          | The status query completed.                       |
| `ready`                           | boolean          | All indexer readiness conditions are true.        |
| `archive.canonicalMaxBlockHeight` | number           | Canonical Archive head.                           |
| `archive.pendingMaxBlockHeight`   | number           | Pending Archive head.                             |
| `pendingCursor`                   | number or `null` | Last pending block processed.                     |
| `canonicalCursor`                 | number or `null` | Last canonical block processed.                   |
| `remainingPendingBlocks`          | number           | Pending head minus the pending cursor.            |
| `remainingCanonicalBlocks`        | number           | Canonical head minus the canonical cursor.        |
| `rejections.total`                | number           | Total stored rejected observations.               |
| `rejections.unresolved`           | number           | Rejected observations not marked as resolved.     |
| `runtime.operations`              | array            | Current records for indexer operations.           |
| `runtime.failedOperations`        | array            | Operations whose last recorded state is `failed`. |
| `runtime.missingOperations`       | string array     | Required operations that have no record.          |
| `runtime.staleOperations`         | string array     | Required operations with an old update time.      |
| `runtime.maxAgeMs`                | number           | Maximum accepted age for an operation record.     |

A missing cursor uses `-1` for the remaining-block calculation.
This makes the initial remaining count equal to head plus one.

The route returns `200` after a successful status query, even when `ready` is `false`.

Response `503` after a dependency query fails:

```json
{
  "ok": false,
  "error": "Service unavailable"
}
```

This result can indicate an Archive or Postgres query failure.

## Event pagination example

First request:

```text
GET /events?changeSequenceAfter=0&eventTypes=proposalCreated,proposalVoteDispatched&includeUnknown=false&limit=50
```

Next request:

```text
GET /events?changeSequenceAfter=145&eventTypes=proposalCreated,proposalVoteDispatched&includeUnknown=false&limit=50
```

Keep the same event-type filter for all pages in one scan.

## Sources

- `apps/api/src/indexer-api.ts`
- `apps/api/src/indexer-status-routes.ts`
- `packages/indexer/src/events-api-server.ts`
- `packages/indexer/src/events-repository.ts`
- `packages/indexer/src/entities.ts`
- `packages/indexer/src/archive/client.ts`
- `devops/proxy/Caddyfile`
