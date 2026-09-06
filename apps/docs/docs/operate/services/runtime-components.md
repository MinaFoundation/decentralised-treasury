---
title: Runtime Components
sidebar_label: Runtime Components
sidebar_position: 2
audience: operator
page_kind: reference
---

# Runtime Components

The API package supplies five long-running processes.
Compose runs each process in a separate container. The Kubernetes stack runs
equivalent application processes and adds cluster services for artifacts,
queues, and scheduling.

## Database and migration

### `postgres`

Postgres stores indexed events, cursors, processor offsets, projections, and proposal Markdown.
The service uses the `postgres-data` named volume.

The Compose health check runs `pg_isready`.
This check does not validate migrations or projection freshness.

### `api-migrate`

The migration job runs this package command:

```text
pnpm --dir apps/api run migration:run
```

The job waits for healthy Postgres.
It must finish successfully before the API services start.

## HTTP processes

### `api`

The App API runs `pnpm --dir apps/api run start:api`.
It reads Postgres and lifecycle SQLite files.
It can update proposal Markdown in Postgres.

The process caches one SQLite service for each requested lifecycle.
Restart it after you replace an active lifecycle SQLite file.

### `indexer-api`

The Indexer API runs `pnpm --dir apps/api run start:indexer-api`.
It reads event rows and cursors from Postgres.
Its `/status` route also queries Archive GraphQL heads.

### `processor-api`

The Processor API runs `pnpm --dir apps/api run start:processor-api`.
It reads projections and the processor offset from Postgres.

Each HTTP process serves `/healthz`.
This route only means that the HTTP process responds.

## Event workers

### `indexer`

The indexer runs `pnpm --dir apps/api run start:indexer`.
It polls pending and canonical Archive GraphQL ranges.

The worker writes `archive_events` and `indexer_cursors`.
Compose does not define a health check for this worker.

### `processor`

The processor runs `pnpm --dir apps/api run start:processor`.
It reads ordered event pages from the Indexer API.

The worker writes proposal projections and `processor_offsets`.
It also reads lifecycle SQLite for vote weights and acceptance data.

Restart it after you replace an active lifecycle SQLite file.
Compose does not define a health check for this worker.

## Ledger and proof services

### `voting-ledger-scheduler`

This service runs a shell polling loop.
It converts the selected staking-ledger file into lifecycle SQLite data and traces.

The normal completion marker is `<lifecycleId>.sqlite.done`.
The scheduler drains unfinished lifecycle files from newest to oldest. The
operator can select an exact older lifecycle when it must run first.

### `redis`

Redis runs only with the `proving` profile.
It coordinates BullMQ proof jobs and results.

Its health check runs `redis-cli ping`.
The reply does not prove that a proof job can finish.

### `proving-worker`

Each worker runs the CLI `worker start` command.
All replicas use one configured queue name.

BullMQ assigns tasks to available replicas.
The `proving-worker-cache` volume stores worker cache data.

### `proving-scheduler`

This service runs a shell polling loop.
It processes completed lifecycle traces from the oldest backlog item first.

It writes merge and exhausted proof JSON.
It then writes `<lifecycleId>.sqlite.proven`.

The `.proven` marker does not submit a tally transaction.

## Browser applications

### `web`

The public Next.js application listens on port `3100` by default.
It reads browser-facing configuration when the container starts.

It depends on healthy App, Indexer, and Processor API containers.
Its root health check only tests the HTTP response.

### `backoffice`

The Backoffice Next.js application listens on port `3200` by default.
It prepares and submits break-glass operations.

Its root health check only tests the HTTP response.
The public proxy profile does not publish this application.

## Reverse proxies

### `reverse-proxy`

The `proxy` profile uses local Caddy routes.
It binds to `127.0.0.1` by default.

It publishes web, Backoffice, APIs, and a Mina GraphQL proxy.
It also publishes direct API ports `4100`, `4101`, and `4102`.

### `reverse-proxy-public`

The `public-proxy` profile uses public HTTPS routes.
It requires `LETSENCRYPT_EMAIL` and `PUBLIC_WEB_DOMAIN`.

It publishes same-origin API and Mina paths through the web domain.
Dedicated App, Indexer, and Processor API domains are optional.

## External provider boundary

Mina GraphQL and Archive GraphQL are external inputs to this stack.
The endpoints can run on the same host, in the Kubernetes network deployment,
or at a provider.

Repository Compose commands do not restart these services. Use
[1a. Archive Node](../infrastructure/archive-node.md) and
[1b. Mina Daemon](../infrastructure/mina-daemon.md) for the Kubernetes services.
Use the provider procedure for a provider endpoint.

After a provider change, check the MINA network and treasury address again.
Then recreate the affected application services with the new environment.

## Kubernetes-only components

The Kubernetes runbooks add these components:

| Component | Purpose | Procedure |
| --- | --- | --- |
| Archive Postgres, bootstrap job, and guardian | Store Archive data, restore the initial dump, and repair block gaps. | [1a. Archive Node](../infrastructure/archive-node.md) |
| Mina daemon and GraphQL proxy | Validate the chain, feed the Archive node, answer state queries, and accept transactions. | [1b. Mina Daemon](../infrastructure/mina-daemon.md) |
| Staking-ledger provider | Export, verify, retain, and serve hash-named staking snapshots. | [1c. Staking Ledger Provider](../infrastructure/staking-ledger-provider.md) |
| S3 artifact sidecars | Synchronize SQLite state, completion markers, checkpoints, and proof files. | [2d. Lifecycle Pipeline](../infrastructure/lifecycle-pipeline.md) |
| Proving autoscaler | Set the proof-worker count from queued and active work. | [2d. Lifecycle Pipeline](../infrastructure/lifecycle-pipeline.md) |

## Sources

- `devops/compose.yml`
- `apps/api/package.json`
- `apps/api/src/app-api.ts`
- `apps/api/src/indexer.ts`
- `apps/api/src/indexer-api.ts`
- `apps/api/src/processor.ts`
- `apps/api/src/processor-api.ts`
- `devops/docker/voting-ledger-scheduler-entrypoint.sh`
- `devops/docker/proving-scheduler-entrypoint.sh`
- `apps/web/package.json`
- `apps/backoffice/package.json`
- `devops/runbooks/1-Network/1a-Archive-Node/README.md`
- `devops/runbooks/1-Network/1b-Mina-Daemon/README.md`
- `devops/runbooks/1-Network/1c-Staking-Ledger-Provider/README.md`
- `devops/runbooks/2-Treasury/2c-Deploy-Stack/README.md`
- `devops/runbooks/2-Treasury/2d-Lifecycle-Pipeline/README.md`
