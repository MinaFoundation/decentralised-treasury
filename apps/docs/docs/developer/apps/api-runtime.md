---
title: API Runtime
sidebar_label: API runtime
audience: developer
page_kind: concept
---

# API Runtime

From outside, `apps/api` can look like one backend. In the repository, it
composes five processes with separate jobs and a shared Postgres
configuration. Knowing which process owns a result makes local debugging much
more focused.

## Processes

| Process          | Package script         | Responsibility                                      |
| ---------------- | ---------------------- | --------------------------------------------------- |
| Indexer worker   | `dev:indexer-worker`   | Poll Archive and persist typed events.              |
| Processor worker | `dev:processor-worker` | Consume typed events and write projections.         |
| Indexer API      | `dev:indexer-api`      | Serve events, status, health, and readiness.        |
| Processor API    | `dev:processor-api`    | Serve projections, status, health, and readiness.   |
| App API          | `dev:api`              | Serve proposal content and lifecycle ledger routes. |

Prepare the generated family and direct host overrides in
[Start the API processes](../local-development/native-stack.md#start-the-api-processes).
That procedure loads the database, Archive, API, and SQLite values before startup.
Bootstrap does not create an `.env.dev` family.

After loading those values and applying migrations, start all five processes:

```bash
pnpm --dir apps/api run dev
```

For a separate process, load the same values in its terminal.
Then run its package script from the table above.

## Required Dependencies

The runtime needs:

- a Postgres database with current migrations;
- an Archive GraphQL endpoint;
- the selected Treasury Owner address;
- lifecycle SQLite files for staking and voting ledger routes.

The App API reads the Indexer and Processor APIs. It does not replace their
workers.

## Database Workflow

```bash
pnpm --dir apps/api run migration:run
pnpm --dir apps/api run schema:log
```

Use a migration for a committed schema change. `schema:sync` is only a local
development helper.

## Event Boundary

The indexer fixes an event type during ingestion. Invalid or unresolved
observations enter `archive_event_rejections`.

The processor asks for typed events only. It does not patch an event type after
ingestion.

## Lifecycle Data

The API resolves lifecycle SQLite files from `SQLITE_DATA_DIRECTORY`. CLI,
scheduler, and API processes must use the same directory.

The staking witness routes return data from the selected lifecycle file. They
do not query Mina for the historical snapshot.

## HTTP Reference

Use the [API route map](../reference/api-routes.md) for process and port
ownership. Use the Operator API pages for complete request and response forms:

- [App API](../../operate/api/app-api.md)
- [Indexer API](../../operate/api/indexer-api.md)
- [Processor API](../../operate/api/processor-api.md)

## Tests

```bash
pnpm --dir apps/api run check-types
pnpm --dir apps/api run test
pnpm --dir apps/api run test:integration:postgres
pnpm --dir apps/api run test:e2e:local-blockchain
```

The local-blockchain API e2e checks `ProposalCreated`. It does not run voting,
tallying, or execution.

## Sources

- `apps/api/README.md`
- `apps/api/package.json`
- `apps/api/src/indexer.ts`
- `apps/api/src/processor.ts`
- `apps/api/src/indexer-api.ts`
- `apps/api/src/processor-api.ts`
- `apps/api/src/app-api.ts`
- `apps/api/src/config.ts`
