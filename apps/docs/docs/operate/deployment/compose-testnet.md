---
title: Run Compose on a Live Testnet
sidebar_label: Compose live-testnet stack
audience: operator
page_kind: procedure
---

# Run Compose on a Live Testnet

Use this procedure for a long-running cloud host connected to a live Mina
testnet. The host runs the Treasury application services with Docker Compose.

This is an operator deployment. It is not one of the local development
networks. Developers must use the separate procedures for the o1js simulator,
Mina single-node network, or Docker Lightnet.

## Understand The Boundary

The Compose stack runs these parts:

- Treasury web application and Backoffice;
- App API, indexer, and processor;
- Postgres and lifecycle SQLite storage;
- Caddy reverse proxy;
- voting-ledger scheduler;
- optional Redis, proof workers, and proving scheduler.

The Compose stack does not run Mina, Archive, or a staking-ledger exporter.
Supply these three inputs from services outside this stack.

```text
Live Mina and Archive
        |
        +--> Compose application services
        |
        +--> external snapshot producer
                 |
                 +--> <ledgerHash>.json
                 +--> lifecycle-<id>.hash
                              |
                              +--> voting-ledger scheduler
                                      |
                                      +--> lifecycle SQLite and proofs
```

## Before You Start

Prepare one long-running Linux host with:

- Docker Engine with Compose support;
- the Node.js and pnpm versions pinned by this repository;
- persistent storage outside the repository checkout;
- a live Mina GraphQL endpoint;
- a matching Archive GraphQL endpoint;
- a funded testnet fee payer or Ledger account;
- DNS and ports `80` and `443` for public HTTPS;
- SSH access for private Backoffice use;
- enough CPU and memory for measured proof work.

Record the Mina network ID, endpoints, source revision, lifecycle values, and
contract keys before deployment.

## 1. Prepare Persistent Paths

Set these absolute host paths in `<DEVOPS_ENV_FILE>`:

```env
SQLITE_DATA_HOST_PATH=/opt/mina/.treasury-sqlite
STAKING_LEDGERS_HOST_PATH=/opt/mina/.treasury-staking-ledgers
```

The generated testnet template uses these defaults. Select equivalent paths
when the host uses another service account. Keep both paths outside the
repository checkout and Mina's resettable `.mina-network` directory.

Create both directories. The application containers use UID `1000` for
lifecycle SQLite writes. The scheduler needs read access to staking snapshots.

```bash
mkdir -p <SQLITE_DATA_HOST_PATH>
mkdir -p <STAKING_LEDGERS_HOST_PATH>
sudo chown -R 1000:1000 <SQLITE_DATA_HOST_PATH>
```

Give the external snapshot producer write access to
`<STAKING_LEDGERS_HOST_PATH>`. Give container UID `1000` read and directory
traversal access. Do not give the scheduler write access to this directory.

Keep Postgres volumes, lifecycle SQLite files, snapshot inputs, proof outputs,
and environment backups in the host backup plan.

## 2. Generate One Testnet Environment

Generate the environment family from the repository root:

```bash
pnpm env:bootstrap testnet -- \
  --network-id <mainnet|devnet|testnet> \
  --proofs-enabled true \
  --sender-private-key <FUNDED_TESTNET_PRIVATE_KEY> \
  --mina-node-url <HOST_MINA_GRAPHQL_URL> \
  --archive-node-url <HOST_ARCHIVE_GRAPHQL_URL> \
  --compose-mina-node-upstream <CONTAINER_MINA_UPSTREAM> \
  --compose-archive-node-url <CONTAINER_ARCHIVE_GRAPHQL_URL> \
  --next-public-treasury-api-url <PUBLIC_WEB_ORIGIN>/api \
  --next-public-indexer-api-url <PUBLIC_WEB_ORIGIN>/indexer \
  --next-public-processor-api-url <PUBLIC_WEB_ORIGIN>/processor \
  --next-public-mina-node-url <PUBLIC_WEB_ORIGIN>/mina/graphql
```

Use an approved custody method instead of the private-key option when required.
The CLI also supports Ledger for every transaction command in the
[signing support matrix](/learn/signing-with-ledger-and-auro#check-operation-and-wallet-support).

Check that all consumers use the same:

- Mina network and signature network ID;
- Treasury Owner and Pause Controller addresses;
- lifecycle duration and deployment slot;
- verification keys and empty roots;
- Mina and Archive network data.

Do not commit generated environment files. Do not put a funded private key in
the Compose, API, web, or Backoffice environment.

## 3. Configure And Deploy The Treasury

Complete [Configure the Treasury](../lifecycle/configure-the-treasury.md).
Then complete [Deploy the Treasury](deploy-the-treasury.md).

Compile once for the selected lifecycle values. Copy all emitted `browserEnv`
values into `<WEB_ENV_FILE>` and `<BACKOFFICE_ENV_FILE>`.

After deployment, read both contract accounts from Mina. Confirm the deployed
start slot, Pause Controller address, permissions, and ordered five-key
commitment before you start application services.

## 4. Prepare Every Staking Snapshot

A Proposal records one staking-ledger root and total currency when it is
created. The tally proof must use the exact ledger behind that recorded root.

The Compose scheduler does not calculate epochs or export ledgers. An external
snapshot producer must resolve each Treasury lifecycle to one Mina ledger.

### Obtain The Authoritative Hash

Query the target Mina node:

```bash
curl --fail-with-body \
  -H 'content-type: application/json' \
  --data '{"query":"{ bestChain(maxLength:1){ protocolState{ consensusState{ epoch stakingEpochData{ ledger{ hash totalCurrency } } } } } }"}' \
  <HOST_MINA_GRAPHQL_URL> | jq .
```

Record the Base58 `hash`, epoch, total currency, and observation time. Do not
identify a snapshot by epoch alone. Epoch numbers can repeat after a hard fork.

### Export Or Obtain The JSON

For a self-operated Mina node, run the Mina export command on that node:

```bash
mina ledger export staking-epoch-ledger \
  --daemon-port <MINA_CLIENT_PORT> > <STAGING_LEDGER_JSON>
```

For a managed node, obtain the same Mina-format JSON from the approved snapshot
provider. The file must be complete and ordered. It must contain the
default-token Treasury Owner account with a nonzero balance.

### Verify The Payload Root

Use an isolated validation directory so that this check cannot replace live
lifecycle data:

```bash
mkdir -p <LEDGER_VALIDATION_DIRECTORY>

dotenvx run -f <CLI_ENV_FILE> -- \
  env SQLITE_DATA_DIRECTORY=<LEDGER_VALIDATION_DIRECTORY> \
  pnpm run cli -- staking-ledger from-file \
  --lifecycle-id <VALIDATION_ID> \
  --staking-ledger-path <STAGING_LEDGER_JSON>

dotenvx run -f <CLI_ENV_FILE> -- \
  env SQLITE_DATA_DIRECTORY=<LEDGER_VALIDATION_DIRECTORY> \
  pnpm run cli -- staking-ledger get-root-hash \
  --lifecycle-id <VALIDATION_ID> \
  --expected-root-hash <LEDGER_HASH> \
  --output-format json
```

Continue only when the command accepts `<LEDGER_HASH>`. The JSON output also
contains the decimal field value stored on Proposal accounts.

### Publish The Compose Input

The directory contract is exact:

```text
<STAKING_LEDGERS_HOST_PATH>/<LEDGER_HASH>.json
<STAKING_LEDGERS_HOST_PATH>/lifecycle-<L>.hash
```

Publish the payload before the pointer. Use temporary files on the same file
system so each final move is atomic.

```bash
cp <STAGING_LEDGER_JSON> \
  <STAKING_LEDGERS_HOST_PATH>/<LEDGER_HASH>.json.tmp
mv <STAKING_LEDGERS_HOST_PATH>/<LEDGER_HASH>.json.tmp \
  <STAKING_LEDGERS_HOST_PATH>/<LEDGER_HASH>.json

printf '%s\n' '<LEDGER_HASH>' \
  > <STAKING_LEDGERS_HOST_PATH>/lifecycle-<L>.hash.tmp
mv <STAKING_LEDGERS_HOST_PATH>/lifecycle-<L>.hash.tmp \
  <STAKING_LEDGERS_HOST_PATH>/lifecycle-<L>.hash
```

The snapshot input mount is read-only inside Compose. If validation later
fails, replace the host payload with a verified file. Then wait for the retry
backoff or run the controlled one-shot procedure.

Do not change a published pointer while its lifecycle is processing. The
scheduler fails the current run if it detects a change before completion.

A lifecycle pointer becomes immutable after the scheduler writes
`<L>.sqlite.done`. The scheduler reports a changed pointer and refuses to
replace completed state automatically. Use [Rebuild One
Lifecycle](../proving/ledgers-and-proving.md#rebuild-one-lifecycle) with all
dependent services stopped when an approved correction is necessary.

## 5. Check And Start Compose

Render the effective configuration before startup:

```bash
pnpm testnet:config
```

Confirm endpoints, paths, network IDs, public origins, and proof settings in
the rendered output. Then build and start the stack:

```bash
pnpm testnet:up:build
```

The generated environment sets `PROOFS_ENABLED=true`. Confirm the resolved
value and measure the required resources before you start the proving profile:

```bash
pnpm testnet:up:proving:build
```

Use `--proofs-enabled false` in the complete environment-generation command
in Step 2 when you do not want real proof work.

Follow [Ledgers and Proving](../proving/ledgers-and-proving.md) for scheduler,
backlog, checkpoint, retry, and proof procedures.

## 6. Publish The User Application

Configure the public domains and TLS email in `<DEVOPS_ENV_FILE>`. Keep browser
API and Mina URLs on the intended HTTPS origin. Then start the public profile:

```bash
pnpm testnet:up:public
```

This command starts both proxy profiles. The public proxy exposes the user
application and its required routes. The local proxy keeps Backoffice on the
host loopback address. The public proxy does not expose Backoffice.

Use an SSH loopback tunnel for remote Backoffice access:

```bash
ssh -N -L 3200:127.0.0.1:3200 <OPERATOR_HOST>
```

Open `http://127.0.0.1:3200` on the operator workstation. This loopback origin
supports Ledger WebHID in a compatible Chromium browser. Follow the
[Ledger and Auro setup](/learn/signing-with-ledger-and-auro#set-up-ledger-in-a-browser).

## 7. Verify Readiness

Check each boundary:

```bash
curl --fail-with-body <PUBLIC_WEB_ORIGIN>/api/healthz
curl --fail-with-body <PUBLIC_WEB_ORIGIN>/indexer/status
curl --fail-with-body <PUBLIC_WEB_ORIGIN>/processor/status
pnpm testnet:status
pnpm testnet:logs
```

Confirm these results:

- Mina and Archive report the same target network;
- the Archive head advances;
- the indexer cursor advances toward the Archive head;
- the processor offset advances toward the indexer;
- the API and web application show the deployed Treasury;
- each lifecycle pointer has its hash-named JSON payload;
- each completed lifecycle has `<L>.sqlite.done`;
- each proved lifecycle has `<L>.sqlite.proven` and an exhausted proof.

HTTP health alone does not prove that the data is current.
The indexer, processor, and schedulers do not expose separate HTTP health
routes. Check their container state, restart count, logs, cursors, and marker
age. Treat a restart loop or stale progress as a failed readiness check.

## 8. Run And Maintain The Stack

Use [Service Procedures](../services/service-operations.md) for start, stop,
restart, logs, migration, and update commands.

Use [Ideal Lifecycle Operation](../lifecycle/ideal-lifecycle.md) for proposal,
vote, tally, and execution work. A tally needs five distinct non-initial
action-state targets. Use five eligible voter accounts in an acceptance run so
each first vote can add weight.

Stop Compose without deleting persistent data:

```bash
pnpm testnet:down
```

Do not use the reset command on a live deployment unless the approved recovery
procedure explicitly requires volume deletion.

## Sources

- `devops/compose.yml`
- `devops/TESTNET.md`
- `devops/proxy/Caddyfile.https`
- `devops/docker/voting-ledger-scheduler-entrypoint.sh`
- `devops/docker/proving-scheduler-entrypoint.sh`
- `devops/scripts/bootstrap-env.mjs`
- `apps/cli/src/commands/staking-ledger.ts`
- `packages/sdk/src/provable/contracts/treasury-owner.ts`
