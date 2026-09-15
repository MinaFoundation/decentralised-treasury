---
title: Run Tests with Lightnet
sidebar_label: Lightnet
audience: developer
page_kind: procedure
---

# Run Tests with Lightnet

Use Lightnet when a test needs a Docker-based Mina network or the funded account manager.
The repository selects the Mesa Mina branch for its standard Lightnet start.

Lightnet is a disposable development network. Do not use production keys or real funds.

## Before You Start

Complete these prerequisites:

- use the Node.js version in `.nvmrc`;
- enable Corepack and install the locked workspace dependencies;
- install `curl` and `jq` for the checks below;
- start Docker Engine;
- stop another local Mina or Archive process;
- keep ports `3085`, `5432`, `8080`, `8181`, and `8282` available.

The repository uses these endpoints:

| Surface                  | Published loopback address      |
| ------------------------ | ------------------------------- |
| Mina daemon client       | `127.0.0.1:3085`                |
| Archive Postgres         | `127.0.0.1:5432`                |
| Mina GraphQL             | `http://127.0.0.1:8080/graphql` |
| Lightnet account manager | `http://127.0.0.1:8181`         |
| Archive Node API         | `http://127.0.0.1:8282`         |

The in-repository o1js simulator uses Mina port `8080` and can use Archive port `8282`.
The Mina-repository single node also uses Archive port `8282`.

## Start Lightnet

Run the standard repository command from the repository root:

```bash
pnpm --dir packages/sdk run lightnet:start
```

The lockfile selects `zkapp-cli` version `0.23.0`. The repository command
passes all network-shape inputs explicitly:

| Input          | Value         |
| -------------- | ------------- |
| Mode           | `single-node` |
| Type           | `fast`        |
| Proof level    | `none`        |
| Mina branch    | `mesa`        |
| Archive        | enabled       |
| Wait for sync  | enabled       |
| Pull image     | enabled       |
| Mina log level | `Trace`       |
| Slot time      | `20000` ms    |

Keep the command output available. Initial image download and network synchronization can take several minutes.

## Check Lightnet

Read the network status:

```bash
pnpm --filter @repo/sdk exec zkapp-cli lightnet status
```

Check the Mina GraphQL endpoint:

```bash
curl --fail-with-body \
  -H 'content-type: application/json' \
  --data '{"query":"query { bestChain(maxLength: 1) { stateHash } }"}' \
  http://127.0.0.1:8080/graphql
```

Continue only when Lightnet is running and `bestChain` contains a block.

## Acquire A Funded Account

Acquire one keypair through the repository CLI:

```bash
pnpm run cli -- lightnet acquire-account
```

The command uses Mina GraphQL on `8080` and the account manager on `8181`.
It always configures the Mina signature network as `devnet`.

The command prints JSON with the public key, private key, and balance.
Treat the private key as temporary sensitive data. Do not add it to version control.

The CLI command does not release the account.
Repository tests release accounts that they acquire directly through the o1js Lightnet API.

## Export A Lightnet Staking Ledger

The pinned `zkapp-cli` starts the single-node container as
`mina-local-lightnet`. It publishes Mina client port `3085` on loopback. The
same port is available inside the container.

Create a host output directory:

```bash
mkdir -p "$PWD/.data/lightnet-ledgers"
```

Query the current staking-ledger hash through Lightnet GraphQL:

```bash
curl --fail-with-body \
  -H 'content-type: application/json' \
  --data '{"query":"{ bestChain(maxLength:1){ protocolState{ consensusState{ stakingEpochData{ ledger{ hash totalCurrency } } } } } }"}' \
  http://127.0.0.1:8080/graphql | jq .
```

Export the same staking epoch ledger from the running container:

```bash
docker exec mina-local-lightnet \
  mina ledger export staking-epoch-ledger --daemon-port 3085 \
  > "$PWD/.data/lightnet-ledgers/staking-ledger-lifecycle-0.json"
```

Import the file and require the GraphQL hash:

```bash
mkdir -p "$PWD/.data/lightnet-sqlite"

SQLITE_DATA_DIRECTORY="$PWD/.data/lightnet-sqlite" \
  pnpm run cli -- staking-ledger from-file \
  --lifecycle-id 0 \
  --staking-ledger-path "$PWD/.data/lightnet-ledgers/staking-ledger-lifecycle-0.json"

SQLITE_DATA_DIRECTORY="$PWD/.data/lightnet-sqlite" \
  pnpm run cli -- staking-ledger get-root-hash \
  --lifecycle-id 0 \
  --expected-root-hash <LIGHTNET_LEDGER_HASH> \
  --output-format json
```

Do not continue when the exported file and GraphQL hash differ. Export a new
file for a later staking epoch or a reset Lightnet network.

The automated API lifecycle test uses the pinned
`apps/cli/test/fixtures/staking-epoch-ledger-lightnet.json` fixture. The test
manages its matching network state and proof input.

## Run Focused Tests

Run the software-Ledger transaction test against the running Lightnet:

```bash
pnpm --dir apps/cli run test:ledger:lightnet
```

The test acquires a funded account, submits a payment, and checks the recipient balance.
It also creates and verifies one break-glass field signature.

Run the complete Ledger verification pipeline with its Lightnet stage:

```bash
pnpm verify:ledger -- --lightnet
```

The Lightnet stage uses a software Ledger boundary. It does not use a physical Ledger device.

Use [Signing with Ledger and
Auro](/learn/signing-with-ledger-and-auro#set-up-ledger-for-the-cli) before a
physical CLI Ledger check.

## Run The API Lifecycle Test

Run the opt-in API lifecycle test:

```bash
pnpm test:backend:e2e:lightnet
```

This test stops an existing Lightnet before it starts a clean test network.
It uses a `1000` millisecond slot time and a `420`-slot Treasury period.

The test covers Archive ingestion and the create-to-execute Proposal lifecycle.
It also creates the required reducer proof.

The flow submits five included vote actions. Tally requires five distinct
non-initial action-state targets.

The test timeout is 30 minutes. Do not use it as a fast smoke test.

## Open The Lightnet Explorer

Start the explorer after Lightnet is ready:

```bash
pnpm --dir packages/sdk run lightnet:explorer
```

The explorer is a development aid. Mina GraphQL remains the transaction and state interface.

## Stop Lightnet

Stop the Lightnet container through `zkapp-cli`:

```bash
pnpm --filter @repo/sdk exec zkapp-cli lightnet stop
```

Check the status after the stop:

```bash
pnpm --filter @repo/sdk exec zkapp-cli lightnet status
```

Do not use forced Docker removal as the normal stop procedure.

## Limits

Lightnet is not the `@repo/local-blockchain` simulator.
It does not provide the simulator's manual slot and staking-snapshot controls.

The standard start script pins the Lightnet command inputs. The lockfile pins
the installed `zkapp-cli` version. The selected Docker image is not pinned by
digest because `--pull` is enabled.

An included Lightnet transaction does not prove behavior on a public Mina network.
The software-Ledger test does not prove physical device behavior.

Use [Development Network Modes](network-modes.md) before you change network or environment families.

## Sources

- `package.json`
- `packages/sdk/package.json`
- `packages/sdk/README.md`
- `apps/cli/package.json`
- `apps/cli/src/commands/lightnet.ts`
- `apps/cli/test/ledger/README.md`
- `apps/cli/test/ledger/ledger-lightnet.test.ts`
- `apps/cli/test/utils/cli-test-utils.ts`
- `apps/cli/test/fixtures/staking-epoch-ledger-lightnet.json`
- `apps/api/package.json`
- `apps/api/test/e2e/proposal-lifecycle-lightnet.e2e.ts`
- `devops/scripts/verify-ledger-integration.mjs`
