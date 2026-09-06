# Testnet Mina Node Runbook

This guide explains how to run a local Mina node and archive node for the decentralized treasury testnet flow. It covers the Mina-side setup only: starting the node, checking health, exporting the funded whale keypair, exporting the staking ledger, and keeping Mina epoch settings aligned with treasury lifecycle settings.

For the full treasury deployment and Compose flow, see `TESTNET.md`. For a
Kubernetes Mina daemon and Archive deployment, see
`runbooks/1-Network/1a-Archive-Node/README.md` and
`runbooks/1-Network/1b-Mina-Daemon/README.md`.

The commands assume:

- Mina repo: `$MINA_REPO`
- Decentralized treasury repo: `$TREASURY_REPO`
- Local network root: `~/.mina-network`
- Mina daemon client port: `3000`
- Mina GraphQL port: `3001`
- Archive GraphQL port: `8282`
- Ephemeral archive Postgres port: `5433`

Set these once in your shell before running the examples:

```bash
export MINA_REPO=/path/to/mina
export TREASURY_REPO=/path/to/decentralized-treasury
```

## What `--epoch-min` Does

The command in this guide uses a 30 minute Mina epoch:

```text
--epoch-min 30
slots per epoch = 48
slot duration = 30 min / 48 = 37.5 sec = 37500 ms
```

`--epoch-min` is a convenience flag on `single-node-load.sh` / `single-node-network.sh`. It does not set the treasury lifecycle directly. It asks the Mina local-network script to make one Mina epoch last approximately that many wall-clock minutes.

The script keeps the epoch at 48 slots and derives the slot duration:

```text
slot duration = epoch minutes * 60 seconds / 48
```

For `--epoch-min 30`, the ideal slot is:

```text
30 * 60 / 48 = 37.5 seconds
```

The Mina script then snaps the slot duration to a consensus-valid value. In this case the snapped value is exactly `37500 ms`, so the chain runs with:

```text
48 slots per epoch
37500 ms per slot
30 minutes per epoch
```

If you change `--epoch-min`, update the treasury slot settings to match the new chain timing:

```text
LIFECYCLE_PERIOD_DURATION=<slots per treasury period>
NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION=<same value>
NEXT_PUBLIC_SLOT_DURATION_MS=<derived Mina slot duration>
```

For the setup in this guide, `LIFECYCLE_PERIOD_DURATION=48` makes one treasury period equal one Mina epoch. A full treasury lifecycle is four periods, so it lasts four Mina epochs.

## Start The Local Mina Node

Run this from the Mina repo root:

```bash
cd "$MINA_REPO"

nix-shell -p openssl git python3 --run \
  './scripts/mina-local-network/single-node-load.sh --no-proofs --epoch-min 30 --indefinite --archive --archive-graphql-port 8282'
```

This starts:

- a single Mina daemon
- an archive node
- an ephemeral local Postgres database for the archive node
- the ITN GraphQL payment scheduler
- continuous payment load

The wrapper is needed because the local script requires an OpenSSL that can generate Ed25519 keys, plus `git` and `python3`.
The `--archive-graphql-port 8282` flag makes the archive GraphQL endpoint match
the treasury `ARCHIVE_NODE_URL` defaults in this repo.

## Export Treasury Endpoint Inputs

After the Mina daemon and archive node are running, export the endpoint values
that the treasury env bootstrap reads:

```bash
export MINA_NODE_URL=http://127.0.0.1:3001/graphql
export ARCHIVE_NODE_URL=http://127.0.0.1:8282
export MINA_NODE_PROXY_UPSTREAM=http://host.docker.internal:3001
export COMPOSE_ARCHIVE_NODE_URL=http://host.docker.internal:8282
export NEXT_PUBLIC_TREASURY_API_URL=http://127.0.0.1:3100/api
export NEXT_PUBLIC_INDEXER_API_URL=http://127.0.0.1:3100/indexer
export NEXT_PUBLIC_PROCESSOR_API_URL=http://127.0.0.1:3100/processor
export NEXT_PUBLIC_MINA_NODE_URL=http://127.0.0.1:3100/mina/graphql
```

`MINA_NODE_URL` and `ARCHIVE_NODE_URL` are for CLI/operator commands on the
host. `MINA_NODE_PROXY_UPSTREAM` and `COMPOSE_ARCHIVE_NODE_URL` are for Compose
containers, which reach the Mina node and archive node through
`host.docker.internal`.

## Treasury Lifecycle Alignment

Mina epochs and treasury lifecycles are related, but they are not the same thing.

The local Mina command sets the chain epoch length:

```bash
--epoch-min 30
```

The single-node script always uses 48 slots per epoch. With `--epoch-min 30`, each slot is `37500 ms`, and one Mina epoch is 48 slots. If you choose a different `--epoch-min`, recalculate the slot duration and update `NEXT_PUBLIC_SLOT_DURATION_MS` so the web app displays period timing correctly.

The treasury app uses `LIFECYCLE_PERIOD_DURATION` as a number of Mina slots. The CLI currently treats a full lifecycle as four consecutive periods. The proposal creation window for lifecycle `N` starts at:

```text
TREASURY_DEPLOYED_AT_SLOT + (LIFECYCLE_PERIOD_DURATION * 4 * N)
```

and ends after one `LIFECYCLE_PERIOD_DURATION`.

For this local Mina testnet, use:

```text
LIFECYCLE_PERIOD_DURATION=48
NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION=48
NEXT_PUBLIC_SLOT_DURATION_MS=37500
```

That makes each treasury period equal to one Mina epoch. One full treasury lifecycle is then four Mina epochs:

```text
4 * 48 slots = 192 slots
192 slots * 37.5 sec = 7200 sec = 120 min
```

Use `lifecycleId=0` for the first lifecycle after deployment. Use `lifecycleId=1` for the next one, and so on. Use the same lifecycle id everywhere: proposal creation, vote reducer, staking-ledger import, staking-ledger-to-voting-ledger proof, tally, API witness lookups, and exported ledger filenames.

## Treasury Env Values For This Node

Before bootstrapping or updating treasury env files, extract the funded online whale key from the running Mina node. This key pays fees for CLI deployment and operator transactions.

Dump the keypair:

```bash
cd "$MINA_REPO"

MINA_PRIVKEY_PASS='naughty blue worm' \
  ./single-node-devnet/bin/mina advanced dump-keypair \
  --privkey-path ~/.mina-network/online_whale_keys/online_whale_account_0
```

The output includes lines like:

```text
Private key: <ONLINE_WHALE_PRIVATE_KEY>
Public key: <ONLINE_WHALE_PUBLIC_KEY>
```

Set the private key in your shell for the env bootstrap step:

```bash
export ONLINE_WHALE_PRIVATE_KEY="<Private key from dump-keypair>"
```

Use this value only as `SENDER_PRIVATE_KEY` in the CLI/operator env. Do not put it in `apps/api/.env.testnet`, `apps/web/.env.testnet`, or `devops/.env.testnet`.

Now return to `TESTNET.md` and bootstrap the treasury testnet env files from the
decentralized treasury repo. The command reads the endpoint exports above:

```bash
cd "$TREASURY_REPO"

pnpm env:bootstrap testnet -- --sender-private-key "$ONLINE_WHALE_PRIVATE_KEY"
```

For this local Mina node, the generated env review in `TESTNET.md` should use
these Mina-side values:

```text
MINA_NODE_URL=http://127.0.0.1:3001/graphql
ARCHIVE_NODE_URL=http://127.0.0.1:8282
NEXT_PUBLIC_TREASURY_API_URL=http://127.0.0.1:3100/api
NEXT_PUBLIC_INDEXER_API_URL=http://127.0.0.1:3100/indexer
NEXT_PUBLIC_PROCESSOR_API_URL=http://127.0.0.1:3100/processor
NEXT_PUBLIC_MINA_NODE_URL=http://127.0.0.1:3100/mina/graphql
MINA_NODE_PROXY_UPSTREAM=http://host.docker.internal:3001
Compose ARCHIVE_NODE_URL=http://host.docker.internal:8282
LIFECYCLE_PERIOD_DURATION=48
SQLITE_DATA_DIRECTORY=./.data/testnet-sqlite
NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION=48
NEXT_PUBLIC_SLOT_DURATION_MS=37500
```

The browser uses full URLs through the local Caddy web origin. Compose
containers use `host.docker.internal` to reach the archive and Mina node running
on the Docker host.

## Set The Treasury Deployment Slot

For a quick local run, `TREASURY_DEPLOYED_AT_SLOT=0` is acceptable.

For a cleaner lifecycle test, deploy at an epoch boundary. Query the current slot:

```bash
cd "$MINA_REPO"

python3 - <<'PY'
import json, urllib.request

url = "http://127.0.0.1:3001/graphql"
query = """
query {
  bestChain(maxLength: 1) {
    protocolState {
      consensusState {
        slotSinceGenesis
      }
    }
  }
}
"""

req = urllib.request.Request(
    url,
    data=json.dumps({"query": query}).encode(),
    headers={"Content-Type": "application/json"},
)

with urllib.request.urlopen(req, timeout=10) as resp:
    data = json.load(resp)
slot = int(data["data"]["bestChain"][0]["protocolState"]["consensusState"]["slotSinceGenesis"])
next_epoch_start = ((slot // 48) + 1) * 48
print(f"current slot: {slot}")
print(f"next epoch start slot: {next_epoch_start}")
PY
```

Then use the chosen slot consistently:

```text
TREASURY_DEPLOYED_AT_SLOT=<chosen slot>
```

Set it in `apps/api/.env.testnet` for the API stack and in your CLI shell/env when deploying or reading lifecycle state.

## Healthy Output

The run is healthy when you see output like:

```text
Daemon is SYNCED.
authenticated: server uuid ..., sequence number 0
scheduled window, handle: ...
Payment scheduler ... is sending a payment ...
Successfully produced a new block
```

The local network may print libp2p warnings about no peers. For this single-node demo-mode setup, those warnings are expected and do not mean the node is broken.

## Check Node Health

Query the daemon GraphQL endpoint:

```bash
cd "$MINA_REPO"

python3 - <<'PY'
import json, urllib.request

url = "http://127.0.0.1:3001/graphql"
query = """
query {
  syncStatus
  bestChain(maxLength: 1) {
    stateHash
    protocolState {
      consensusState {
        blockHeight
        slotSinceGenesis
      }
    }
  }
}
"""

req = urllib.request.Request(
    url,
    data=json.dumps({"query": query}).encode(),
    headers={"Content-Type": "application/json"},
)

with urllib.request.urlopen(req, timeout=10) as resp:
    print(json.dumps(json.load(resp), indent=2))
PY
```

Expected result:

- `syncStatus` is `SYNCED`
- `bestChain` returns at least one block

If the daemon has just started, it can briefly report `BOOTSTRAP` or return no best chain while it waits for genesis. Wait a minute or two and query again.

## Export The Online Whale Keypair

The local online whale key is:

```text
~/.mina-network/online_whale_keys/online_whale_account_0
```

Dump it with:

```bash
cd "$MINA_REPO"

MINA_PRIVKEY_PASS='naughty blue worm' \
  ./single-node-devnet/bin/mina advanced dump-keypair \
  --privkey-path ~/.mina-network/online_whale_keys/online_whale_account_0
```

The output includes the private key. Treat it as sensitive, even though it is local testnet material.

## Export The Staking Ledger

Export the staking epoch ledger from the running daemon:

```bash
cd "$MINA_REPO"

./single-node-devnet/bin/mina ledger export staking-epoch-ledger \
  --daemon-port 3000 \
  > /path/to/folder/staking-ledger-lifecycle-<lifecycleId>.json
```

Example:

```bash
cd "$MINA_REPO"

./single-node-devnet/bin/mina ledger export staking-epoch-ledger \
  --daemon-port 3000 \
  > "$TREASURY_REPO/staking-ledger-lifecycle-local.json"
```

Replace `<lifecycleId>` with the lifecycle identifier used by the decentralized treasury flow.

## Import The Staking Ledger For A Lifecycle

The treasury proof and API flows need a lifecycle-specific SQLite database derived from the staking ledger JSON.

Use a lifecycle-specific filename:

```bash
mkdir -p "$TREASURY_REPO/.data/testnet-ledgers"
```

For lifecycle `0`, export from the running Mina daemon:

```bash
cd "$MINA_REPO"

./single-node-devnet/bin/mina ledger export staking-epoch-ledger \
  --daemon-port 3000 \
  > "$TREASURY_REPO/.data/testnet-ledgers/staking-ledger-lifecycle-0.json"
```

Import that file into the lifecycle SQLite store from the decentralized treasury repo:

```bash
cd "$TREASURY_REPO"

set -a
source apps/cli/.env.testnet
set +a

SQLITE_DATA_DIRECTORY="$PWD/.data/testnet-sqlite" \
pnpm run cli -- staking-ledger from-file \
  --lifecycle-id 0 \
  --staking-ledger-path ./.data/testnet-ledgers/staking-ledger-lifecycle-0.json
```

This writes:

```text
.data/testnet-sqlite/0.sqlite
```

If the API stack runs in Docker Compose, make sure `devops/.env.testnet` mounts the same host directory:

```text
SQLITE_DATA_HOST_PATH=./.data/testnet-sqlite
```

Inside the API container, the same file is visible as:

```text
/data/sqlite/0.sqlite
```

You can verify that the CLI can read the lifecycle staking ledger:

```bash
SQLITE_DATA_DIRECTORY="$PWD/.data/testnet-sqlite" \
pnpm run cli -- staking-ledger get-root-hash \
  --lifecycle-id 0
```

Use the same lifecycle id for follow-up proof commands:

```bash
pnpm run cli -- staking-ledger-to-voting-ledger compile

SQLITE_DATA_DIRECTORY="$PWD/.data/testnet-sqlite" \
pnpm run cli -- staking-ledger-to-voting-ledger trace-digest \
  --lifecycle-id 0
```

## Reset Or Reuse Mina Keys

The default local Mina command runs the lower-level network script with reset semantics. A reset regenerates:

```text
~/.mina-network/online_whale_keys/
~/.mina-network/offline_whale_keys/
~/.mina-network/snark_coordinator_keys/
~/.mina-network/daemon.json
```

This means the online whale keypair changes after a fresh reset.

When the Mina network is reset, review and update the treasury env before deploying again:

- `SENDER_PRIVATE_KEY` in `apps/cli/.env.testnet` if you use the online whale as fee payer
- `TREASURY_DEPLOYED_AT_SLOT` if you want a new lifecycle start
- exported staking ledger JSON files
- lifecycle SQLite files under `.data/testnet-sqlite`

Use reset when you want a clean local chain:

```bash
cd "$MINA_REPO"

nix-shell -p openssl git python3 --run \
  './scripts/mina-local-network/single-node-load.sh --no-proofs --epoch-min 30 --indefinite --archive --archive-graphql-port 8282'
```

Use inherit when you want to reuse the existing `~/.mina-network` keys and config:

```bash
cd "$MINA_REPO"

nix-shell -p openssl git python3 --run \
  './scripts/mina-local-network/single-node-load.sh --no-proofs --epoch-min 30 --indefinite --archive --archive-graphql-port 8282 -- -c inherit'
```

A normal daemon restart that does not reset or delete `~/.mina-network` keeps the same keypair. A fresh reset regenerates it.

If you reuse Mina keys with `-- -c inherit`, also reuse or intentionally clear the matching treasury lifecycle data. A common local cleanup before a new lifecycle test is:

```bash
cd "$TREASURY_REPO"

rm -f ./.data/testnet-sqlite/<lifecycleId>.sqlite
rm -f ./.data/testnet-ledgers/staking-ledger-lifecycle-<lifecycleId>.json
```

Do not delete lifecycle data for a lifecycle that the API or processor still needs to serve.

## Stop The Mina Node

If the command is running in your terminal, stop it with:

```text
Ctrl-C
```

That lets the script clean up the local network and ephemeral Postgres.

If you need to check what is still running:

```bash
ps -axo pid,ppid,pgid,command | rg \
  'single-node-load\.sh|single-node-network\.sh|mina-local-network|min[a-]|mina daemon|mina-archive|postgres -D /private/tmp/nix-shell|mina-libp2p_helper|parallel-worker'
```

## Common Issues

### OpenSSL cannot generate Ed25519 keys

Use the `nix-shell -p openssl git python3 --run ...` wrapper shown above.

### `bestChain` is empty right after startup

The daemon may be waiting for genesis. Wait one or two minutes and query GraphQL again.

### Whale key changes between runs

You restarted with reset semantics. Use `-- -c inherit` if you need stable keys across restarts.
After any reset, dump the new online whale keypair and update `SENDER_PRIVATE_KEY` in `apps/cli/.env.testnet` before running treasury CLI transactions.

### Archive executable path looks unusual

In this setup, the archive binary is resolved from:

```text
$MINA_REPO/single-node-devnet-archive-archive/bin/mina-archive
```

That is expected for the Nix archive output used by this local run.
