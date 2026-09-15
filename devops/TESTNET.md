# Compose Live-Testnet Operator Runbook

Use this guide for a long-running cloud host connected to a live Mina testnet
and matching Archive service. This is the Compose operator path.

The o1js simulator, Mina-repository single-node network, and Docker Lightnet
are development paths. Use `apps/docs/docs/developer/local-development/` for
those procedures. Use `devops/runbooks/README.md` for Kubernetes infrastructure.

## What This Runbook Starts

The Compose stack starts the treasury app services only:

- web UI
- Backoffice UI
- app API
- indexer API
- processor API
- indexer runtime
- processor runtime
- voting-ledger scheduler
- Postgres
- Caddy reverse proxy

It does not start a Mina node, Archive node, or staking-ledger exporter. The
optional `proving` profile adds Redis, proof workers, and the proving scheduler.

## Happy Path

This is the shortest path to a running live-testnet application stack:

```bash
node --version # Must be 22.19.5 or later.
pnpm --version # Must be 9.0.0.
CI=true pnpm install --frozen-lockfile
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
# Review apps/api/.env.testnet, apps/backoffice/.env.testnet, apps/cli/.env.testnet, and apps/web/.env.testnet.
dotenvx run -f apps/cli/.env.testnet -- pnpm run cli -- treasury-owner compile
# Copy emitted browserEnv values into apps/web/.env.testnet and apps/backoffice/.env.testnet.
dotenvx run -f apps/cli/.env.testnet -- pnpm run cli -- treasury-owner deploy
dotenvx run -f apps/cli/.env.testnet -- pnpm run cli -- treasury-owner fund-treasury --amount 1000000000000
pnpm testnet:up:build
curl http://127.0.0.1:4100/healthz
# Visit the configured user web origin. Keep Backoffice on loopback.
```

If the funded sender key is already present in `apps/cli/.env.testnet`, rerun
`pnpm testnet:env` instead of passing `--sender-private-key`.

## 1. Prepare External Testnet Services

The Compose stack consumes live Mina and Archive endpoints. Use an approved
managed provider or self-operated live-testnet services. The Kubernetes
network procedures are:

- `devops/runbooks/1-Network/1a-Archive-Node/README.md`
- `devops/runbooks/1-Network/1b-Mina-Daemon/README.md`
- `devops/runbooks/1-Network/1c-Staking-Ledger-Provider/README.md`

Before bootstrapping, make sure you have:

- a browser-reachable Mina GraphQL endpoint
- a host-reachable Mina GraphQL endpoint for CLI/operator commands
- an archive GraphQL endpoint reachable from Compose containers
- a host-reachable archive GraphQL endpoint for CLI/operator commands
- a funded sender private key for testnet fees

Do not rely on the bootstrap localhost defaults for a cloud deployment. Pass
the live endpoints to bootstrap instead of editing generated files by hand:

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

`--mina-node-url` and `--archive-node-url` are the host-facing URLs written to
`apps/cli/.env.testnet`. `--compose-mina-node-upstream` and
`--compose-archive-node-url` are the container-facing URLs used by Caddy,
API, indexer, and processor containers.

The bootstrap command also reads existing shell values when flags are omitted:

```bash
export MINA_NODE_URL=<HOST_MINA_GRAPHQL_URL>
export ARCHIVE_NODE_URL=<HOST_ARCHIVE_GRAPHQL_URL>
export MINA_NODE_PROXY_UPSTREAM=<CONTAINER_MINA_UPSTREAM>
export COMPOSE_ARCHIVE_NODE_URL=<CONTAINER_ARCHIVE_GRAPHQL_URL>
export NEXT_PUBLIC_TREASURY_API_URL=<PUBLIC_WEB_ORIGIN>/api
export NEXT_PUBLIC_INDEXER_API_URL=<PUBLIC_WEB_ORIGIN>/indexer
export NEXT_PUBLIC_PROCESSOR_API_URL=<PUBLIC_WEB_ORIGIN>/processor
export NEXT_PUBLIC_MINA_NODE_URL=<PUBLIC_WEB_ORIGIN>/mina/graphql
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
apps/backoffice/.env.testnet
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

The testnet templates use `devnet` signatures and enable proofs by default.
Use `--network-id` and `--proofs-enabled` when the target requires other
values. The generator applies each override to all generated consumers.

## 3. Review Env Values

Check `apps/cli/.env.testnet`:

```text
MINA_NODE_URL=<HOST_MINA_GRAPHQL_URL>
ARCHIVE_NODE_URL=<HOST_ARCHIVE_GRAPHQL_URL>
MINA_NETWORK_ID=<SIGNATURE_NETWORK_ID>
SENDER_PRIVATE_KEY=<funded sender>
LIFECYCLE_PERIOD_DURATION=7140
SQLITE_DATA_DIRECTORY=./.data/testnet-sqlite
```

Check `apps/api/.env.testnet`:

```text
ARCHIVE_NODE_URL=<CONTAINER_ARCHIVE_GRAPHQL_URL>
DATABASE_URL=postgres://...
TREASURY_OWNER_CONTRACT_ADDRESS=<generated treasury owner public key>
SQLITE_DATA_DIRECTORY=/data/sqlite
```

Check `apps/web/.env.testnet`:

```text
NEXT_PUBLIC_TREASURY_API_URL=<PUBLIC_WEB_ORIGIN>/api
NEXT_PUBLIC_INDEXER_API_URL=<PUBLIC_WEB_ORIGIN>/indexer
NEXT_PUBLIC_PROCESSOR_API_URL=<PUBLIC_WEB_ORIGIN>/processor
NEXT_PUBLIC_MINA_NODE_URL=<PUBLIC_WEB_ORIGIN>/mina/graphql
NEXT_PUBLIC_NETWORK_ID=DEVNET
```

Check `apps/backoffice/.env.testnet`:

```text
NEXT_PUBLIC_MINA_NODE_URL=http://127.0.0.1:3200/mina/graphql
NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS=<generated treasury owner public key>
NEXT_PUBLIC_MULTISIG_PARTICIPANTS_PUBLIC_KEYS=<five ordered public keys>
NEXT_PUBLIC_NETWORK_ID=DEVNET
```

Check `devops/.env.testnet`:

```text
BIND_ADDRESS=127.0.0.1
PROXY_WEB_PORT=3100
PROXY_API_PORT=4100
PROXY_INDEXER_PORT=4101
PROXY_PROCESSOR_PORT=4102
MINA_NODE_PROXY_UPSTREAM=<CONTAINER_MINA_UPSTREAM>
SQLITE_DATA_HOST_PATH=/opt/mina/.treasury-sqlite
STAKING_LEDGERS_HOST_PATH=/opt/mina/.treasury-staking-ledgers
```

Keep `NEXT_PUBLIC_NETWORK_ID` paired with the Mina endpoint. It selects the
transaction and Ledger signing domain. It is not only a display label.

Do not commit these files or paste them into logs, screenshots, docs, or chat.

## 4. Fund The Sender

`pnpm testnet:env` prints the sender public key after writing env files. Fund
that public key with the testnet faucet or transfer testnet MINA from another
funded account. The sender pays deployment and operator transaction fees.

If deployment later fails with a balance error, verify that this sender is
funded on the same network as `MINA_NODE_URL`.

## 5. Compile Browser Prover Config

The web app needs browser-safe verification keys and empty-tree roots before it
can create, vote, or execute proposals in the UI. Tally is a CLI operation.

Run:

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- treasury-owner compile
```

Copy the emitted `browserEnv` values into `apps/web/.env.testnet` and
`apps/backoffice/.env.testnet`:

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

The generated treasury owner address is already in the API, Backoffice, CLI,
and web environment files. If you replace the Treasury Owner keypair, copy the
deployed address into all four files before you start Compose.

## 7. Start And Verify Compose

Start the long-running application stack:

```bash
pnpm testnet:up
```

If the image is missing or code changed, rebuild and start:

```bash
pnpm testnet:up:build
```

This starts Postgres and runs API migrations. It then starts the APIs, indexer,
processor, scheduler, web, Backoffice, and the local Caddy reverse proxy.

Verify the stack through Caddy:

```bash
curl http://127.0.0.1:4100/healthz
curl http://127.0.0.1:4101/healthz
curl http://127.0.0.1:4101/status
curl http://127.0.0.1:4102/healthz
curl http://127.0.0.1:4102/status
```

Open the loopback UIs on the operator host:

```text
http://127.0.0.1:3100
http://127.0.0.1:3200
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

This command also selects the local proxy profile. The public HTTPS proxy does
not expose Backoffice. The local proxy keeps Backoffice on the host loopback
address. From an operator workstation, create an SSH tunnel:

```bash
ssh -N -L 3200:127.0.0.1:3200 <OPERATOR_HOST>
```

Open `http://127.0.0.1:3200` on that workstation. This secure loopback context
supports Ledger WebHID in a compatible Chromium browser.

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

Create proposal content:

```bash
mkdir -p .data/testnet

cat > .data/testnet/proposal.md <<'EOF'
# Testnet proposal

Transfer 100 MINA from the treasury to the recipient.
EOF
```

Validate the exact Markdown before you create its on-chain commitment:

```bash
jq -Rs '{contents:.}' .data/testnet/proposal.md \
  | curl --fail-with-body -sS -X POST \
      http://127.0.0.1:4100/proposals/content/verify \
      -H 'content-type: application/json' \
      --data-binary @- \
  | jq -e '.ok == true and .passesSubmissionChecks == true'
```

Continue only when the final command prints `true` and exits successfully.

Submit the proposal during the proposal creation period:

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- proposal create \
  --proposal-lifecycle-id 0 \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --amount 100000000000 \
  --content-file .data/testnet/proposal.md
```

You can supply `--proposal-private-key` for a predetermined address. If it is
absent, the CLI generates the Proposal keypair in memory and discards the key
after deployment. It prints a warning because Proposal permissions make this
private key unusable after deployment. Keep `proposalAddress` from the output
for later operations.

After inclusion, the CLI submits the exact Markdown to the App API. It retries
HTTP `503` and the specific missing-projection HTTP `404` for up to 60 seconds.
It does not retry network failures or other HTTP responses.

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

Submit at least five included vote actions during the Voting period. Tally
needs five distinct non-initial action-state targets. Use five eligible voter
keys in an acceptance run so each first vote can add weight. Later actions from
one voter do not add more weight.

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

The `multisig-sign --nonce` value is the Pause Controller action nonce. Do not
copy this value to the state-changing submit command. The current submit option
also sets the fee-payer transaction nonce.

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

The Compose stack runs `voting-ledger-scheduler`. It is a shell poll loop around
the repository CLI. It does not export a ledger or calculate a Mina epoch.

An external snapshot producer must populate `STAKING_LEDGERS_HOST_PATH` with
this exact content-addressed input:

```text
<ledgerHash>.json
lifecycle-<lifecycleId>.hash
```

The pointer file contains one Base58 ledger hash. Publish the verified JSON
payload before the pointer. Use an atomic final move for both files.

After the scheduler writes `<lifecycleId>.sqlite.done`, treat that lifecycle
pointer as immutable. A changed pointer is reported and skipped. Use the
stopped one-shot rebuild below for an approved correction.

For a self-operated Mina node, export the current staking epoch ledger on the
node:

```bash
mina ledger export staking-epoch-ledger \
  --daemon-port <MINA_CLIENT_PORT> > <STAGING_LEDGER_JSON>
```

For a managed node, obtain the same Mina-format JSON from the approved snapshot
provider. Query `stakingEpochData.ledger.hash` from Mina and verify the file:

```bash
mkdir -p <LEDGER_VALIDATION_DIRECTORY>

dotenvx run -f apps/cli/.env.testnet -- \
  env SQLITE_DATA_DIRECTORY=<LEDGER_VALIDATION_DIRECTORY> \
  pnpm run cli -- staking-ledger from-file \
  --lifecycle-id <VALIDATION_ID> \
  --staking-ledger-path <STAGING_LEDGER_JSON>

dotenvx run -f apps/cli/.env.testnet -- \
  env SQLITE_DATA_DIRECTORY=<LEDGER_VALIDATION_DIRECTORY> \
  pnpm run cli -- staking-ledger get-root-hash \
  --lifecycle-id <VALIDATION_ID> \
  --expected-root-hash <LEDGER_HASH> \
  --output-format json
```

Publish the validated input:

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

Do not change a published pointer while its lifecycle is processing. The
scheduler fails the current run if it detects a change before completion.

Every `VOTING_LEDGER_SCHEDULER_POLL_INTERVAL_SECONDS`, the scheduler processes
all eligible lifecycle pointers from newest to oldest. For each lifecycle, it:

1. validates the lifecycle ID and pointer hash;
2. requires the matching `<ledgerHash>.json` payload;
3. restores a matching checkpoint, or clears partial lifecycle SQLite state;
4. imports the JSON when it did not restore a checkpoint;
5. verifies the calculated root against the pointer hash;
6. runs `staking-ledger-to-voting-ledger trace-digest`;
7. writes `<lifecycleId>.sqlite.done`.

A failed lifecycle gets exponential retry backoff. Other eligible lifecycles
can still run in the same poll. The scheduler mounts snapshot input read-only.
Replace an invalid host payload before retrying.

Use a stopped one-shot process when one lifecycle must run by itself. Use this
short procedure only before that lifecycle has proof files or a `.sqlite.proven`
marker. Use the complete [Rebuild One Lifecycle](../apps/docs/docs/operate/proving/ledgers-and-proving.md#rebuild-one-lifecycle)
procedure for a completed or proved lifecycle.

Stop both schedulers, the API, and the processor before the one-shot process:

```bash
docker compose \
  --env-file devops/.env.testnet \
  --env-file apps/api/.env.testnet \
  --env-file apps/backoffice/.env.testnet \
  --env-file apps/web/.env.testnet \
  -f devops/compose.yml \
  --profile proxy \
  --profile proving \
  stop voting-ledger-scheduler proving-scheduler api processor

docker compose \
  --env-file devops/.env.testnet \
  --env-file apps/api/.env.testnet \
  --env-file apps/backoffice/.env.testnet \
  --env-file apps/web/.env.testnet \
  -f devops/compose.yml \
  --profile proxy \
  --profile proving \
  run --rm --no-deps \
  -e CHECKPOINT_S3_URI= \
  -e CHECKPOINT_INTERVAL= \
  voting-ledger-scheduler \
  /bin/sh \
  devops/docker/voting-ledger-scheduler-entrypoint.sh \
  process-lifecycle 17
```

The blank checkpoint values force this one-shot command to rebuild from the
verified payload. Without these overrides, a matching checkpoint can resume
the trace instead.

Check `<SQLITE_DATA_HOST_PATH>/17.sqlite.done`. Keep the four services stopped
when the one-shot process fails. After successful verification, start them:

```bash
docker compose \
  --env-file devops/.env.testnet \
  --env-file apps/api/.env.testnet \
  --env-file apps/backoffice/.env.testnet \
  --env-file apps/web/.env.testnet \
  -f devops/compose.yml \
  --profile proxy \
  start api processor voting-ledger-scheduler
```

Leave `proving-scheduler` stopped. Start the proving profile through the
Automated Proving procedure after the trace is valid.

Check `docker compose ... logs -f voting-ledger-scheduler` to follow progress,
and `<SQLITE_DATA_HOST_PATH>/<lifecycleId>.sqlite.done` to confirm a given
lifecycle is ready. A hash mismatch or crash is logged with its exit status
(the poll loop captures the CLI subprocess's real exit code, including
128+signal for a signal kill). The lifecycle remains selectable after its retry
backoff.

The container runs as the non-root `node` user (uid 1000) for hardening. If
`SQLITE_DATA_HOST_PATH` doesn't exist yet, Docker creates it as `root` on first
use, which the `voting-ledger-scheduler` (and `api-migrate`) container can't
write into — this fails as `SQLITE_CANTOPEN: unable to open database file`.
Fix by matching the host directory's owner to uid 1000:

```bash
mkdir -p "$SQLITE_DATA_HOST_PATH"
chown -R 1000:1000 "$SQLITE_DATA_HOST_PATH"
```

### Automated Proving (`proving` Profile)

Tracing alone is not sufficient to tally votes. Each lifecycle also needs an
_exhausted_ proof, which means running the actual SNARK circuit
(`prove-digest` → `prove-merge` → `prove-exhaust`) against Redis and one or
more BullMQ workers. The profile is opt-in because it starts Redis and adds
real compute cost. The generated testnet family sets `PROOFS_ENABLED=true` by
default. Confirm this value in `apps/api/.env.testnet`. The later env file wins
when the same field occurs in more than one file. Then bring the stack up with
`pnpm testnet:up:proving` (or add
`--profile proving` to `docker compose ... up` yourself) instead of the plain
`pnpm testnet:up`.

With the profile enabled, Compose additionally runs:

- `redis` — a private `redis:7-alpine` instance, not published on the host.
- `proving-worker` — `PROVING_WORKER_REPLICAS` (default 3) replicas of
  `worker start`, all bound to the same fixed queue name
  (`PROVING_QUEUE_NAME`, default `staking-ledger-to-voting-ledger`). This
  replica count is the "cluster": BullMQ hands queued proving jobs to
  whichever replicas are connected. A single queue name is safe to reuse
  across every lifecycle because `prove-digest` obliterates the queue before
  enqueueing a lifecycle's jobs and blocks until they finish, so lifecycles
  are always proved one at a time regardless of replica count.
- `proving-scheduler` — another plain bash poll loop
  (`devops/docker/proving-scheduler-entrypoint.sh`), analogous to
  `voting-ledger-scheduler` but for proving instead of tracing. Every
  `PROVING_SCHEDULER_POLL_INTERVAL_SECONDS` (default 30s) it scans for the
  **oldest** lifecycle with a `<lifecycleId>.sqlite.done` marker (written by
  `voting-ledger-scheduler`) that doesn't yet have a matching
  `<lifecycleId>.sqlite.proven` marker, and runs `prove-digest`, `prove-merge`,
  and `prove-exhaust` for it, writing the merged and exhausted proof JSON to
  `PROVING_OUTPUT_DIRECTORY` (default `<SQLITE_DATA_DIRECTORY>/proofs`).
  The voting-ledger scheduler works its full pending backlog newest-first.
  The proving scheduler works its full proof backlog oldest-first. It cannot
  skip an older lifecycle because that lifecycle would remain untallyable.

Check `docker compose ... logs -f proving-scheduler` to follow progress, and
`<SQLITE_DATA_HOST_PATH>/proofs/<lifecycleId>-exhausted.json` /
`<SQLITE_DATA_HOST_PATH>/<lifecycleId>.sqlite.proven` to confirm a given
lifecycle is proved. As with `voting-ledger-scheduler`, a failure is logged
and the lifecycle is retried on the next poll cycle rather than skipped.

Keep Redis and the proof workers active. Stop the scheduler before a one-shot
proof process:

```bash
docker compose \
  --env-file devops/.env.testnet \
  --env-file apps/api/.env.testnet \
  --env-file apps/backoffice/.env.testnet \
  --env-file apps/web/.env.testnet \
  -f devops/compose.yml \
  --profile proving \
  stop proving-scheduler

docker compose \
  --env-file devops/.env.testnet \
  --env-file apps/api/.env.testnet \
  --env-file apps/backoffice/.env.testnet \
  --env-file apps/web/.env.testnet \
  -f devops/compose.yml \
  --profile proving \
  run --rm --no-deps proving-scheduler \
  /bin/sh \
  devops/docker/proving-scheduler-entrypoint.sh \
  process-lifecycle 17
```

Confirm the exhausted proof and `17.sqlite.proven`. Keep the scheduler stopped
when the one-shot process fails. After successful verification, start it:

```bash
docker compose \
  --env-file devops/.env.testnet \
  --env-file apps/api/.env.testnet \
  --env-file apps/backoffice/.env.testnet \
  --env-file apps/web/.env.testnet \
  -f devops/compose.yml \
  --profile proving \
  start proving-scheduler
```

The Compose fallback is `PROOFS_ENABLED=false`, but the generated testnet
family selects `true`. The scheduler exits before proving or marker creation
unless the resolved value is exactly `true`. Generate the family with
`--proofs-enabled false` when you want a proof-disabled deployment.

The steps below remain useful for one-off runs, debugging a lifecycle, or a
deployment without an external snapshot producer. They also apply when the
`proving` profile is not enabled. Use a staking ledger JSON for the exact
target lifecycle and network.

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
  `apps/backoffice/.env.testnet`, `apps/web/.env.testnet`, and
  `apps/cli/.env.testnet`.
