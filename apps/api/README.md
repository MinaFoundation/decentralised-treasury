# API

This app wires the indexer and processor runtimes for treasury-owner events.

It exposes three HTTP surfaces:

- app API (`start:api`)
- indexer API (`start:indexer-api`)
- processor API (`start:processor-api`)

## Strict Event-Type Policy

Event type is treated as immutable at ingest:

- event types are derived from the contract class passed to `loadApiConfig(...)`
- indexer ingestion resolves each type from the encoded o1js discriminator
- the indexer keeps the complete archive payload, including its discriminator
- malformed or unresolved observations go to `archive_event_rejections`
- processor consumes only typed events (`includeUnknown=false`) and does not patch event types
- proposal handlers validate the discriminator before they decode the contract event Struct

## Environment

Use this README for native package development, where API processes bind direct
host ports such as `4000`, `4001`, and `4002`. For the Compose demo or testnet
operator stack, use `DEMO.md` or `devops/TESTNET.md`; Compose keeps these ports
private and exposes the APIs through Caddy on `4100`, `4101`, and `4102`.

Use `apps/api/.env.local-blockchain` for native local-blockchain development.

Required:

- `ARCHIVE_NODE_URL`
- `TREASURY_OWNER_CONTRACT_ADDRESS`
- `DATABASE_URL`

Common optional:

- `DATABASE_SCHEMA` (default: `public`)
- `API_PORT` (default: `4000`)
- `API_URL` (default: `http://127.0.0.1:$API_PORT`)
- `INDEXER_API_PORT` (default: `4001`)
- `INDEXER_API_URL` (default: `http://127.0.0.1:$INDEXER_API_PORT`)
- `PROCESSOR_API_PORT` (default: `4002`)
- `PROCESSOR_API_URL` (default: `http://127.0.0.1:$PROCESSOR_API_PORT`)
- `POLL_PENDING_INTERVAL_MS` (default: `5000`)
- `POLL_CANONICAL_INTERVAL_MS` (default: `15000`)
- `EVENTS_BLOCK_BATCH_SIZE` (default: `10`)
- `CANONICAL_OVERLAP_BLOCKS` (default: `100`)
- `ORPHAN_DEPTH_BLOCKS` (default: `30`)
- `PROCESSOR_NAME` (default: `proposal-processor`)
- `PROCESSOR_POLL_INTERVAL_MS` (default: `2000`)
- `PROCESSOR_BATCH_SIZE` (default: `200`)
- `API_PAGE_LIMIT_DEFAULT` (default: `50`)
- `API_PAGE_LIMIT_MAX` (default: `200`)
- `ARCHIVE_REQUEST_TIMEOUT_MS` (default: `15000`)
- `SQLITE_DATA_DIRECTORY` (default: `$PWD/.data/sqlite`, used by lifecycle staking-ledger and voting-ledger sqlite files)
- `PROPOSAL_CONTENT_MAX_CHARS` (default: `32768`, max character count for submitted proposal markdown content)

## PostgreSQL

The API requires a running Postgres instance before you run migrations or start the
services.

The default `DATABASE_URL` in `apps/api/.env.local-blockchain` is:

```text
postgres://postgres:postgres@127.0.0.1:5432/treasury_api
```

One local option is Docker:

```bash
docker run --name treasury-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=treasury_api \
  -p 5432:5432 \
  -d postgres:16
```

This matches the default `DATABASE_URL` above.

Useful follow-up commands:

- start an existing container again: `docker start treasury-postgres`
- stop it: `docker stop treasury-postgres`
- remove it: `docker rm -f treasury-postgres`

If you already have Postgres running locally, create a database named
`treasury_api` and point `DATABASE_URL` at it instead.

## Run

Run the API stack by loading the env file in each terminal:

```bash
set -a
source apps/api/.env.local-blockchain
set +a
pnpm --dir apps/api run dev
```

That package `dev` command starts:

- the indexer worker
- the processor worker
- the indexer API server
- the processor API server
- the app API server

For API-only work, use:

```bash
pnpm --dir apps/api run check-types
pnpm --dir apps/api run migration:run
pnpm --dir apps/api run dev
```

If you want to run the processes separately instead, use:

```bash
pnpm --dir apps/api run start:indexer
pnpm --dir apps/api run start:indexer-api
pnpm --dir apps/api run start:processor-api
pnpm --dir apps/api run start:api
pnpm --dir apps/api run start:processor
```

Run the worker and server processes you need in separate terminals.

- `start:indexer` polls archive and stores typed events
- `start:indexer-api` serves the indexer HTTP API
- `start:processor-api` serves the processor HTTP API
- `start:api` serves app-specific treasury routes
- `start:processor` consumes events from indexer API and writes projections

Schema workflow:

- Generate migration (set name via env):
  - `pnpm --dir apps/api run migration:generate -- src/db/migrations/1712075000000-initialize-processor-schema`
- Apply migrations:
  - `pnpm --dir apps/api run migration:run`
- Roll back last migration:
  - `pnpm --dir apps/api run migration:revert`
- Inspect raw schema diff (development helper):
  - `pnpm --dir apps/api run schema:log`
- Apply schema directly without migration file (development-only helper):
  - `pnpm --dir apps/api run schema:sync`

## APIs

### Indexer API (`start:indexer-api`)

- `GET /healthz`
- `GET /readyz`
- `GET /events?changeSequenceAfter=<sequence>&eventTypes=<csv>&includeUnknown=true|false&limit=<n>`
- `GET /events?updatedAfter=<iso>&eventIdAfter=<id>&eventTypes=<csv>&includeUnknown=true|false&limit=<n>` (transition cursor)
- `GET /status`

### Processor API (`start:processor-api`)

- `GET /healthz`
- `GET /readyz`
- `GET /status`
- `GET /proposals`
- `GET /votes`
- `GET /vote-nullifiers`
- `GET /vote-tallies`
- `GET /proposal-executions`

### App API (`start:api`)

- `GET /staking-ledger/lifecycles/:lifecycleId/witnesses/:index`
- `GET /staking-ledger/lifecycles/:lifecycleId/accounts/:publicKey`
- `GET /voting-ledger/lifecycles/:lifecycleId/accounts/:publicKey`
- `GET /proposals`
- `GET /proposals/search?q=<query>`
- `GET /proposals/:proposalPublicKey`
- `GET /proposals/:proposalPublicKey/votes`
- `GET /proposals/:proposalPublicKey/executions`
- `POST /proposals/content/verify`
- `POST /proposals/:id/content`

Active-event projection semantics:

- Smart-contract methods are the business source of truth. Event payloads are observations of those methods.
- Pending and canonical events both affect one current projection.
- Pending data differs from canonical data only by finality and rollback eligibility.
- Promotion from pending to canonical changes finality only. It does not apply the business effect again.
- Orphaning removes the event effect and recomputes the projection from the remaining active events.
- The App API and Processor API return active pending and canonical rows. They exclude orphaned rows.
- `processor_vote_nullifiers` contains the first active vote for each proposal and voter in stable source order.
- The App API excludes nullified votes and includes the active vote that owns each nullifier.

Response shape:

- `items`: event rows, including `changeSequence` and `blockEventIndex`
- `nextCursor`: `{ changeSequenceAfter }` or `null` for the preferred cursor
- `nextCursor`: `{ updatedAfter, eventIdAfter }` or `null` for the transition cursor

Proposal content submit request:

- verify route: `POST /proposals/content/verify`
- verify body: `{ "contents": "<markdown>" }`
- verify behavior:
  - runs the same validation/profanity rules as submission endpoint
  - returns `200` when content passes checks
  - returns `400` with the same error shape as submission on failure

- route: `POST /proposals/:id/content` (`id` is proposal public key)
- body: `{ "contents": "<markdown>" }`
- behavior:
  - hashes markdown exactly like CLI (`urn:proposal-content:markdown:sha256:<digest>`)
  - derives `zkAppUriHash` from the hashed `zkAppUri`
  - rejects content containing profanity/explicit language (`400`)
  - updates `processor_proposals.contents` for the proposal matching `:id` and `zkAppUriHash`
  - returns `404` if no matching proposal row exists for `:id` + hash

Staking witness response shape:

- `lifecycleId`: lifecycle identifier used to select sqlite DB
- `index`: account index as string
- `account`: `Account.toJSON(...)` payload
- `witness`: `PrefixedMerkleWitness36.toJSON()` payload

Staking account response shape:

- `lifecycleId`: lifecycle identifier used to select sqlite DB
- `publicKey`: requested Mina account public key
- `index`: staking-ledger index where account was found
- `account`: `Account.toJSON(...)` payload
- `balance`: account balance string (from `account.balance`)
- `delegatePublicKey`: delegate public key string (from `account.delegate`)

Voting account response shape:

- `lifecycleId`: lifecycle identifier used to select sqlite DB
- `publicKey`: requested Mina account public key
- `account`: voting-ledger account payload (`{ balance: "<weight>" }`)
- `voteWeight`: current voting weight string (same as `account.balance`)

Indexer status response shape:

- `ok`: probe result
- `ready`: readiness result
- `archive`: `{ canonicalMaxBlockHeight, pendingMaxBlockHeight }`
- `pendingCursor`
- `canonicalCursor`
- `remainingPendingBlocks`
- `remainingCanonicalBlocks`
- `rejections`: total and unresolved rejection counts
- `runtime`: operation state, failures, missing operations, and stale operations

Processor status response shape:

- `ok`: processor readiness result
- `ready`: processor readiness result
- `processorName`
- `offset`: `{ lastSeenUpdatedAt, lastSeenEventId, lastSeenChangeSequence, updatedAt } | null`
- `remainingEvents`
- `runtime`: lifecycle state, heartbeat, and last error details
- `failures`: due failure count

The readiness route returns `503` for an unresolved indexer rejection. It also
returns `503` for a failed, missing, or stale indexer operation. The processor
readiness route returns `503` for stale or inactive runtime state. It also
returns `503` when a blocked or due retry exists.

### Staking Ledger SQLite Resolution

The staking witness endpoint selects sqlite files by lifecycle id.

Route:

- `GET /staking-ledger/lifecycles/:lifecycleId/witnesses/:index`
- `GET /staking-ledger/lifecycles/:lifecycleId/accounts/:publicKey`
- `GET /voting-ledger/lifecycles/:lifecycleId/accounts/:publicKey`

Path resolution:

- Base directory: `SQLITE_DATA_DIRECTORY` (if set)
- Fallback base directory: `$PWD/.data/sqlite`
- File name pattern: `<lifecycleId>.sqlite`
- `lifecycleId` must be an unsigned 32-bit integer string (`0` to `4294967295`)

Examples:

- `lifecycleId=0` -> `0.sqlite`
- `lifecycleId=1` -> `1.sqlite`
- `lifecycleId=42` -> `42.sqlite`

Operational workflow (manual file copy):

1. Generate lifecycle sqlite using CLI.
2. Copy `<lifecycleId>.sqlite` into the API host's sqlite directory.
3. Ensure API process has `SQLITE_DATA_DIRECTORY` pointing to that directory.
4. Query staking/voting endpoints using the same lifecycle id.

Runtime note:

- The API keeps one staking-ledger service/connection per lifecycle id in memory.
- If you replace an existing lifecycle sqlite file on disk while API is running,
  restart the API process to guarantee it reopens the new file.
- If a lifecycle sqlite file does not exist, witness endpoint returns `404` with
  `{ "error": "data for lifecycleid is not available", "lifecycleId": "<id>" }`.
- If a lifecycle sqlite file does not exist, voting account endpoint also returns
  `404` with `{ "error": "data for lifecycleid is not available", "lifecycleId": "<id>" }`.
- If `lifecycleId` is not a valid unsigned 32-bit integer string, the endpoint
  returns `400` with
  `{ "error": "lifecycleId must be an unsigned 32-bit integer string" }`.

Error strategy:

- `400`: query validation errors
- `500`: repository/internal server errors

### Processor Worker (`start:processor`)

`start:processor` runs the projection worker only. The HTTP reads live on the separate
`start:processor-api` server.

Use the processor API process for HTTP reads:

- `GET /status` for processor lag/offset visibility
- `GET /healthz`
- `GET /readyz`
- `GET /proposals`
- `GET /proposals/:id`
- `GET /votes`
- `GET /votes/:id`
- `GET /vote-nullifiers`
- `GET /vote-nullifiers/:id`
- `GET /vote-tallies`
- `GET /vote-tallies/:id`
- `GET /proposal-executions`
- `GET /proposal-executions/:id`

The generated processor routes are read-only. The server rejects mutating CRUD
methods.

### Failure recovery

The indexer stores malformed observations in `archive_event_rejections`. Review
the source evidence before you resolve a rejection.

```bash
pnpm backend:resolve-indexer-rejection -- <rejection-id>
```

The processor retries a failed event five times. A final failure blocks later
events for the same processor. Fix the cause before you start a manual retry.

```bash
pnpm backend:retry-blocked-event
```

Both commands use the configured `DATABASE_URL`, `DATABASE_SCHEMA`, and
`PROCESSOR_NAME` values.

TODO:

- Add dedicated CLI/SDK support to compute and materialize lifecycle voting-ledger sqlite state out-of-circuit so processor-weight lookups can be prepared faster.

## Tests

Package-level tests:

```bash
pnpm test:backend
pnpm test:backend:postgres
```

`test:backend` runs all indexer, processor, and API unit tests with coverage.
The coverage gate requires 80 percent lines and functions. It requires 75
percent branches and 60 percent lines in each source file.

`test:backend:postgres` needs `DATABASE_TEST_URL`. It tests fresh and upgrade
migrations, custom schemas, sequence order, rollback, and reapply behavior.

App-level tests in `apps/api` fall into two policy buckets:

- `test/**/*.test.ts`: non-Lightnet integration/unit coverage. These tests may use fixtures, in-memory databases, synthetic event injection, and route-level harnesses when that is the fastest way to validate behavior.
- `test/e2e/**/*.e2e.ts`: real Lightnet end-to-end coverage. These tests are reserved for full pipeline verification against a live Lightnet + archive + API stack.

There is also one opt-in local-blockchain e2e used for fast pipeline validation
without Lightnet:

- `test/e2e/proposal-created-local-blockchain.e2e.ts`: `local-blockchain-e2e`. Boots the local blockchain server, drives a `ProposalCreated` flow, and asserts the API/indexer/processor pipeline end to end with `PROOFS_ENABLED=false`.

Current test classification by file:

- `test/e2e/proposal-created-local-blockchain.e2e.ts`: `local-blockchain-e2e`. Boots the local blockchain server and validates the `ProposalCreated` pipeline end to end without Lightnet.
- `test/e2e/proposal-lifecycle-lightnet.e2e.ts`: `real-lightnet-e2e`. Deploys treasury on Lightnet, submits lifecycle transactions, then asserts only through API endpoints that archive ingestion, indexer typing, and processor projections all converged.
- `test/indexer-status-api.test.ts`: `route-integration`. Verifies `/status` contracts for indexer and processor APIs against an in-memory repository/archive harness.
- `test/proposal-content-api.test.ts`: `route-integration`. Verifies content validation, hash matching, and content persistence semantics via the API surface and in-memory DB.
- `test/proposal-executed-processor.test.ts`: `processor-handler`. Verifies `proposalExecuted` decoding/projection logic, including legacy payload compatibility.
- `test/proposal-vote-processor.test.ts`: `processor-handler`. Verifies vote projection/nullifier/tally behavior from normalized typed events.
- `test/staking-ledger-witness-api.test.ts`: `route-integration`. Verifies staking/voting-ledger sqlite-backed API routes, validation, and missing-data handling.

Lightnet policy:

- use real Lightnet and real archive ingestion
- submit transactions through CLI processes, not through in-process SDK calls from the test runner
- run with `PROOFS_ENABLED=true`
- assert success only via API endpoints (`/events`, `/status`, projection routes, and other API routes under test)
- use direct chain/archive/CLI reads only for orchestration inputs, never as the success criteria

App-level Lightnet e2e:

```bash
pnpm --dir apps/api run test:e2e:lightnet
```

App-level local-blockchain e2e:

```bash
pnpm --dir apps/api run test:e2e:local-blockchain
```

The default `apps/api` `test` script matches all `test/**/*.test.ts` files.
The coverage script uses the non-E2E `test/*.test.ts` suite.
