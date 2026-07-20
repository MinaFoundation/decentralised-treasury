# Testnet Operator Runbook

Use this guide to run the treasury Compose stack against a Mina testnet node and
archive node. It is the primary operator path. For a local simulator demo, use
`DEMO.md`. For starting a local Mina daemon and archive node first, use
`devops/TESTNET_MINA_NODE.md`.

## What This Runbook Starts

The Compose stack starts the treasury app services only:

- web UI
- app API
- indexer API
- processor API
- indexer runtime
- processor runtime
- Postgres
- Caddy reverse proxy

It does not start a Mina node, archive node, Redis, proof workers, or SDK
tracing machines. Those are external inputs.

## Happy Path

This is the shortest path to a running local operator stack:

```bash
CI=true pnpm install --frozen-lockfile
pnpm env:bootstrap testnet -- --sender-private-key <FUNDED_TESTNET_PRIVATE_KEY>
# Review apps/api/.env.testnet, apps/cli/.env.testnet, apps/web/.env.testnet.
dotenvx run -f apps/cli/.env.testnet -- pnpm run cli -- treasury-owner compile
# Copy emitted browserEnv values into apps/web/.env.testnet.
dotenvx run -f apps/cli/.env.testnet -- pnpm run cli -- treasury-owner deploy
dotenvx run -f apps/cli/.env.testnet -- pnpm run cli -- treasury-owner fund-treasury --amount 1000000000000
pnpm testnet:up:build
curl http://127.0.0.1:4100/healthz
# Visit http://127.0.0.1:3100 in your browser.
```

If the funded sender key is already present in `apps/cli/.env.testnet`, rerun
`pnpm testnet:env` instead of passing `--sender-private-key`.

## 1. Prepare External Testnet Services

Before bootstrapping, make sure you have:

- a browser-reachable Mina GraphQL endpoint
- a host-reachable Mina GraphQL endpoint for CLI/operator commands
- an archive GraphQL endpoint reachable from Compose containers
- a host-reachable archive GraphQL endpoint for CLI/operator commands
- a funded sender private key for testnet fees

For a local Mina node using the companion runbook, the defaults are:

```text
MINA_NODE_URL=http://127.0.0.1:3001/graphql
ARCHIVE_NODE_URL=http://127.0.0.1:8282
NEXT_PUBLIC_TREASURY_API_URL=http://127.0.0.1:3100/api
NEXT_PUBLIC_INDEXER_API_URL=http://127.0.0.1:3100/indexer
NEXT_PUBLIC_PROCESSOR_API_URL=http://127.0.0.1:3100/processor
NEXT_PUBLIC_MINA_NODE_URL=http://127.0.0.1:3100/mina/graphql
MINA_NODE_PROXY_UPSTREAM=http://host.docker.internal:3001
Compose ARCHIVE_NODE_URL=http://host.docker.internal:8282
```

Start that local Mina node with the archive GraphQL port pinned to `8282`:

```bash
nix-shell -p openssl git python3 --run \
  './scripts/mina-local-network/single-node-load.sh --no-proofs --epoch-min 30 --indefinite --archive --archive-graphql-port 8282'
```

For hosted infrastructure or non-default local ports, pass the endpoints to
bootstrap instead of editing generated files by hand:

```bash
pnpm env:bootstrap testnet -- \
  --sender-private-key <FUNDED_TESTNET_PRIVATE_KEY> \
  --mina-node-url http://127.0.0.1:3001/graphql \
  --archive-node-url http://127.0.0.1:8282 \
  --compose-mina-node-upstream http://host.docker.internal:3001 \
  --compose-archive-node-url http://host.docker.internal:8282 \
  --next-public-treasury-api-url http://127.0.0.1:3100/api \
  --next-public-indexer-api-url http://127.0.0.1:3100/indexer \
  --next-public-processor-api-url http://127.0.0.1:3100/processor \
  --next-public-mina-node-url http://127.0.0.1:3100/mina/graphql
```

`--mina-node-url` and `--archive-node-url` are the host-facing URLs written to
`apps/cli/.env.testnet`. `--compose-mina-node-upstream` and
`--compose-archive-node-url` are the container-facing URLs used by Caddy,
API, indexer, and processor containers.

The bootstrap command also reads existing shell values when flags are omitted:

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

## 2. Bootstrap Env Files

Generate the testnet env family:

```bash
pnpm env:bootstrap testnet -- --sender-private-key <FUNDED_TESTNET_PRIVATE_KEY>
```

This writes ignored package-local files:

```text
devops/.env.testnet
apps/api/.env.testnet
apps/cli/.env.testnet
apps/web/.env.testnet
```

The bootstrap command fills local secrets, Mina role keys, database URLs, and
Compose proxy settings. On reruns it preserves generated keys and existing
browser prover values unless you explicitly request otherwise:

```bash
pnpm testnet:env
pnpm env:bootstrap testnet -- --fresh-keys
pnpm env:bootstrap testnet -- --overwrite-secrets
```

Use `--fresh-keys` only when you want new treasury owner, pause controller,
multisig, sender, and voter identities. Use `--overwrite-secrets` only when you
want new infrastructure secrets such as `POSTGRES_PASSWORD`.

## 3. Review Env Values

Check `apps/cli/.env.testnet`:

```text
MINA_NODE_URL=http://127.0.0.1:3001/graphql
ARCHIVE_NODE_URL=http://127.0.0.1:8282
SENDER_PRIVATE_KEY=<funded sender>
LIFECYCLE_PERIOD_DURATION=48
SQLITE_DATA_DIRECTORY=./.data/testnet-sqlite
```

Check `apps/api/.env.testnet`:

```text
ARCHIVE_NODE_URL=http://host.docker.internal:8282
DATABASE_URL=postgres://...
TREASURY_OWNER_CONTRACT_ADDRESS=<generated treasury owner public key>
SQLITE_DATA_DIRECTORY=/data/sqlite
```

Check `apps/web/.env.testnet`:

```text
NEXT_PUBLIC_TREASURY_API_URL=http://127.0.0.1:3100/api
NEXT_PUBLIC_INDEXER_API_URL=http://127.0.0.1:3100/indexer
NEXT_PUBLIC_PROCESSOR_API_URL=http://127.0.0.1:3100/processor
NEXT_PUBLIC_MINA_NODE_URL=http://127.0.0.1:3100/mina/graphql
NEXT_PUBLIC_NETWORK_ID=DEVNET
```

Check `devops/.env.testnet`:

```text
BIND_ADDRESS=127.0.0.1
PROXY_WEB_PORT=3100
PROXY_API_PORT=4100
PROXY_INDEXER_PORT=4101
PROXY_PROCESSOR_PORT=4102
MINA_NODE_PROXY_UPSTREAM=http://host.docker.internal:3001
SQLITE_DATA_HOST_PATH=../.data/testnet-sqlite
```

Do not commit these files or paste them into logs, screenshots, docs, or chat.

## 4. Fund The Sender

`pnpm testnet:env` prints the sender public key after writing env files. Fund
that public key with the testnet faucet or transfer testnet MINA from another
funded account. The sender pays deployment and operator transaction fees.

If deployment later fails with a balance error, verify that this sender is
funded on the same network as `MINA_NODE_URL`.

## 5. Compile Browser Prover Config

The web app needs browser-safe verification keys and empty-tree roots before it
can create, vote, tally, or execute proposals in the UI.

Run:

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- treasury-owner compile
```

Copy the emitted `browserEnv` values into `apps/web/.env.testnet`:

```text
NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION=...
NEXT_PUBLIC_VOTE_REDUCER_VERIFICATION_KEY_JSON=...
NEXT_PUBLIC_STAKING_LEDGER_TO_VOTING_LEDGER_VERIFICATION_KEY_JSON=...
NEXT_PUBLIC_TREASURY_PROPOSAL_VERIFICATION_KEY_JSON=...
NEXT_PUBLIC_EMPTY_VOTING_LEDGER_ROOT=...
NEXT_PUBLIC_EMPTY_NULLIFIER_ROOT=...
```

Future `pnpm testnet:env` runs preserve those values.

## 6. Deploy And Fund The Treasury

Deploy the pause controller and treasury owner contracts:

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- treasury-owner deploy
```

Expected output includes:

```json
{
  "pauseControllerAddress": "...",
  "treasuryOwnerAddress": "...",
  "pauseControllerTxHash": "...",
  "treasuryOwnerTxHash": "..."
}
```

Verify the deployed state:

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- treasury-owner read-state

dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- pause-controller read-state
```

Fund the treasury account:

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- treasury-owner fund-treasury \
  --amount 1000000000000
```

The generated treasury owner address is already written into
`apps/api/.env.testnet`, `apps/web/.env.testnet`, and `apps/cli/.env.testnet`.
If you manually replace the treasury owner keypair, copy the deployed address
into those files before starting Compose.

## 7. Start And Verify Compose

Start the local operator stack:

```bash
pnpm testnet:up
```

If the image is missing or code changed, rebuild and start:

```bash
pnpm testnet:up:build
```

This starts Postgres, runs API migrations, and then starts API, indexer,
processor, web, and the local Caddy reverse proxy.

Verify the stack through Caddy:

```bash
curl http://127.0.0.1:4100/healthz
curl http://127.0.0.1:4101/healthz
curl http://127.0.0.1:4101/status
curl http://127.0.0.1:4102/healthz
curl http://127.0.0.1:4102/status
```

Open the UI:

```text
http://127.0.0.1:3100
```

Follow logs:

```bash
pnpm testnet:logs
```

Render the Compose config:

```bash
pnpm testnet:config
```

Only local Caddy proxy ports are published on the host. App, API, and Postgres
ports stay private to the Docker network.

## 8. Optional Public HTTPS

For public HTTPS, set public proxy values in `devops/.env.testnet`:

```env
LETSENCRYPT_EMAIL=ops@example.com
PUBLIC_WEB_DOMAIN=treasury.example.com
PUBLIC_API_DOMAIN=api.treasury.example.com
PUBLIC_INDEXER_DOMAIN=indexer.treasury.example.com
PUBLIC_PROCESSOR_DOMAIN=processor.treasury.example.com
```

Set browser/API values in `apps/web/.env.testnet` and `apps/api/.env.testnet`.
The web app can stay same-origin through the public web domain:

```env
NEXT_PUBLIC_TREASURY_API_URL=https://treasury.example.com/api
NEXT_PUBLIC_INDEXER_API_URL=https://treasury.example.com/indexer
NEXT_PUBLIC_PROCESSOR_API_URL=https://treasury.example.com/processor
NEXT_PUBLIC_MINA_NODE_URL=https://treasury.example.com/mina/graphql
CORS_ALLOWED_ORIGINS=https://treasury.example.com
```

Point DNS for each hostname at the operator host and make ports `80` and `443`
reachable.

For a certificate dry run:

```env
LETSENCRYPT_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory
```

Start the public proxy profile:

```bash
pnpm testnet:up:public
```

Remove the staging CA value before a real deployment so Caddy requests
production Let's Encrypt certificates.

## 9. Stop Or Reset

Stop while preserving data:

```bash
pnpm testnet:down
```

Reset Compose volumes:

```bash
pnpm testnet:reset
```

## Proposal Operations

The stack can now serve the UI and API. Proposal lifecycle operations require
additional lifecycle SQLite data and proofs before tallying votes. Use this
section after the stack is healthy.

### Create A Proposal

Generate a proposal keypair:

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- generate-keypair --json
```

Create proposal content:

```bash
mkdir -p .data/testnet

cat > .data/testnet/proposal.md <<'EOF'
# Testnet proposal

Transfer 100 MINA from the treasury to the recipient.
EOF
```

Submit the proposal during the proposal creation period:

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- proposal create \
  --proposal-private-key <PROPOSAL_PRIVATE_KEY> \
  --proposal-lifecycle-id 0 \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --amount 100000000000 \
  --content-file .data/testnet/proposal.md
```

Keep the proposal public key from the output.

### Vote

For a public testnet, wait until the chain reaches the voting period for the
proposal lifecycle. For local dry runs with the local blockchain, use the admin
UI to advance slots.

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- proposal vote \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --voter-private-key <VOTER_PRIVATE_KEY> \
  --vote yay
```

Repeat with `yay`, `nay`, or `abstain` for each voter you want in the test.

### Pause Or Unpause A Proposal

Generate multisig signatures for at least three multisig participants:

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- multisig-sign toggle-pause-proposal \
  --multisig-signer-private-key <SIGNER_PRIVATE_KEY> \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --nonce <PAUSE_CONTROLLER_NONCE>
```

Submit signatures in participant order:

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- pause-controller toggle-pause-proposal \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --multisig-signatures <SIG1>,<SIG2>,<SIG3>,<SIG4>,<SIG5>
```

Empty positional slots are allowed with consecutive commas.

## Lifecycle Data And Proofs

Tallying votes requires two proofs:

- exhausted staking-ledger-to-voting-ledger proof
- merged vote-reducer proof

The CLI and Compose stack are each configured with their own
`SQLITE_DATA_DIRECTORY` / `SQLITE_DATA_HOST_PATH`. By default the testnet
family uses:

```text
CLI (apps/cli/.env.testnet):  ./.data/testnet-sqlite (relative to apps/cli)
Compose (devops/.env.testnet): SQLITE_DATA_HOST_PATH, mounted at /data/sqlite
  - on this host: /opt/mina/.treasury-sqlite
```

These are two different directories unless you explicitly point the CLI at
the Compose path (e.g. `SQLITE_DATA_DIRECTORY="$SQLITE_DATA_HOST_PATH" pnpm run cli -- ...`,
as `devops/TESTNET_MINA_NODE.md` does) — keep this in mind when running CLI
commands manually against lifecycle data the Compose stack (including
`voting-ledger-scheduler`) already produced, or vice versa.

When `SQLITE_DATA_HOST_PATH` doesn't exist yet, run
`node devops/scripts/ensure-sqlite-data-dir.mjs devops/.env.testnet` first (the
`testnet:up*` scripts already do this) — Compose containers run as a non-root
user and can't write into a directory Docker would otherwise auto-create as
root.

### Build Staking-Ledger-To-Voting-Ledger Data

The Compose stack runs a `voting-ledger-scheduler` service that automates this.
It watches `STAKING_LEDGERS_HOST_PATH` (default
`/opt/mina/.mina-network/staking_ledgers`, populated on the host by the Mina
daemon or `monitor-staking-ledger.sh` as `<epoch>-<hash>.tar.gz` files) and, for
every epoch that starts a new treasury lifecycle
(`epoch == deployedEpoch + 4 * lifecycleId`, given `TREASURY_DEPLOYED_AT_SLOT`
and `LIFECYCLE_PERIOD_DURATION`), automatically:

1. hydrates that lifecycle's staking-ledger SQLite (`staking-ledger from-file`),
2. verifies the resulting root hash against the hash embedded in the archive's
   filename (the same `mina ledger hash` value the chain would serve over
   GraphQL as `stakingEpochData.ledger.hash`),
3. runs `staking-ledger-to-voting-ledger trace-digest` (circuit `compile` runs
   once at service startup, not per lifecycle),
4. and writes `<lifecycleId>.sqlite.done` as a completion marker.

Check `docker compose ... logs -f voting-ledger-scheduler` to follow progress,
and `<SQLITE_DATA_HOST_PATH>/<lifecycleId>.sqlite.done` to confirm a given
lifecycle is ready. A hash mismatch is logged as an error and that lifecycle is
left unprocessed (retried every cycle) rather than silently accepted.

The container runs as the non-root `node` user (uid 1000) for hardening. If
`SQLITE_DATA_HOST_PATH` doesn't exist yet, Docker creates it as `root` on first
use, which the `voting-ledger-scheduler` (and `api-migrate`) container can't
write into — this fails as `SQLITE_CANTOPEN: unable to open database file`.
Fix by matching the host directory's owner to uid 1000:

```bash
mkdir -p "$SQLITE_DATA_HOST_PATH"
chown -R 1000:1000 "$SQLITE_DATA_HOST_PATH"
```

The steps below remain useful for one-off runs, debugging a specific lifecycle,
or networks where nothing populates `STAKING_LEDGERS_HOST_PATH` automatically
(for example `local-blockchain`). Use a staking ledger JSON for the target
lifecycle and network. For a local Mina node, `devops/TESTNET_MINA_NODE.md` is
the source of truth for ledger export.

Populate lifecycle SQLite:

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- staking-ledger from-file \
  --lifecycle-id 0 \
  --staking-ledger-path <STAKING_LEDGER_JSON_PATH>
```

Compile and trace:

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- staking-ledger-to-voting-ledger compile

dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- staking-ledger-to-voting-ledger trace-digest \
  --lifecycle-id 0
```

Start Redis and a worker:

```bash
docker run --rm -p 6379:6379 redis:7-alpine

dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- worker start \
  --queue-name staking-ledger-to-voting-ledger-0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379
```

Prove, merge, and exhaust:

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- staking-ledger-to-voting-ledger prove-digest \
  --lifecycle-id 0 \
  --queue-name staking-ledger-to-voting-ledger-0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379

dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- staking-ledger-to-voting-ledger prove-merge \
  --lifecycle-id 0 \
  --queue-name staking-ledger-to-voting-ledger-0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379 \
  --proof-output-path .data/testnet/staking-ledger-merge.json

dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- staking-ledger-to-voting-ledger prove-exhaust \
  --lifecycle-id 0 \
  --proof-output-path .data/testnet/staking-ledger-exhausted.json
```

### Build Vote-Reducer Proof

Fetch vote actions from the archive:

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- proposal fetch-actions \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --output-path .data/testnet/vote-actions.json
```

Compile and trace:

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- vote-reducer compile

dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- vote-reducer trace-run-batch \
  --lifecycle-id 0 \
  --vote-actions-path .data/testnet/vote-actions.json
```

Start a vote-reducer worker:

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- worker start \
  --queue-name vote-reducer-0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379
```

Prove and merge:

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- vote-reducer prove-run-batch \
  --lifecycle-id 0 \
  --queue-name vote-reducer-0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379

dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- vote-reducer prove-merge \
  --lifecycle-id 0 \
  --queue-name vote-reducer-0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379 \
  --proof-output-path .data/testnet/vote-reducer-merge.json
```

### Submit The Tally

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- proposal tally-votes \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --vote-reducer-proof-path .data/testnet/vote-reducer-merge.json \
  --staking-ledger-to-voting-ledger-proof-path .data/testnet/staking-ledger-exhausted.json \
  --lifecycle-id 0
```

The staking-ledger-to-voting-ledger proof must match the lifecycle and voting
ledger used by the proposal. Regenerate it if you change the staking ledger
input.

### Execute The Proposal

Wait until the proposal is executable, then run:

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- proposal execute \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY>
```

## Troubleshooting

- If deployment fails with a balance error, confirm the sender public key printed
  by `pnpm testnet:env` is funded on the same network as `MINA_NODE_URL`.
- If deployment succeeds but the stack shows no treasury data, confirm
  `ARCHIVE_NODE_URL` points at an archive for the same network and has indexed
  the deployment blocks.
- If the web app loads but wallet or node calls fail, check
  `NEXT_PUBLIC_MINA_NODE_URL`; it must be reachable from the browser.
- If API lifecycle endpoints return `404`, check that
  `.data/testnet-sqlite/<lifecycleId>.sqlite` exists on the host.
- If you rotate keys after deploying, redeploy before starting Compose, or copy
  the already-deployed treasury owner address into `apps/api/.env.testnet`,
  `apps/web/.env.testnet`, and `apps/cli/.env.testnet`.
