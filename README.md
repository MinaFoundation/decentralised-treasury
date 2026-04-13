# Mina Decentralized Treasury Monorepo

This repository contains the SDK, CLI, indexer, processor, and app surfaces for
the Mina decentralized treasury project.

## Repository Layout

### Apps

- `apps/cli`: operational CLI (`mina-treasury`)
- `apps/api`: indexer + processor runtimt wiring and e2e tests
- `apps/web`: web app
- `apps/docs`: docs app

### Packages

- `packages/sdk`: provable contracts, services, workers, and shared treasury logic
- `packages/indexer`: archive ingestion + indexed-events API server
- `packages/processor`: event processor + projection CRUD API server
- `packages/ui`: shared React UI components
- `packages/eslint-config`: shared ESLint config
- `packages/typescript-config`: shared TypeScript config

For package-specific details:

- `apps/cli/README.md`
- `apps/api/README.md`
- `packages/sdk/README.md`
- `packages/indexer/README.md`
- `packages/processor/README.md`

## Setup

This repo pins Node via `.nvmrc` and uses pnpm workspaces.

1. Install/use the pinned Node version:

```bash
nvm install
nvm use
```

1. Ensure Corepack is enabled (if needed):

```bash
corepack enable
```

1. Install dependencies:

```bash
pnpm install
```

### o1js Fork

The workspace uses an `o1js` fork from GitHub:

- `git+https://github.com/maht0rz/o1js.git#feature/mesa-support`

This is referenced by `apps/cli`, `apps/api`, and `packages/sdk`.

## Common Workspace Commands

From repo root:

```bash
pnpm check-types
pnpm build
pnpm lint
```

## Dev workflow

### Start the local blockchain

```
dotenvx run -f packages/local-blockchain/.env.dev -- pnpm run --dir packages/local-blockchain dev
```

### Set staking ledger total currency & hash in local blockchain

Navigate to `http://127.0.0.1:8080/admin` and set total currency to `3117000000000` and hash to `17443396010975171396732854383516597977946407782519893753313158508372652393077` (matches cli's dev ledger.json and exhausted proof's inputs)

### Start the Indexer, Processor and API

```
docker run --name treasury-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=treasury_api \
  -p 5432:5432 \
  -d postgres:16

dotenvx run -f apps/api/.env.dev -- pnpm run --dir apps/api migration:run

dotenvx run -f apps/cli/.env.dev -f apps/api/.env.dev -- pnpm run --dir apps/api dev
```

### Deploy treasury

First you have to update `SENDER_PRIVATE_KEY` to be a key from local-blockchain's admin UI. If you are using lightnet, it must be an account acquired from lightnet.

```
dotenvx run -f apps/cli/.env.dev -- pnpm run --dir apps/cli dev treasury-owner deploy
```

(Optional, only run when you want to change the voter or treasury addresses) Once the treasury is deployed, prepare the voting ledger by running:

```
dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev staking-ledger from-file \
  --lifecycle-id 0 \
  --staking-ledger-path .data/dev/ledger.json

docker run --rm -p 6379:6379 redis:7-alpine

dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev staking-ledger-to-voting-ledger compile

dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev staking-ledger-to-voting-ledger trace-digest \
  --lifecycle-id 0

# separate terminal
dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev worker start \
  --redis-host 127.0.0.1 \
  --redis-port 6379

dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev staking-ledger-to-voting-ledger prove-digest \
  --lifecycle-id 0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379

dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev staking-ledger-to-voting-ledger prove-merge \
  --lifecycle-id 0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379 \
  --proof-output-path .data/dev/staking-ledger-merge.json

dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev staking-ledger-to-voting-ledger prove-exhaust \
  --lifecycle-id 0 \
  --proof-output-path .data/dev/staking-ledger-exhausted.json
```

### Start UI

```
dotenvx run -f apps/cli/.env.dev -f apps/api/.env.dev -f apps/web/.env.dev -- pnpm run --dir apps/web dev
```

### (Optional) Create first proposal via CLI

Recipient:
Private Key: `EKEWQu2bDFHko48avWdcvrqiJNhbRrGdpgasaoS7qNL6nUNbgJUp`
Public Key: `B62qjDMBRu4Hb3sqmtNNKwNyFG7GBSP3MCA5tf1roHsDT5WYGiWeexz`

Proposal:
Private Key: `EKE5XCnVPvegLdczk632ixEaFp69sFk4ivdee79UTDYyrLppX2KL`
Public Key: `B62qrxVCjqUBnuWRv7n9y498cbNjc9AwrQEaTKfvg5B8X8CvGzsaYX3`

```
dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev proposal create \
  --proposal-private-key EKE5XCnVPvegLdczk632ixEaFp69sFk4ivdee79UTDYyrLppX2KL \
  --proposal-lifecycle-id 0 \
  --recipient-public-key B62qrxVCjqUBnuWRv7n9y498cbNjc9AwrQEaTKfvg5B8X8CvGzsaYX3 \
  --amount 1000000000 \
  --content-file ./../../DEMO_PROPOSAL.md
```

### Transfer funds to an account, before using it for e.g. voting

```
dotenvx run -f apps/cli/.env.dev -- \
  pnpm --dir apps/cli run dev transfer \
    --recipient-public-key B62qo1vFp5EpvBZifAvsJWwpB17obrvGSJadE2rwwLqr5R8VAw7b64R \
    --amount 100000000000
```

### Fund the treasury

```
dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev treasury-owner fund-treasury \
  --amount 100000000000
```

### Tally votes

```
dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev proposal fetch-actions \
  --archive-node-url http://127.0.0.1:8282 \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --output-path .data/dev/vote-actions.json

dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev vote-reducer compile

dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev vote-reducer trace-run-batch \
  --lifecycle-id 0 \
  --vote-actions-path .data/dev/vote-actions.json

docker run --rm -p 6379:6379 redis:7-alpine

dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev worker start \
  --redis-host=127.0.0.1 \
  --redis-port=6379

dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev vote-reducer prove-run-batch \
  --lifecycle-id 0 \
  --redis-host=127.0.0.1 \
  --redis-port=6379

dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev vote-reducer prove-merge \
  --lifecycle-id 0 \
  --proof-output-path .data/dev/vote-reducer-merge.json \
  --redis-host=127.0.0.1 \
  --redis-port=6379

dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev proposal tally-votes \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --vote-reducer-proof-path .data/dev/vote-reducer-merge.json \
  --staking-ledger-to-voting-ledger-proof-path .data/dev/staking-ledger-exhausted.json \
  --lifecycle-id 0 \
  --wait true
```

### Pause proposal

Obtain signatures for pausing the proposal from every multisig participant

```zsh
dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev multisig-sign toggle-pause-proposal \
  --multisig-signer-private-key <SIGNER_PRIVATE_KEY> \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --nonce 0
```

Pause the proposal

```zsh
dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev pause-controller toggle-pause-proposal \
  --treasury-owner-public-key <TREASURY_OWNER_PUBLIC_KEY> \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --multisig-signatures <SIG1>,<SIG2>,<SIG3>,<SIG4>,<SIG5> \
  --wait true
```

## Running the CLI

From repo root, run:

```bash
pnpm --dir apps/cli run mina-treasury -- --help
```

Current output:

```text
Usage: cli [options] [command]

Options:
  -h, --help                                        display help for command

Commands:
  staking-ledger
  staking-ledger-to-voting-ledger
  worker
  treasury-owner                                    Treasury owner contract commands
  pause-controller                                  Pause controller contract commands
  proposal                                          Proposal contract commands
  vote-reducer
  multisig-sign                                     Sign pause-controller multisig messages
  lightnet
  generate-keypair [options]                        Generate one keypair for manual env values
  generate-keypairs [options] <number-of-keypairs>
  help [command]                                    display help for command
```

## Notes

- Root `package.json` exposes `mina-treasury` as a bin path, but local execution
  from source should still use the command above (`pnpm --dir apps/cli run ...`).
- For runtime wiring and service APIs, use `apps/api/README.md`.
