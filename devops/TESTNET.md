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
- an archive GraphQL endpoint reachable from Compose containers
- a funded sender private key for testnet fees

For a local Mina node using the companion runbook, the defaults are:

```text
MINA_NODE_URL=http://127.0.0.1:3001/graphql
ARCHIVE_NODE_URL=http://127.0.0.1:3086/graphql
NEXT_PUBLIC_MINA_NODE_URL=/mina/graphql
MINA_NODE_PROXY_UPSTREAM=http://host.docker.internal:3001
Compose ARCHIVE_NODE_URL=http://host.docker.internal:3086/graphql
```

For hosted infrastructure, edit the generated env files after bootstrap so the
CLI, API, and browser all point at the same network.

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
ARCHIVE_NODE_URL=http://127.0.0.1:3086/graphql
SENDER_PRIVATE_KEY=<funded sender>
LIFECYCLE_PERIOD_DURATION=48
SQLITE_DATA_DIRECTORY=./.data/testnet-sqlite
```

Check `apps/api/.env.testnet`:

```text
ARCHIVE_NODE_URL=http://host.docker.internal:3086/graphql
DATABASE_URL=postgres://...
TREASURY_OWNER_CONTRACT_ADDRESS=<generated treasury owner public key>
SQLITE_DATA_DIRECTORY=/data/sqlite
```

Check `apps/web/.env.testnet`:

```text
NEXT_PUBLIC_TREASURY_API_URL=/api
NEXT_PUBLIC_INDEXER_API_URL=/indexer
NEXT_PUBLIC_PROCESSOR_API_URL=/processor
NEXT_PUBLIC_MINA_NODE_URL=/mina/graphql
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

For private local demos only, the browser prover can also use inline signing
keys:

```text
NEXT_PUBLIC_INLINE_SIGNER_PRIVATE_KEYS_JSON=["<voter-or-operator-private-key>"]
```

This value is exposed to the browser. Do not use real funded keys here on a
public deployment.

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
NEXT_PUBLIC_TREASURY_API_URL=/api
NEXT_PUBLIC_INDEXER_API_URL=/indexer
NEXT_PUBLIC_PROCESSOR_API_URL=/processor
NEXT_PUBLIC_MINA_NODE_URL=/mina/graphql
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

The CLI and Compose stack share lifecycle SQLite data. By default the testnet
family uses:

```text
CLI:     ./.data/testnet-sqlite
Compose: ../.data/testnet-sqlite mounted at /data/sqlite
```

### Build Staking-Ledger-To-Voting-Ledger Data

Use a staking ledger JSON for the target lifecycle and network. For a local Mina
node, `devops/TESTNET_MINA_NODE.md` is the source of truth for ledger export.

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
