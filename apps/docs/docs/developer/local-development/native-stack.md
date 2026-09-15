---
title: Native Development Stack
sidebar_label: Native development stack
audience: developer
page_kind: procedure
---

# Native Development Stack

Run the packages as separate host processes when you need a debugger, isolated
logs, or a quick code-reload cycle. If you want the integrated application
stack, follow the [full local demo](full-local-demo.md) instead.

The native stack is an application process layout, not a network mode.
Select a network with [Development Network Modes](network-modes.md) first.

This procedure uses the in-repository o1js simulator.
For a Mina daemon, follow [Mina single node](mina-single-node.md) and load its generated `testnet` family.

Lightnet supports focused integration tests.
It is not the documented network for this complete native application stack.

## Generate The Environment

Complete the [quickstart](quickstart.md).
Generate the supported simulator family:

```bash
pnpm env:bootstrap local-blockchain
```

Load the generated `.env.local-blockchain` files and apply the direct host overrides below.

Use one absolute SQLite directory in all CLI and API terminals:

```bash
export SQLITE_DATA_DIRECTORY="$PWD/.data/native/sqlite"
mkdir -p "$SQLITE_DATA_DIRECTORY"
```

## Start Postgres

Load the generated database values and start Postgres:

```bash
set -a
source devops/.env.local-blockchain
set +a

docker run --name treasury-postgres \
  -e POSTGRES_USER="$POSTGRES_USER" \
  -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  -e POSTGRES_DB="$POSTGRES_DB" \
  -p 5432:5432 \
  -d postgres:16
```

Use an existing local Postgres instance when its `DATABASE_URL` matches the API
environment.

## Start Mina And Archive Surfaces

Run this long-lived process in another terminal:

```bash
pnpm local-blockchain:start
```

Confirm the simulator health:

```bash
curl --fail-with-body http://127.0.0.1:8080/healthz
```

Open `http://127.0.0.1:8080/admin`.
Copy one funded private key into `SENDER_PRIVATE_KEY` in the generated CLI file.

## Deploy The Treasury

Load the generated CLI family.
Override the API URL because the API will run directly on the host:

```bash
set -a
source apps/cli/.env.local-blockchain
set +a

export TREASURY_API_URL=http://127.0.0.1:4000
export SQLITE_DATA_DIRECTORY="$PWD/.data/native/sqlite"

pnpm run cli -- treasury-owner compile

pnpm run cli -- treasury-owner deploy
```

Copy the emitted browser values into the generated web and Backoffice files.
The generated contract address matches the generated Treasury Owner key.

## Start The API Processes

Load the generated infrastructure and API values in an API terminal:

```bash
set -a
source devops/.env.local-blockchain
source apps/api/.env.local-blockchain
set +a

export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}"
export ARCHIVE_NODE_URL=http://127.0.0.1:8282/graphql
export API_URL=http://127.0.0.1:4000
export INDEXER_API_URL=http://127.0.0.1:4001
export PROCESSOR_API_URL=http://127.0.0.1:4002
export SQLITE_DATA_DIRECTORY="$PWD/.data/native/sqlite"
```

Apply migrations, then start all five API processes:

```bash
pnpm --dir apps/api run migration:run
pnpm --dir apps/api run dev
```

Use the [API runtime](../apps/api-runtime.md) when you need separate process
commands.

## Start The Web Application

Set these direct host endpoints in `apps/web/.env.local-blockchain`:

```text
NEXT_PUBLIC_TREASURY_API_URL=http://127.0.0.1:4000
NEXT_PUBLIC_INDEXER_API_URL=http://127.0.0.1:4001
NEXT_PUBLIC_PROCESSOR_API_URL=http://127.0.0.1:4002
NEXT_PUBLIC_MINA_NODE_URL=http://127.0.0.1:8080/graphql
```

Load the generated file and start the web application:

```bash
dotenvx run -f apps/web/.env.local-blockchain -- \
pnpm --dir apps/web run dev
```

Open `http://127.0.0.1:3100`.

## Confirm Readiness

```bash
curl --fail-with-body http://127.0.0.1:4000/healthz
curl --fail-with-body http://127.0.0.1:4001/healthz
curl --fail-with-body http://127.0.0.1:4001/status
curl --fail-with-body http://127.0.0.1:4002/healthz
curl --fail-with-body http://127.0.0.1:4002/status
```

Use the [full local demo](full-local-demo.md) for the complete proposal, vote,
proof, tally, and execution sequence. Apply its ledger and lifecycle steps to
the same generated simulator family.

## Use The Mina Single Node Instead

Do not start the o1js simulator for this path.
Complete the [Mina single-node procedure](mina-single-node.md) first.

Load the generated `.env.testnet` files instead of `.env.local-blockchain` files.
Keep these direct host endpoints:

```text
MINA_NODE_URL=http://127.0.0.1:3001/graphql
ARCHIVE_NODE_URL=http://127.0.0.1:8282
NEXT_PUBLIC_MINA_NODE_URL=http://127.0.0.1:3001/graphql
```

Keep the direct API and Postgres overrides from this page.
Do not start the Compose live-testnet stack as part of native development.

## Stop The Stack

Stop long-lived host processes with `Ctrl+C`. Stop Postgres when required:

```bash
docker stop treasury-postgres
```

Do not remove the container or SQLite data until you no longer need that local
state.

## Sources

- `README.md`
- `apps/api/README.md`
- `apps/web/README.md`
- `apps/cli/README.md`
- `packages/local-blockchain/README.md`
- `devops/scripts/bootstrap-env.mjs`
- `devops/TESTNET_MINA_NODE.md`
