# `@repo/local-blockchain`

Lightnet-style local runtime for this repo's treasury workflows.

## Purpose

This package is intended to act as a drop-in replacement for the Lightnet surfaces that this repository actually uses, while also adding manual slot control for deterministic tests and demos.

Current goals:

- accept Mina `sendZkapp` submissions over `POST /graphql`
- expose the minimal Mina GraphQL queries currently needed by the repo
- expose the minimal archive GraphQL queries currently needed by the indexer
- provide admin controls for setting and incrementing the global slot manually
- provide admin controls for updating `stakingEpochData.ledger.hash` and `stakingEpochData.ledger.totalCurrency`
- provide a built-in admin screen for demos and deterministic e2e flows

Non-goals for now:

- full Lightnet parity
- full Mina daemon GraphQL compatibility
- synthetic archive fields that the real archive would not provide

For example, this package does **not** synthesize archive `eventType` values. It returns raw event payload data and related metadata, so downstream decoding can behave like production.

## Start

From the repo root:

```bash
pnpm --dir packages/local-blockchain run dev
```

Or:

```bash
pnpm --dir packages/local-blockchain run start
```

## Environment Variables

- `PORT`: Mina/admin server port. Default: `8180`
- `ARCHIVE_PORT`: Optional archive-compatible GraphQL port. If omitted, the archive server is not started.
- `HOST`: Bind host. Default: `127.0.0.1`
- `PROOFS_ENABLED`: Set to `true` to enable proofs when booting the internal `Mina.LocalBlockchain`

Example:

```bash
PORT=8080 ARCHIVE_PORT=8282 pnpm --dir packages/local-blockchain run dev
```

## Run Full Local Stack

To run `local-blockchain`, `apps/api`, and `apps/web`, start each package directly:

```bash
pnpm --dir packages/local-blockchain run dev
```

For CLI commands against that stack, use:

```bash
set -a
source apps/cli/.env.local-blockchain
set +a
pnpm --dir apps/cli run dev -- --help
```

If you restart the local blockchain and need the rest of the monorepo to pick up the new test
accounts, update the relevant local-blockchain env files in `apps/cli`, `apps/api`, and
`apps/web` by hand before restarting the rest of the stack.

Then deploy a treasury owner into the running local chain with the real CLI. Use a funded LocalBlockchain account from `/admin` as `SENDER_PRIVATE_KEY`, generate fresh keypairs with `pnpm --dir apps/cli run dev -- generate-keypair --json` for `TREASURY_OWNER_PRIVATE_KEY` and `PAUSE_CONTROLLER_PRIVATE_KEY`, and provide 5 multisig participant public keys:

```bash
MINA_NODE_URL=http://127.0.0.1:8080/graphql \
SENDER_PRIVATE_KEY=<funded-local-blockchain-private-key> \
TREASURY_OWNER_PRIVATE_KEY=<treasury-owner-private-key> \
PAUSE_CONTROLLER_PRIVATE_KEY=<pause-controller-private-key> \
MULTISIG_PARTICIPANTS_PUBLIC_KEYS=<PUB1>,<PUB2>,<PUB3>,<PUB4>,<PUB5> \
pnpm --dir apps/cli run dev -- treasury-owner deploy
```

Then read the deployed treasury state and copy these values from the JSON output:

```bash
MINA_NODE_URL=http://127.0.0.1:8080/graphql \
TREASURY_OWNER_PUBLIC_KEY=<treasury-owner-public-key> \
pnpm --dir apps/cli run dev -- treasury-owner read-state
```

- `treasuryOwnerAddress`
- `treasuryOwnerTokenId`

Use `treasuryOwnerAddress` as the value for `TREASURY_OWNER_CONTRACT_ADDRESS`.

### API Setup

Edit `apps/api/.env.local-blockchain`, then fill in:

- `TREASURY_OWNER_CONTRACT_ADDRESS=<treasuryOwnerPublicKey>`
- `TREASURY_OWNER_TOKEN_ID=<treasuryOwnerTokenId>`
- `DATABASE_URL=<your local postgres url>`

Load the env file in each API terminal:

```bash
set -a
source apps/api/.env.local-blockchain
set +a
```

Run the API package:

```bash
pnpm --dir apps/api run migration:run
pnpm --dir apps/api run dev
```

If you want to split the API stack manually, use `start:indexer`, `start:api`, and
`start:processor` in separate terminals.

With the example values above, the API stack will read from:

- local archive: `http://127.0.0.1:8282`
- indexer API: `http://127.0.0.1:4000`
- processor routes: `http://127.0.0.1:4002`

### Web Setup

Edit `apps/web/.env.local-blockchain`, then fill in:

- `NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS=<treasuryOwnerPublicKey>`

The other defaults already point at the local stack:

- `NEXT_PUBLIC_TREASURY_API_URL=http://127.0.0.1:4000`
- `NEXT_PUBLIC_PROCESSOR_API_URL=http://127.0.0.1:4002`
- `NEXT_PUBLIC_MINA_NODE_URL=http://127.0.0.1:8080/graphql`
- `NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION=20`

Start the web app:

```bash
pnpm --dir apps/web run dev
```

Open:

```bash
http://127.0.0.1:3000
```

### Suggested Terminal Layout

1. `local-blockchain`: `pnpm --dir packages/local-blockchain run dev`
2. `treasury-deploy`: `MINA_NODE_URL=http://127.0.0.1:8080/graphql SENDER_PRIVATE_KEY=<funded-local-blockchain-private-key> TREASURY_OWNER_PRIVATE_KEY=<treasury-owner-private-key> PAUSE_CONTROLLER_PRIVATE_KEY=<pause-controller-private-key> MULTISIG_PARTICIPANTS_PUBLIC_KEYS=<PUB1>,<PUB2>,<PUB3>,<PUB4>,<PUB5> pnpm --dir apps/cli run dev -- treasury-owner deploy`

For demos, keep `http://127.0.0.1:8080/admin` open in another tab so you can inspect accounts and manually advance slots between lifecycle steps.

## Current Endpoints

### Mina/Admin server

Base URL: `http://127.0.0.1:$PORT`

- `GET /healthz`
- `GET /admin`
- `GET /admin/state`
- `GET /admin/transactions`
- `POST /admin/slot/set` with `{ "slot": <non-negative integer> }`
- `POST /admin/slot/increment` with `{ "by": <positive integer> }`
- `POST /admin/network-state` with `{ "stakingEpochDataLedgerHash": "...", "stakingEpochDataLedgerTotalCurrency": "..." }`
- `POST /admin/transactions` with `{ "transactionJson": "<tx.toJSON()>" }`
- `POST /graphql`

Current `POST /graphql` subset:

- `bestChain(maxLength: 1)`
- `account(publicKey: ..., token: ...)`
- `sendZkapp(input: { zkappCommand: ... })`

### Archive server

Base URL: `http://127.0.0.1:$ARCHIVE_PORT`

Only available when `ARCHIVE_PORT` is set.

Current GraphQL subset:

- `networkState { maxBlockHeight { canonicalMaxBlockHeight pendingMaxBlockHeight } }`
- `events(input: { address tokenId status from to })`
- `actions(input: { address tokenId })`

## Manual Slot Control

This package intentionally uses explicit admin slot control instead of time-based waiting.

For tests and demos, prefer:

1. submit a transaction
2. call `POST /admin/slot/increment` with the exact number of slots needed
3. submit the next transaction

If the UI wants a shortcut like "increment by one lifecycle period", that should be implemented in the admin UI by sending the right `by` value, not by adding a special backend endpoint.

## Admin UI

Open:

```bash
http://127.0.0.1:$PORT/admin
```

The current built-in screen shows:

- current slot
- blockchain length
- total currency
- current staking epoch ledger hash
- current staking epoch ledger total currency
- LocalBlockchain test accounts with public key, private key, and balance

The screen also lets you:

- set slot directly
- increment by an explicit number of slots
- update `stakingEpochData.ledger.hash`
- update `stakingEpochData.ledger.totalCurrency`

The test accounts shown in the UI come from the server's LocalBlockchain instance, so they match the actual runtime state used by submitted transactions.

## Verification

Current targeted checks:

```bash
pnpm --dir packages/local-blockchain run check-types
pnpm --dir packages/local-blockchain run test
```

## Current Status

Implemented today:

- cross-process transaction submission
- state-change verification for a payment transaction
- manual slot set/increment admin APIs
- admin-configurable staking epoch ledger hash and total currency
- built-in `/admin` screen for slot/network-state/account inspection
- archive-compatible event and action journaling from executed local transactions
- full treasury create/vote/tally/execute flow coverage with manual slot advancement

Still to do:

- wire `apps/api` against this package end-to-end
