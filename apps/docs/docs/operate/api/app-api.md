---
title: App API
sidebar_label: App API
sidebar_position: 2
audience: operator
page_kind: reference
---

# App API

The App API publishes user-oriented proposal and lifecycle data.
It listens on container port `4000` by default.

Use `http://127.0.0.1:4100` for the local direct proxy.
Use `/api` below the web origin for same-origin browser requests.

## Route summary

| Method | Direct path                                                   | Same-origin path                                                  |
| ------ | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| `GET`  | `/healthz`                                                    | `/api/healthz`                                                    |
| `GET`  | `/readyz`                                                     | `/api/readyz`                                                     |
| `GET`  | `/proposals`                                                  | `/api/proposals`                                                  |
| `GET`  | `/proposals/search`                                           | `/api/proposals/search`                                           |
| `GET`  | `/proposals/:proposalPublicKey`                               | `/api/proposals/:proposalPublicKey`                               |
| `GET`  | `/proposals/:proposalPublicKey/votes`                         | `/api/proposals/:proposalPublicKey/votes`                         |
| `GET`  | `/proposals/:proposalPublicKey/executions`                    | `/api/proposals/:proposalPublicKey/executions`                    |
| `POST` | `/proposals/content/verify`                                   | `/api/proposals/content/verify`                                   |
| `POST` | `/proposals/:id/content`                                      | `/api/proposals/:id/content`                                      |
| `GET`  | `/staking-ledger/lifecycles/:lifecycleId/witnesses/:index`    | `/api/staking-ledger/lifecycles/:lifecycleId/witnesses/:index`    |
| `GET`  | `/staking-ledger/lifecycles/:lifecycleId/accounts/:publicKey` | `/api/staking-ledger/lifecycles/:lifecycleId/accounts/:publicKey` |
| `GET`  | `/voting-ledger/lifecycles/:lifecycleId/accounts/:publicKey`  | `/api/voting-ledger/lifecycles/:lifecycleId/accounts/:publicKey`  |

## Common status codes

| Status | Meaning                                      |
| ------ | -------------------------------------------- |
| `200`  | The route completed successfully.            |
| `204`  | An allowed CORS preflight completed.         |
| `403`  | The request has a disallowed browser origin. |
| `500`  | An internal operation failed.                |

Some routes also return `400`, `404`, or `503`.
Those route sections list the additional results.

## Proposal response model

Proposal list, search, and detail routes use this common model.

The smart-contract methods are the business source of truth.
Pending and canonical events both affect one current projection.
Pending data differs from canonical data only by finality and rollback eligibility.
Promotion to canonical changes finality only and does not apply an event again.
Orphaning removes the event effect and recomputes the projection from the remaining active events.
These routes return active pending and canonical data. They exclude orphaned data.

| Field                                 | Type                     | Meaning                                                                               |
| ------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------- |
| `id`                                  | string                   | Internal projection identifier.                                                       |
| `proposalPublicKey`                   | string                   | Proposal account public key.                                                          |
| `lifecycleId`                         | number                   | Proposal lifecycle.                                                                   |
| `amount`                              | string                   | Requested amount in nanomina.                                                         |
| `recipient`                           | string                   | Recipient public key.                                                                 |
| `senderPublicKey`                     | string or `null`         | Transaction sender from the event.                                                    |
| `zkAppUriHash`                        | string                   | Committed proposal-content hash field.                                                |
| `stakingEpochDataLedgerHash`          | string or `null`         | Recorded staking-ledger hash.                                                         |
| `stakingEpochDataLedgerTotalCurrency` | string or `null`         | Recorded staking total currency.                                                      |
| `requiredParticipationBp`             | string or `null`         | Projected participation threshold in basis points.                                    |
| `requiredApprovalBp`                  | string or `null`         | Projected approval threshold in basis points.                                         |
| `requiredParticipation`               | string or `null`         | Projected required voting weight.                                                     |
| `status`                              | string                   | Projection status of the proposal-creation event.                                     |
| `creationObservationStatus`           | `pending` or `canonical` | Current finality of the proposal-creation event.                                      |
| `contractStatus`                      | string                   | Current status reconstructed from active events by using stable source order.         |
| `contractStatusFinality`              | `pending` or `canonical` | Finality of the active event that last changed `contractStatus`.                      |
| `contractStatusSourceEventId`         | string or `null`         | Event that last changed `contractStatus`, or `null` for the initial `unknown` status. |
| `statusAsOfBlockHeight`               | number or `null`         | Block height of the event that supplied `contractStatus`.                             |
| `isPaused`                            | boolean                  | Projected proposal pause value.                                                       |
| `paidOutAmount`                       | string                   | Projected cumulative execution amount.                                                |
| `totalPayoutAmount`                   | string                   | Contract payout cap, including the proposal bond.                                     |
| `remainingPayoutAmount`               | string                   | Amount available below the contract payout cap.                                       |
| `payoutAmountIntegrity`               | boolean                  | Whether payout values are in the contract `UInt64` domain.                            |
| `contents`                            | string or `null`         | Stored proposal Markdown.                                                             |
| `createdAtBlockHeight`                | number or `null`         | Creation event block height.                                                          |
| `createdAtBlockTimestamp`             | ISO string or `null`     | Creation event block time.                                                            |
| `createdAt`                           | ISO string               | Projection creation time.                                                             |
| `updatedAt`                           | ISO string               | Projection update time.                                                               |
| `latestVoteTally`                     | object or `null`         | Latest exact projected tally by block height.                                         |
| `runningVoteTally`                    | object or `null`         | Latest running tally from active vote facts.                                          |
| `finalVoteTally`                      | object or `null`         | Current final tally selected by the active contract-status source.                    |
| `historicalFinalVoteTally`            | object or `null`         | Earlier active final tally selected by the status source.                             |

`latestVoteTally` has these fields:

- `blockHeight`;
- `yayWeight`, `nayWeight`, and `abstainWeight`;
- `createdByEventType`;
- `requiredParticipationBp` and `requiredApprovalBp`;
- `requiredParticipation` and `totalParticipatingVotes`;
- `approvalBp` and `voteResult`.

These values are projections.
The Proposal smart contract is authoritative for result and pause behavior.

`runningVoteTally` is calculated from active vote facts in stable source order.
`finalVoteTally` is the tally selected by the active contract-status source event.

## Health

### `GET /healthz`

Direct request: `GET http://127.0.0.1:4100/healthz`.
Same-origin request: `GET /api/healthz`.

The route has no parameters or body.

Response `200`:

```json
{
  "ok": true
}
```

This route only means that the App API process responds.

## Readiness

### `GET /readyz`

Direct request: `GET http://127.0.0.1:4100/readyz`.
Same-origin request: `GET /api/readyz`.

The route checks the database, the proposal table, and processor readiness.
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

The App API does not publish a `/status` route.

## List proposals

### `GET /proposals`

Direct request: `GET http://127.0.0.1:4100/proposals`.
Same-origin request: `GET /api/proposals`.

Query parameters:

| Name          | Required | Meaning                                                      |
| ------------- | -------- | ------------------------------------------------------------ |
| `lifecycleId` | No       | Non-negative lifecycle identifier.                           |
| `limit`       | No       | Positive page size. The API caps it at `API_PAGE_LIMIT_MAX`. |
| `offset`      | No       | Non-negative row offset. Default is `0`.                     |
| `sort`        | No       | One or more `field,direction` values.                        |

Supported sort fields are `lifecycleId`, `senderPublicKey`, `amount`, and `createdAt`.
The direction is `ASC` or `DESC`.

The default order uses lifecycle, block height, creation time, and identifier in descending order.
The route returns the latest tally for each visible proposal.

Response `200`:

```json
{
  "lifecycleId": 3,
  "limit": 20,
  "offset": 0,
  "total": 1,
  "items": [
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
      "creationObservationStatus": "canonical",
      "contractStatus": "approved",
      "contractStatusFinality": "canonical",
      "contractStatusSourceEventId": "130",
      "statusAsOfBlockHeight": 421200,
      "isPaused": false,
      "paidOutAmount": "0",
      "totalPayoutAmount": "11000000000",
      "remainingPayoutAmount": "11000000000",
      "payoutAmountIntegrity": true,
      "contents": "# Community grant",
      "createdAtBlockHeight": 420000,
      "createdAtBlockTimestamp": "2026-08-01T12:00:00.000Z",
      "createdAt": "2026-08-01T12:00:01.000Z",
      "updatedAt": "2026-08-01T12:00:01.000Z",
      "latestVoteTally": {
        "blockHeight": 421200,
        "yayWeight": "800",
        "nayWeight": "200",
        "abstainWeight": "100",
        "createdByEventType": "proposalVotesTallied",
        "requiredParticipationBp": "2450",
        "requiredApprovalBp": "5620",
        "requiredParticipation": "245000000000000",
        "totalParticipatingVotes": "1100",
        "approvalBp": "8000",
        "voteResult": "approved"
      }
    }
  ],
  "nextOffset": null
}
```

Additional status codes:

- `400` for an invalid lifecycle, limit, offset, sort field, or sort direction;
- `503` when the proposal projection table is unavailable.

## Search proposals

### `GET /proposals/search`

Direct request: `GET http://127.0.0.1:4100/proposals/search?q=grant`.
Same-origin request: `GET /api/proposals/search?q=grant`.

Query parameters:

| Name     | Required | Meaning                     |
| -------- | -------- | --------------------------- |
| `q`      | Yes      | Non-empty search text.      |
| `limit`  | No       | Positive page size.         |
| `offset` | No       | Non-negative result offset. |

The search covers all proposal projection fields and proposal Markdown.
Postgres full-text search ranks exact phrases before text rank and block height.

The fallback search ranks exact phrases before block height and identifier.
The response does not include a total count.

Response `200`:

```json
{
  "query": "community grant",
  "limit": 20,
  "offset": 0,
  "items": [
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
      "creationObservationStatus": "canonical",
      "contractStatus": "approved",
      "contractStatusFinality": "canonical",
      "contractStatusSourceEventId": "130",
      "statusAsOfBlockHeight": 421200,
      "isPaused": false,
      "paidOutAmount": "0",
      "totalPayoutAmount": "11000000000",
      "remainingPayoutAmount": "11000000000",
      "payoutAmountIntegrity": true,
      "contents": "# Community grant",
      "createdAtBlockHeight": 420000,
      "createdAtBlockTimestamp": "2026-08-01T12:00:00.000Z",
      "createdAt": "2026-08-01T12:00:01.000Z",
      "updatedAt": "2026-08-01T12:00:01.000Z",
      "searchRank": 1,
      "latestVoteTally": null
    }
  ],
  "nextOffset": null
}
```

Additional status codes:

- `400` when `q`, `limit`, or `offset` is invalid;
- `503` when the proposal projection table is unavailable.

## Get one proposal

### `GET /proposals/:proposalPublicKey`

Direct request: `GET http://127.0.0.1:4100/proposals/B62qProposal`.
Same-origin request: `GET /api/proposals/B62qProposal`.

The path value can be a proposal public key or the internal projection `id`.
The route has no query parameters or body.

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
  "creationObservationStatus": "canonical",
  "contractStatus": "approved",
  "contractStatusFinality": "canonical",
  "contractStatusSourceEventId": "130",
  "statusAsOfBlockHeight": 421200,
  "isPaused": false,
  "paidOutAmount": "0",
  "totalPayoutAmount": "11000000000",
  "remainingPayoutAmount": "11000000000",
  "payoutAmountIntegrity": true,
  "contents": null,
  "createdAtBlockHeight": 420000,
  "createdAtBlockTimestamp": "2026-08-01T12:00:00.000Z",
  "createdAt": "2026-08-01T12:00:01.000Z",
  "updatedAt": "2026-08-01T12:00:01.000Z",
  "latestVoteTally": null
}
```

Additional status codes:

- `404` when the proposal does not exist;
- `503` when the proposal projection table is unavailable.

## List proposal votes

### `GET /proposals/:proposalPublicKey/votes`

Direct request: `GET http://127.0.0.1:4100/proposals/B62qProposal/votes`.
Same-origin request: `GET /api/proposals/B62qProposal/votes`.

Query parameters:

| Name     | Required | Meaning                  |
| -------- | -------- | ------------------------ |
| `limit`  | No       | Positive page size.      |
| `offset` | No       | Non-negative row offset. |

The route excludes orphaned and nullified votes.
It returns the active pending or canonical vote that owns each nullifier.
It orders rows by block height, block event index, and identifier in descending order.

`voteWeight` is a decimal string and `isNullified` is a boolean.

Response `200`:

```json
{
  "proposalPublicKey": "B62qProposal",
  "limit": 20,
  "offset": 0,
  "total": 1,
  "items": [
    {
      "id": "55",
      "proposalPublicKey": "B62qProposal",
      "voterPublicKey": "B62qVoter",
      "vote": "yay",
      "voteWeight": "300000",
      "blockHeight": 420500,
      "blockEventIndex": 4,
      "isNullified": false,
      "status": "canonical",
      "createdAt": "2026-08-01T13:00:00.000Z"
    }
  ],
  "nextOffset": null
}
```

Additional status codes:

- `400` when `limit` or `offset` is invalid;
- `404` when the proposal does not exist;
- `503` when the proposal projection table is unavailable.

## List proposal executions

### `GET /proposals/:proposalPublicKey/executions`

Direct request: `GET http://127.0.0.1:4100/proposals/B62qProposal/executions`.
Same-origin request: `GET /api/proposals/B62qProposal/executions`.

Query parameters:

| Name     | Required | Meaning                  |
| -------- | -------- | ------------------------ |
| `limit`  | No       | Positive page size.      |
| `offset` | No       | Non-negative row offset. |

The route returns pending and canonical execution rows.
It excludes rows with `status` equal to `orphaned`.
It orders rows by block height, block event index, and identifier in descending order.

Response `200`:

```json
{
  "proposalPublicKey": "B62qProposal",
  "limit": 20,
  "offset": 0,
  "total": 1,
  "items": [
    {
      "id": "72",
      "proposalPublicKey": "B62qProposal",
      "recipient": "B62qRecipient",
      "amountToPayOut": "5000000000",
      "bondAmount": "1000000000",
      "senderPublicKey": "B62qSender",
      "paidOutAmount": "5000000000",
      "remainingAmount": "6000000000",
      "blockHeight": 430000,
      "blockEventIndex": 2,
      "status": "canonical",
      "createdAt": "2026-08-02T12:00:00.000Z"
    }
  ],
  "nextOffset": null
}
```

Additional status codes:

- `400` when `limit` or `offset` is invalid;
- `404` when the proposal does not exist;
- `503` when the proposal projection table is unavailable.

## Validate proposal content

### `POST /proposals/content/verify`

Direct request: `POST http://127.0.0.1:4100/proposals/content/verify`.
Same-origin request: `POST /api/proposals/content/verify`.

Request body:

```json
{
  "contents": "# Community grant\n\nProposal details."
}
```

`contents` must be a non-empty Markdown string.
The default maximum is `32768` characters.
The route also rejects content that matches the explicit-language filter.

Response `200`:

```json
{
  "ok": true,
  "passesSubmissionChecks": true,
  "containsExplicitLanguage": false,
  "contentChars": 36,
  "maxProposalContentsChars": 32768
}
```

Additional status code:

- `400` for empty, oversized, or prohibited content.

An oversized-content error also contains `contentChars` and `maxProposalContentsChars`.

## Store proposal content

### `POST /proposals/:id/content`

Direct request: `POST http://127.0.0.1:4100/proposals/B62qProposal/content`.
Same-origin request: `POST /api/proposals/B62qProposal/content`.

The `id` path parameter is the proposal public key.
The request body uses the same model as the content-validation route.

The API hashes the Markdown into a content URN.
It then derives the `zkAppUriHash`.

The API updates only a proposal with the same public key and committed hash.
The route stores the Markdown in Postgres.

Response `200`:

```json
{
  "ok": true,
  "contentChars": 36,
  "proposalPublicKey": "B62qProposal",
  "zkAppUri": "urn:proposal-content:markdown:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "zkAppUriHash": "192837465"
}
```

Additional status codes:

- `400` for an empty identifier or invalid content;
- `404` when no proposal matches the public key and derived hash;
- `503` when the proposal projection table is unavailable.

Content upload does not change the committed Proposal account.
An upload failure does not reverse proposal creation on the MINA network.

## Get a staking-ledger witness

### `GET /staking-ledger/lifecycles/:lifecycleId/witnesses/:index`

Direct request: `GET http://127.0.0.1:4100/staking-ledger/lifecycles/3/witnesses/9`.
Same-origin request: `GET /api/staking-ledger/lifecycles/3/witnesses/9`.

Path parameters:

| Name          | Meaning                                                            |
| ------------- | ------------------------------------------------------------------ |
| `lifecycleId` | Unsigned 64-bit integer string. It selects `<lifecycleId>.sqlite`. |
| `index`       | Non-negative staking-ledger index.                                 |

Response `200`:

```json
{
  "lifecycleId": "3",
  "index": "9",
  "account": {
    "pk": "B62qAccount",
    "balance": "999",
    "delegate": "B62qDelegate"
  },
  "witness": {
    "path": ["123", "456"],
    "isLeft": [true, false]
  }
}
```

The example abbreviates `account` and `witness`.
The route returns the complete `Account.toJSON()` and witness JSON values.

Additional status codes:

- `400` for an invalid lifecycle or index;
- `404` when the lifecycle SQLite file is unavailable.

## Get a staking-ledger account

### `GET /staking-ledger/lifecycles/:lifecycleId/accounts/:publicKey`

Direct request: `GET http://127.0.0.1:4100/staking-ledger/lifecycles/3/accounts/B62qAccount`.
Same-origin request: `GET /api/staking-ledger/lifecycles/3/accounts/B62qAccount`.

Path parameters:

| Name          | Meaning                         |
| ------------- | ------------------------------- |
| `lifecycleId` | Unsigned 64-bit integer string. |
| `publicKey`   | Valid Mina public key.          |

Response `200`:

```json
{
  "lifecycleId": "3",
  "publicKey": "B62qAccount",
  "index": "9",
  "account": {
    "pk": "B62qAccount",
    "balance": "999",
    "delegate": "B62qDelegate"
  },
  "balance": "999",
  "delegatePublicKey": "B62qDelegate"
}
```

The example abbreviates `account`.
The route returns the complete `Account.toJSON()` value.

Additional status codes:

- `400` for an invalid lifecycle or public key;
- `404` when the lifecycle data or account is unavailable.

## Get a voting-ledger account

### `GET /voting-ledger/lifecycles/:lifecycleId/accounts/:publicKey`

Direct request: `GET http://127.0.0.1:4100/voting-ledger/lifecycles/3/accounts/B62qDelegate`.
Same-origin request: `GET /api/voting-ledger/lifecycles/3/accounts/B62qDelegate`.

Path parameters:

| Name          | Meaning                         |
| ------------- | ------------------------------- |
| `lifecycleId` | Unsigned 64-bit integer string. |
| `publicKey`   | Valid delegate public key.      |

Response `200`:

```json
{
  "lifecycleId": "3",
  "publicKey": "B62qDelegate",
  "account": {
    "balance": "12345"
  },
  "voteWeight": "12345"
}
```

The route returns zero when the key has no voting weight in the available ledger.

Additional status codes:

- `400` for an invalid lifecycle or public key;
- `404` when the lifecycle SQLite file is unavailable.

## Pagination rules

Proposal list, search, vote, and execution routes use offset pagination.
The API caps `limit` at `API_PAGE_LIMIT_MAX`.

`nextOffset` is `offset + limit` when another row exists.
It is `null` on the last page.

Only the proposal-list route accepts client-selected sorting.
The search, vote, and execution routes use fixed orders.

## Sources

- `apps/api/src/http-api-server.ts`
- `apps/api/src/app-api.ts`
- `apps/api/src/proposal-list-routes.ts`
- `apps/api/src/proposal-search-routes.ts`
- `apps/api/src/proposal-content-routes.ts`
- `apps/api/src/staking-ledger/staking-ledger-witness-routes.ts`
- `apps/api/src/voting-ledger/voting-ledger-account-routes.ts`
- `apps/api/src/config.ts`
- `devops/proxy/Caddyfile`
