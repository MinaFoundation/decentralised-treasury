---
title: Run a Mina Single-Node Development Network
sidebar_label: Mina single node
audience: developer
page_kind: procedure
---

# Run a Mina Single-Node Development Network

Use this mode when development needs a Mina daemon and Archive process.
The network runs from a separate Mina repository checkout.

This mode is different from the in-repository o1js simulator and Docker Lightnet.
Read [Development Network Modes](network-modes.md) before you select it.

The procedure uses `--no-proofs` and continuous payment load.
It is a local development network, not a production-like deployment.

## Prepare The Repositories

Install Nix and prepare these checkouts:

- a Mina repository checkout;
- this decentralized Treasury repository checkout.

Set their absolute paths:

```bash
export MINA_REPO=/path/to/mina
export TREASURY_REPO=/path/to/decentralized-treasury
```

Use the Node.js and pnpm versions from the Treasury repository.
Install its dependencies before you run Treasury CLI commands.

The Mina command uses `nix-shell` to supply OpenSSL, Git, and Python 3.
The OpenSSL package must support Ed25519 key generation.

## Reserve The Ports

Stop processes that use these ports:

| Port   | Surface                    |
| ------ | -------------------------- |
| `3000` | Mina daemon client         |
| `3001` | Mina GraphQL               |
| `5433` | Ephemeral Archive Postgres |
| `8282` | Archive GraphQL            |

The o1js simulator and Lightnet can also use Archive port `8282`.
Do not run those networks with this network.

## Start A New Network

Run this command from the Mina repository checkout:

```bash
cd "$MINA_REPO"

nix-shell -p openssl git python3 --run \
  './scripts/mina-local-network/single-node-load.sh --no-proofs --epoch-min 30 --indefinite --archive --archive-graphql-port 8282'
```

The command starts these local processes:

- one Mina daemon;
- one Archive process;
- one ephemeral Archive Postgres database;
- the ITN GraphQL payment scheduler;
- continuous payment load.

The default command uses reset semantics.
A reset replaces the generated keys and Mina configuration under `~/.mina-network`.

## Check The Network

Query Mina GraphQL:

```bash
curl --fail-with-body \
  -H 'content-type: application/json' \
  --data '{"query":"query { syncStatus bestChain(maxLength: 1) { stateHash } }"}' \
  http://127.0.0.1:3001/graphql
```

Continue when `syncStatus` is `SYNCED` and `bestChain` contains one block.
The daemon can report `BOOTSTRAP` for one or two minutes after startup.

The network can print libp2p warnings because it has no peers.
These warnings are expected in this single-node mode.

## Align The Treasury Lifecycle

The command creates 48 slots in each 30-minute Mina epoch.
Each slot is `37500` milliseconds.

Use these values for this network:

```text
LIFECYCLE_PERIOD_DURATION=48
NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION=48
NEXT_PUBLIC_SLOT_DURATION_MS=37500
```

One Treasury lifecycle contains four periods.
With these values, one lifecycle takes approximately 120 minutes.

Use one lifecycle identifier for deployment, ledger import, proofs, and proposals.
If you change `--epoch-min`, recalculate the slot duration and update the browser value.

## Extract The Funded Account

The script creates a funded online whale account.
Dump its keypair from the Mina repository checkout:

```bash
cd "$MINA_REPO"

MINA_PRIVKEY_PASS='naughty blue worm' \
  ./single-node-devnet/bin/mina advanced dump-keypair \
  --privkey-path ~/.mina-network/online_whale_keys/online_whale_account_0
```

The password is a fixed value for this local Mina script.
Treat the printed private key as sensitive development data.

Export it for the Treasury environment bootstrap:

```bash
export ONLINE_WHALE_PRIVATE_KEY="<Private key from dump-keypair>"
```

Export the direct host endpoints:

```bash
export MINA_NODE_URL=http://127.0.0.1:3001/graphql
export ARCHIVE_NODE_URL=http://127.0.0.1:8282
export MINA_NETWORK_ID=devnet
```

Generate the existing `testnet` family from the Treasury repository:

```bash
cd "$TREASURY_REPO"

pnpm env:bootstrap testnet -- --sender-private-key "$ONLINE_WHALE_PRIVATE_KEY"
```

The `testnet` templates use live-network timing. Override them for this
single-node network:

```text
apps/cli/.env.testnet:        LIFECYCLE_PERIOD_DURATION=48
apps/cli/.env.testnet:        MINA_NETWORK_ID=devnet
apps/api/.env.testnet:        LIFECYCLE_PERIOD_DURATION=48
apps/web/.env.testnet:        NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION=48
apps/web/.env.testnet:        NEXT_PUBLIC_SLOT_DURATION_MS=37500
apps/backoffice/.env.testnet: NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION=48
```

Do this before compilation or deployment. All five values must describe the
same network timing.

Use the generated CLI family for direct host commands.
Do not add the funded key to API, web, Backoffice, or DevOps files.

The family name does not start the Compose stack. Compose live-testnet
operation is a separate [Operator procedure](../../operate/deployment/compose-testnet.md).

## Export The Staking Ledger

Create a directory for lifecycle-specific exports:

```bash
mkdir -p "$TREASURY_REPO/.data/testnet-ledgers"
```

Export the staking epoch ledger for lifecycle `0`:

```bash
cd "$MINA_REPO"

./single-node-devnet/bin/mina ledger export staking-epoch-ledger \
  --daemon-port 3000 \
  > "$TREASURY_REPO/.data/testnet-ledgers/staking-ledger-lifecycle-0.json"
```

Record a ledger for each lifecycle identifier. You can reuse one
content-addressed JSON payload only when the Proposal accounts record the same
ledger root. Keep each lifecycle import and record separate.

## Import And Verify The Ledger Root

Load the generated CLI family:

```bash
cd "$TREASURY_REPO"

set -a
source apps/cli/.env.testnet
set +a
```

Import the ledger into the lifecycle SQLite file:

```bash
SQLITE_DATA_DIRECTORY="$PWD/.data/testnet-sqlite" \
pnpm run cli -- staking-ledger from-file \
  --lifecycle-id 0 \
  --staking-ledger-path ./.data/testnet-ledgers/staking-ledger-lifecycle-0.json
```

Read the imported ledger root:

```bash
SQLITE_DATA_DIRECTORY="$PWD/.data/testnet-sqlite" \
pnpm run cli -- staking-ledger get-root-hash \
  --lifecycle-id 0 \
  --output-format json
```

Record that value with the lifecycle snapshot.
Verify a known expected root with this command:

```bash
SQLITE_DATA_DIRECTORY="$PWD/.data/testnet-sqlite" \
pnpm run cli -- staking-ledger get-root-hash \
  --lifecycle-id 0 \
  --expected-root-hash <EXPECTED_ROOT_HASH> \
  --output-format json
```

The command fails when the imported ledger has a different root.
Do not start proof work until the expected root matches.

## Stop Or Reuse The Network

Stop the foreground network command with `Ctrl+C`.
This action lets the script clean up the network and its ephemeral Postgres process.

The next default start creates new Mina keys and configuration.
Dump the new whale key and refresh the matching Treasury environment after a reset.

Use this start command when you must reuse the existing Mina keys and configuration:

```bash
cd "$MINA_REPO"

nix-shell -p openssl git python3 --run \
  './scripts/mina-local-network/single-node-load.sh --no-proofs --epoch-min 30 --indefinite --archive --archive-graphql-port 8282 -- -c inherit'
```

The inherit option keeps identity inputs under `~/.mina-network`.
It does not make this development network a durable deployment.

Reuse or intentionally replace the matching ledger JSON and lifecycle SQLite files.
Never mix lifecycle data from a reset network with the previous network.

## Understand The Limits

This procedure runs Mina binaries, but it disables blockchain proofs.
The payment scheduler also changes the local ledger while the network runs.

This network does not provide the simulator admin controls.
For deterministic slot controls, use the [in-repository simulator](local-blockchain.md).

For disposable Docker-based Mina integration tests, use [Lightnet](lightnet.md).
For live-testnet deployment, use the [Operator section](../../operate/index.md).

## Sources

- `devops/TESTNET_MINA_NODE.md`
- `devops/scripts/bootstrap-env.mjs`
- `apps/cli/src/commands/staking-ledger.ts`
- `packages/sdk/src/services/sqlite/sqlite-staking-ledger-service.ts`
