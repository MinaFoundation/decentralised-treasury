---
title: Processor API
sidebar_label: Processor API
sidebar_position: 4
audience: operator
page_kind: reference
---

# Processor API

The Processor API publishes generic projection records and processor progress.
It listens on container port `4002` by default.

Use `http://127.0.0.1:4102` for the local direct proxy.
Use `/processor` below the web origin for same-origin requests.

The smart-contract methods are the business source of truth.
Pending and canonical events both affect one current projection.
Pending data differs from canonical data only by finality and rollback eligibility.
Promotion to canonical changes finality only and does not apply an event again.
Orphaning removes the event effect and recomputes from the remaining active events.
Projection routes return active pending and canonical rows. They exclude orphaned rows.

## Route summary

| Method | Direct path                | Same-origin path                     |
| ------ | -------------------------- | ------------------------------------ |
| `GET`  | `/healthz`                 | `/processor/healthz`                 |
| `GET`  | `/readyz`                  | `/processor/readyz`                  |
| `GET`  | `/status`                  | `/processor/status`                  |
| `GET`  | `/proposals`               | `/processor/proposals`               |
| `GET`  | `/proposals/:id`           | `/processor/proposals/:id`           |
| `GET`  | `/votes`                   | `/processor/votes`                   |
| `GET`  | `/votes/:id`               | `/processor/votes/:id`               |
| `GET`  | `/vote-nullifiers`         | `/processor/vote-nullifiers`         |
| `GET`  | `/vote-nullifiers/:id`     | `/processor/vote-nullifiers/:id`     |
| `GET`  | `/vote-tallies`            | `/processor/vote-tallies`            |
| `GET`  | `/vote-tallies/:id`        | `/processor/vote-tallies/:id`        |
| `GET`  | `/proposal-executions`     | `/processor/proposal-executions`     |
| `GET`  | `/proposal-executions/:id` | `/processor/proposal-executions/:id` |

The API is read-only.
It does not register create, update, replace, or delete routes.

## Health

### `GET /healthz`

Direct request: `GET http://127.0.0.1:4102/healthz`.
Same-origin request: `GET /processor/healthz`.

The route has no parameters or body.

Response `200`:

```json
{
  "ok": true
}
```

This response only means that the Processor API process responds.
It does not query Postgres or test the processor worker.

## Readiness

### `GET /readyz`

Direct request: `GET http://127.0.0.1:4102/readyz`.
Same-origin request: `GET /processor/readyz`.

The route checks the database, the required projection tables, and processor readiness.
Processor readiness requires these conditions:

- the processor state is `running` or `idle`;
- the processor heartbeat is not stale;
- no processor event failure is due;
- the proposal projection replay is complete.

Response `200`:

```json
{
  "ok": true
}
```

Response `503`:

```json
{
  "ok": false,
  "error": "Service unavailable"
}
```

## Processor progress

### `GET /status`

Direct request: `GET http://127.0.0.1:4102/status`.
Same-origin request: `GET /processor/status`.

The route has no parameters or body.
It reads the processor offset and counts later handled events.

Response `200`:

```json
{
  "ok": true,
  "ready": true,
  "processorName": "proposal-processor",
  "offset": {
    "lastSeenUpdatedAt": "2026-08-01T12:01:00.000Z",
    "lastSeenEventId": "121",
    "lastSeenChangeSequence": "145",
    "updatedAt": "2026-08-01T12:01:02.000Z"
  },
  "remainingEvents": 4,
  "runtime": {
    "lifecycleState": "idle",
    "heartbeatAt": "2026-08-01T12:01:03.000Z",
    "lastSuccessAt": "2026-08-01T12:01:02.000Z",
    "lastErrorAt": null,
    "lastErrorCode": null,
    "boundedLastError": null,
    "updatedAt": "2026-08-01T12:01:03.000Z"
  },
  "projectionReplay": {
    "projectionName": "proposal",
    "targetChangeSequence": "145",
    "state": "complete",
    "completedAt": "2026-08-01T12:01:02.000Z",
    "updatedAt": "2026-08-01T12:01:02.000Z"
  },
  "failures": {
    "due": 0
  }
}
```

`offset` is `null` before the processor stores its first position.
`remainingEvents` counts configured treasury event types after `lastSeenChangeSequence`.

The count does not include unrelated event types.
Compare the offset and count at two different times.

The route returns `200` when `ready` is `true`.
It returns `503` with the same detailed model when `ready` is `false`.
The readiness rules are the same as the rules for `GET /readyz`.

Response `503` after a dependency query fails:

```json
{
  "ok": false,
  "error": "Service unavailable"
}
```

## Collection query model

All five collection routes accept these query parameters:

| Name     | Required | Meaning                                             |
| -------- | -------- | --------------------------------------------------- |
| `limit`  | No       | Positive page size, capped at `API_PAGE_LIMIT_MAX`. |
| `offset` | No       | Non-negative row offset. Default is `0`.            |
| `sort`   | No       | Repeated `field,direction` value.                   |
| `join`   | No       | Repeated TypeORM relation path.                     |

The default page size is `API_PAGE_LIMIT_DEFAULT`.
The repository defaults are `50` and `200`.

Each entity field is a valid sort field for its route.
The direction is `ASC` or `DESC`.

The default order is `updatedAt,DESC`, then `id,DESC`.
Client sort fields run before missing default fields.

Each valid TypeORM relation can be joined.
Use dot notation for a valid nested relation path.

Collection response envelope:

```json
{
  "data": [],
  "count": 0,
  "total": 0,
  "page": 1,
  "pageCount": 0
}
```

`count` is the number of records in `data`.
`total` is the total record count before pagination.

`page` is `floor(offset / limit) + 1`.
`pageCount` is `ceil(total / limit)`.

Collection status codes:

- `200` for a successful query;
- `400` for an invalid limit, offset, sort, or join;
- `500` for a Postgres or internal failure.

Collections contain active rows only. An active row has `pending` or `canonical` source status.

## Item query model

All item routes use the numeric projection `id` path parameter.
They accept repeated `join` query parameters.

Item status codes:

- `200` when the record exists;
- `400` for an invalid join;
- `404` when the record does not exist;
- `500` for a Postgres or internal failure.

An item route returns `404` after its source event becomes orphaned.

## Proposal projections

Proposal fields:

| Field                                 | Type                 |
| ------------------------------------- | -------------------- |
| `id`                                  | string               |
| `proposalPublicKey`                   | string               |
| `lifecycleId`                         | number               |
| `amount`                              | string               |
| `recipient`                           | string               |
| `senderPublicKey`                     | string or `null`     |
| `zkAppUriHash`                        | string               |
| `stakingEpochDataLedgerHash`          | string or `null`     |
| `stakingEpochDataLedgerTotalCurrency` | string or `null`     |
| `requiredParticipationBp`             | string or `null`     |
| `requiredApprovalBp`                  | string or `null`     |
| `requiredParticipation`               | string or `null`     |
| `status`                              | string               |
| `contractStatus`                      | string               |
| `contractStatusFinality`              | string               |
| `contractStatusSourceEventId`         | string or `null`     |
| `contractStatusBlockHeight`           | number or `null`     |
| `creationObservationStatus`           | string               |
| `isPaused`                            | boolean              |
| `paidOutAmount`                       | string               |
| `contents`                            | string or `null`     |
| `createdAtBlockHeight`                | number or `null`     |
| `createdAtBlockTimestamp`             | ISO string or `null` |
| `createdAt`                           | ISO string           |
| `updatedAt`                           | ISO string           |

Valid first-level joins are `voteTallies`, `votes`, `voteNullifiers`, and
`executions`.

### `GET /proposals`

Direct request: `GET http://127.0.0.1:4102/proposals?limit=20&sort=lifecycleId,DESC`.
Same-origin request: `GET /processor/proposals?limit=20&sort=lifecycleId,DESC`.

Response `200`:

```json
{
  "data": [
    {
      "id": "18",
      "proposalPublicKey": "B62qProposal",
      "lifecycleId": 3,
      "amount": "10000000000",
      "recipient": "B62qRecipient",
      "senderPublicKey": "B62qSender",
      "zkAppUriHash": "192837465",
      "stakingEpochDataLedgerHash": "99887766",
      "stakingEpochDataLedgerTotalCurrency": "1000000000000000",
      "requiredParticipationBp": "2450",
      "requiredApprovalBp": "5620",
      "requiredParticipation": "245000000000000",
      "status": "canonical",
      "contractStatus": "approved",
      "contractStatusFinality": "canonical",
      "contractStatusSourceEventId": "130",
      "contractStatusBlockHeight": 421200,
      "creationObservationStatus": "canonical",
      "isPaused": false,
      "paidOutAmount": "0",
      "contents": null,
      "createdAtBlockHeight": 420000,
      "createdAtBlockTimestamp": "2026-08-01T12:00:00.000Z",
      "createdAt": "2026-08-01T12:00:01.000Z",
      "updatedAt": "2026-08-01T12:00:01.000Z"
    }
  ],
  "count": 1,
  "total": 1,
  "page": 1,
  "pageCount": 1
}
```

### `GET /proposals/:id`

Direct request: `GET http://127.0.0.1:4102/proposals/18`.
Same-origin request: `GET /processor/proposals/18`.

Response `200`:

```json
{
  "id": "18",
  "proposalPublicKey": "B62qProposal",
  "lifecycleId": 3,
  "amount": "10000000000",
  "recipient": "B62qRecipient",
  "senderPublicKey": "B62qSender",
  "zkAppUriHash": "192837465",
  "stakingEpochDataLedgerHash": "99887766",
  "stakingEpochDataLedgerTotalCurrency": "1000000000000000",
  "requiredParticipationBp": "2450",
  "requiredApprovalBp": "5620",
  "requiredParticipation": "245000000000000",
  "status": "canonical",
  "contractStatus": "approved",
  "contractStatusFinality": "canonical",
  "contractStatusSourceEventId": "130",
  "contractStatusBlockHeight": 421200,
  "creationObservationStatus": "canonical",
  "isPaused": false,
  "paidOutAmount": "0",
  "contents": null,
  "createdAtBlockHeight": 420000,
  "createdAtBlockTimestamp": "2026-08-01T12:00:00.000Z",
  "createdAt": "2026-08-01T12:00:01.000Z",
  "updatedAt": "2026-08-01T12:00:01.000Z"
}
```

## Vote projections

Vote fields are `id`, `archiveEventId`, `proposalPublicKey`, and `voterPublicKey`.
They also include `vote`, `voteWeight`, `blockHeight`, `blockEventIndex`, `isNullified`, and `status`.
The timestamp fields are `createdAt` and `updatedAt`.

`voteWeight` and `isNullified` are non-null ownership fields:

- an active exact owner has a string weight and `isNullified=false`;
- an active exact duplicate has `voteWeight="0"` and `isNullified=true`.

The Processor API returns pending and canonical vote rows.
It excludes orphaned vote rows.
Use `status` to read each active row's finality.

The valid first-level join is `proposal`.

### `GET /votes`

Direct request: `GET http://127.0.0.1:4102/votes?limit=20&sort=blockHeight,DESC`.
Same-origin request: `GET /processor/votes?limit=20&sort=blockHeight,DESC`.

Response `200`:

```json
{
  "data": [
    {
      "id": "55",
      "archiveEventId": "121",
      "proposalPublicKey": "B62qProposal",
      "voterPublicKey": "B62qVoter",
      "vote": "yay",
      "voteWeight": "300000",
      "blockHeight": 420500,
      "blockEventIndex": 4,
      "isNullified": false,
      "status": "canonical",
      "createdAt": "2026-08-01T13:00:00.000Z",
      "updatedAt": "2026-08-01T13:01:00.000Z"
    }
  ],
  "count": 1,
  "total": 1,
  "page": 1,
  "pageCount": 1
}
```

### `GET /votes/:id`

Direct request: `GET http://127.0.0.1:4102/votes/55`.
Same-origin request: `GET /processor/votes/55`.

Response `200`:

```json
{
  "id": "55",
  "archiveEventId": "121",
  "proposalPublicKey": "B62qProposal",
  "voterPublicKey": "B62qVoter",
  "vote": "yay",
  "voteWeight": "300000",
  "blockHeight": 420500,
  "blockEventIndex": 4,
  "isNullified": false,
  "status": "canonical",
  "createdAt": "2026-08-01T13:00:00.000Z",
  "updatedAt": "2026-08-01T13:01:00.000Z"
}
```

## Vote-nullifier projections

Vote-nullifier fields are `id`, `sourceEventId`, `proposalPublicKey`, and `voterPublicKey`.
They also include `vote`, `voteWeight`, `blockHeight`, `createdAt`, and `updatedAt`.

`processor_vote_nullifiers` contains exact active source ownership only.
It has no row for an orphaned vote.
The first active source-ordered vote is the only owner.
`sourceEventId` identifies the exact active vote that owns the nullifier.

The valid first-level join is `proposal`.

### `GET /vote-nullifiers`

Direct request: `GET http://127.0.0.1:4102/vote-nullifiers?limit=20`.
Same-origin request: `GET /processor/vote-nullifiers?limit=20`.

Response `200`:

```json
{
  "data": [
    {
      "id": "31",
      "sourceEventId": "121",
      "proposalPublicKey": "B62qProposal",
      "voterPublicKey": "B62qVoter",
      "vote": "yay",
      "voteWeight": "300000",
      "blockHeight": 420500,
      "createdAt": "2026-08-01T13:00:00.000Z",
      "updatedAt": "2026-08-01T13:01:00.000Z"
    }
  ],
  "count": 1,
  "total": 1,
  "page": 1,
  "pageCount": 1
}
```

### `GET /vote-nullifiers/:id`

Direct request: `GET http://127.0.0.1:4102/vote-nullifiers/31`.
Same-origin request: `GET /processor/vote-nullifiers/31`.

Response `200`:

```json
{
  "id": "31",
  "sourceEventId": "121",
  "proposalPublicKey": "B62qProposal",
  "voterPublicKey": "B62qVoter",
  "vote": "yay",
  "voteWeight": "300000",
  "blockHeight": 420500,
  "createdAt": "2026-08-01T13:00:00.000Z",
  "updatedAt": "2026-08-01T13:01:00.000Z"
}
```

## Vote-tally projections

Vote-tally fields are `id`, `archiveEventId`, `sourceStatus`, `blockHeight`, and `blockEventIndex`.
`archiveEventId` is `null` for a running tally made from vote events.
`sourceStatus` is `pending` or `canonical` for an active tally.

Each tally also has three weight fields.
The weight fields are `yayWeight`, `nayWeight`, and `abstainWeight`.

The record also includes these fields:

- `requiredParticipationBp`;
- `requiredApprovalBp`;
- `requiredParticipation`;
- `totalParticipatingVotes`;
- `approvalBp`;
- `voteResult`;
- `createdByEventType`;
- `createdAt` and `updatedAt`.

The valid first-level join is `proposal`.

A proposal and block can contain more than one final tally row. Thus, a tally
row does not own the votes or nullifiers at the same block height.

### `GET /vote-tallies`

Direct request: `GET http://127.0.0.1:4102/vote-tallies?join=proposal&limit=20`.
Same-origin request: `GET /processor/vote-tallies?join=proposal&limit=20`.

Response `200` without a join:

```json
{
  "data": [
    {
      "id": "61",
      "archiveEventId": "130",
      "sourceStatus": "canonical",
      "proposalPublicKey": "B62qProposal",
      "blockHeight": 421200,
      "blockEventIndex": 5,
      "yayWeight": "800",
      "nayWeight": "200",
      "abstainWeight": "100",
      "requiredParticipationBp": "2450",
      "requiredApprovalBp": "5620",
      "requiredParticipation": "245000000000000",
      "totalParticipatingVotes": "1100",
      "approvalBp": "8000",
      "voteResult": "approved",
      "createdByEventType": "proposalVotesTallied",
      "createdAt": "2026-08-02T10:00:00.000Z",
      "updatedAt": "2026-08-02T10:00:00.000Z"
    }
  ],
  "count": 1,
  "total": 1,
  "page": 1,
  "pageCount": 1
}
```

### `GET /vote-tallies/:id`

Direct request: `GET http://127.0.0.1:4102/vote-tallies/61`.
Same-origin request: `GET /processor/vote-tallies/61`.

Response `200`:

```json
{
  "id": "61",
  "archiveEventId": "130",
  "sourceStatus": "canonical",
  "proposalPublicKey": "B62qProposal",
  "blockHeight": 421200,
  "blockEventIndex": 5,
  "yayWeight": "800",
  "nayWeight": "200",
  "abstainWeight": "100",
  "requiredParticipationBp": "2450",
  "requiredApprovalBp": "5620",
  "requiredParticipation": "245000000000000",
  "totalParticipatingVotes": "1100",
  "approvalBp": "8000",
  "voteResult": "approved",
  "createdByEventType": "proposalVotesTallied",
  "createdAt": "2026-08-02T10:00:00.000Z",
  "updatedAt": "2026-08-02T10:00:00.000Z"
}
```

## Proposal-execution projections

Execution fields are `id`, `archiveEventId`, `proposalPublicKey`, and `lifecycleId`.
They also include these fields:

- `recipient`;
- `amountToPayOut`;
- `proposalAmount`;
- `bondAmount`;
- `senderPublicKey`;
- `paidOutAmount`;
- `remainingAmount`;
- `blockHeight`;
- `blockEventIndex`;
- `status`;
- `createdAt` and `updatedAt`.

The valid first-level join is `proposal`.

### `GET /proposal-executions`

Direct request: `GET http://127.0.0.1:4102/proposal-executions?limit=20`.
Same-origin request: `GET /processor/proposal-executions?limit=20`.

Response `200`:

```json
{
  "data": [
    {
      "id": "72",
      "archiveEventId": "140",
      "proposalPublicKey": "B62qProposal",
      "lifecycleId": 3,
      "recipient": "B62qRecipient",
      "amountToPayOut": "5000000000",
      "proposalAmount": "10000000000",
      "bondAmount": "1000000000",
      "senderPublicKey": "B62qSender",
      "paidOutAmount": "5000000000",
      "remainingAmount": "6000000000",
      "blockHeight": 430000,
      "blockEventIndex": 2,
      "status": "canonical",
      "createdAt": "2026-08-03T12:00:00.000Z",
      "updatedAt": "2026-08-03T12:00:00.000Z"
    }
  ],
  "count": 1,
  "total": 1,
  "page": 1,
  "pageCount": 1
}
```

### `GET /proposal-executions/:id`

Direct request: `GET http://127.0.0.1:4102/proposal-executions/72`.
Same-origin request: `GET /processor/proposal-executions/72`.

Response `200`:

```json
{
  "id": "72",
  "archiveEventId": "140",
  "proposalPublicKey": "B62qProposal",
  "lifecycleId": 3,
  "recipient": "B62qRecipient",
  "amountToPayOut": "5000000000",
  "proposalAmount": "10000000000",
  "bondAmount": "1000000000",
  "senderPublicKey": "B62qSender",
  "paidOutAmount": "5000000000",
  "remainingAmount": "6000000000",
  "blockHeight": 430000,
  "blockEventIndex": 2,
  "status": "canonical",
  "createdAt": "2026-08-03T12:00:00.000Z",
  "updatedAt": "2026-08-03T12:00:00.000Z"
}
```

## Join examples

Get a proposal with execution rows:

```text
GET /proposals/18?join=executions
```

Get a proposal with its tallies, votes, and nullifiers:

```text
GET /proposals/18?join=voteTallies&join=votes&join=voteNullifiers
```

Get a vote and its proposal:

```text
GET /votes/55?join=proposal
```

Joined objects use the entity models from this page.
An unsupported relation path returns `400`.

## Sources

- `apps/api/src/processor-api.ts`
- `apps/api/src/processor-status-routes.ts`
- `apps/api/src/processor-crud-routes.ts`
- `apps/api/src/processors/proposals/proposal-entity.ts`
- `apps/api/src/processors/proposals/vote-entity.ts`
- `apps/api/src/processors/proposals/vote-nullifier-entity.ts`
- `apps/api/src/processors/proposals/vote-tally-entity.ts`
- `apps/api/src/processors/proposals/proposal-execution-entity.ts`
- `packages/processor/src/entities.ts`
- `devops/proxy/Caddyfile`
