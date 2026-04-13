# Web App

Client-side Next.js frontend for the decentralized treasury project.

The app renders the shared treasury UI from `@repo/ui` and wires it to:

- the treasury HTTP API
- a Mina node GraphQL endpoint
- client-side Zustand stores for wallet, search, settings, treasury state, and app errors

## Current State

`apps/web` is currently a client-only shell.

- No server actions or server-side treasury orchestration
- Header, wallet, search, treasury balance, and lifecycle status are fetched in the browser
- Data refresh is driven by Mina block polling every 10 seconds
- Tests are currently Vitest-based unit and hook/container tests

## Scripts

From repo root:

```bash
pnpm --dir apps/web run dev
pnpm --dir apps/web run build
pnpm --dir apps/web run start
pnpm --dir apps/web run check-types
pnpm --dir apps/web run lint
pnpm --dir apps/web run test
```

Default local URL: `http://127.0.0.1:3000`

## Environment

Load the env file you want in your shell before starting the app.

Important frontend env vars:

- `NEXT_PUBLIC_TREASURY_API_URL`
- `NEXT_PUBLIC_INDEXER_API_URL`
- `NEXT_PUBLIC_PROCESSOR_API_URL`
- `NEXT_PUBLIC_MINA_NODE_URL`
- `NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS`
- `NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION`
- `NEXT_PUBLIC_SLOT_DURATION_MS`

Notes:

- the app code prefers `NEXT_PUBLIC_TREASURY_API_URL`
- `NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS` must point at the deployed treasury owner zkApp
- `NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION` must match the chain you are pointing the app at

## What Must Be Running

For the web app to load real data, you need:

1. Postgres
2. a Mina node GraphQL endpoint
3. an archive endpoint
4. the API indexer process
5. the API HTTP server
6. the API processor

In local development, the web app reads:

- treasury API from `http://127.0.0.1:4000`
- indexer API from `http://127.0.0.1:4001`
- processor routes from `http://127.0.0.1:4002`
- Mina node GraphQL from `http://127.0.0.1:8080/graphql`

## Local Blockchain Setup

This is the fastest way to bring up the full local stack for the web app.

### 1. Prepare env files

Review and update:

- `apps/api/.env.local-blockchain`
- `apps/cli/.env.local-blockchain`
- `apps/web/.env.local-blockchain`

At minimum, make sure these values are correct:

- `TREASURY_OWNER_CONTRACT_ADDRESS`
- `TREASURY_OWNER_TOKEN_ID`
- `NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS`
- `NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION`

Load the env file before starting the app:

```bash
set -a
source apps/web/.env.local-blockchain
set +a
pnpm --dir apps/web run dev
```

### 2. Start Postgres

One local option:

```bash
docker run --name treasury-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=treasury_api \
  -p 5432:5432 \
  -d postgres:16
```

### 3. Start local blockchain + archive

```bash
PORT=8080 ARCHIVE_PORT=8282 pnpm --dir packages/local-blockchain run dev
```

This gives you:

- Mina GraphQL on `http://127.0.0.1:8080/graphql`
- archive on `http://127.0.0.1:8282`
- admin UI on `http://127.0.0.1:8080/admin`

### 4. Deploy treasury contracts

Deploy the treasury owner so the web app has a real treasury address to read from:

```bash
MINA_NODE_URL=http://127.0.0.1:8080/graphql \
SENDER_PRIVATE_KEY=<funded-local-blockchain-private-key> \
TREASURY_OWNER_PRIVATE_KEY=<treasury-owner-private-key> \
PAUSE_CONTROLLER_PRIVATE_KEY=<pause-controller-private-key> \
MULTISIG_PARTICIPANTS_PUBLIC_KEYS=<PUB1>,<PUB2>,<PUB3>,<PUB4>,<PUB5> \
pnpm run cli -- treasury-owner deploy
```

Then copy the resulting values into:

- `apps/api/.env.local-blockchain`
- `apps/web/.env.local-blockchain`

You need:

- treasury owner public key
- treasury owner token id

### 5. Run API migrations

Load the API env first:

```bash
set -a
source apps/api/.env.local-blockchain
set +a
pnpm --dir apps/api run migration:run
```

### 6. Start the API stack

Run the package dev command:

```bash
set -a
source apps/api/.env.local-blockchain
set +a
pnpm --dir apps/api run dev
```

If you want to run the API stack in separate terminals instead:

```bash
set -a
source apps/api/.env.local-blockchain
set +a
pnpm --dir apps/api run start:indexer
```

```bash
set -a
source apps/api/.env.local-blockchain
set +a
pnpm --dir apps/api run start:api
```

```bash
set -a
source apps/api/.env.local-blockchain
set +a
pnpm --dir apps/api run start:processor
```

### 7. Start the web app

```bash
pnpm --dir apps/web run dev
```

Open:

```bash
http://127.0.0.1:3000
```

## Suggested Terminal Layout

1. `postgres`
2. `local-blockchain`
3. `treasury-deploy`
4. `api-indexer`
5. `api-http`
6. `api-processor`
7. `web`

For demos and debugging, keep `http://127.0.0.1:8080/admin` open so you can inspect accounts and manually advance slots.

## Troubleshooting

If the web app loads but data is missing:

- confirm `NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS` is the deployed treasury owner address
- confirm `NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION` matches the target chain
- confirm API migrations were run
- confirm all three API processes are running
- confirm the indexer has caught up enough to serve proposal and lifecycle data
- confirm the Mina node URL is reachable from the browser

If the header shows errors:

- balance and wallet balances are formatted from nanomina to `MINA`
- wallet lifecycle data depends on both Mina GraphQL and treasury API endpoints
- lifecycle status depends on treasury deployment slot plus current global slot, not latest proposal alone
