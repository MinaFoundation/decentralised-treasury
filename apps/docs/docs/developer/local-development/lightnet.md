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
`mina-local-lightnet`. In the tested Mesa image, the Mina client listens on port
`3100` inside the container. Run the ledger export through `docker exec`.
The published host port `3085` does not provide this client endpoint.

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
  mina ledger export staking-epoch-ledger --daemon-port 3100 \
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

The lifecycle suites use a prepared deployment and matching snapshot through
`LIGHTNET_FIXTURE_MANIFEST_PATH`. They keep the prepared network running.
See [Regenerate Treasury Lifecycle Fixtures](#regenerate-treasury-lifecycle-fixtures).

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

Prepare the deployment and fixture file described below. Then run:

```bash
LIGHTNET_FIXTURE_MANIFEST_PATH=/absolute/path/to/prepared-lightnet.json \
  pnpm test:backend:e2e:lightnet
```

This test reuses the prepared network. It does not start, stop, or reset Lightnet.
The fixture file records the slot duration and Treasury period used by the deployment.
For example, `1000` millisecond slots with a `420`-slot Treasury period give seven-minute periods.
If the slot duration changes, adjust the period length to preserve enough time for proofs and transaction inclusion.

The test covers Archive ingestion and the create-to-execute Proposal lifecycle.
It also creates the required reducer proof.

The flow must include votes in at least five distinct slots during Voting.
Tally requires five distinct non-initial action-state targets.
See [the tally prerequisites](../../learn/tally-a-proposal.md#before-you-start).

The test timeout is two hours, including lifecycle waits and proof generation. Do not use it as a fast smoke test.

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

## Regenerate Treasury Lifecycle Fixtures

Owner deployment always requires a fresh account. A funded genesis account cannot
serve as a deployment target. Changing its key alone also invalidates the fixed
ledger witnesses and proofs.

These suites use `LIGHTNET_FIXTURE_MANIFEST_PATH`:

- `apps/api/test/e2e/proposal-lifecycle-lightnet.e2e.ts`;
- `apps/cli/test/proposal.test.ts` (creation and voting);
- `apps/cli/test/proposal-tally-votes.test.ts`;
- `apps/cli/test/treasury-owner.test.ts`;
- `apps/cli/test/transfer.test.ts`;
- `apps/cli/test/pause-controller.test.ts`;
- `apps/cli/test/treasury-owner-unused.ts`.

The last file is a manual suite. Its filename does not match the normal test pattern.
The creation and tally suites are skipped when `LIGHTNET_FIXTURE_MANIFEST_PATH` is absent.
A configured but missing or stale fixture causes setup failure. Neither a skip nor setup failure proves lifecycle success.
The Owner, transfer, and Pause Controller suites require the fixture and reuse its network without a reset.
Run them serially because they use voter 4 as the sender.
The transfer suite generates a fresh recipient public key and checks the exact balance increase.
The CLI pays the new account fee. The recipient receives no block rewards.
Do not run other tests that write to voter 4 during these checks.
The Pause Controller suite deploys a fresh controller and checks pause, unpause, key rotation, and authorization with new keys.
Its Proposal toggle check covers the signed payload only.
Other tests that call the standard Lightnet reset helper can still reset the network. Run these prepared suites separately.

Prepare the fixtures on a disposable network:

1. Start Lightnet once. Query its chain ID, slot duration, and slots per epoch.
2. Generate fresh Owner and Pause Controller keys. Keep both addresses absent from genesis.
3. Deploy with proofs enabled and the selected Treasury period. Record the included transaction and verification key hashes.
4. Fund the deployed Owner through the supported Treasury transfer operation.
5. Wait until the active staking epoch ledger contains the funded Owner's default-token account.
6. Export that exact staking ledger. Verify its root against the network staking epoch hash.
7. Rebuild the staking and voting SQLite data. Generate and verify the exhausted staking-to-voting proof for that root.
8. Write the prepared fixture file. Use five distinct, funded voter keys with sufficient voting weight for the Proposal.

Keep the network running. The suites validate its identity, contract state, verification keys, and staking root before creating a Proposal.
They select an available lifecycle from the deployed Owner's start slot and period duration.
They copy the prepared voting data into separate files for each run and adjust its lifecycle namespaces.
Proposal keys, actions, reducer traces, and reducer proofs belong to that run.
Do not run multiple prepared suites against the same deployment at the same time.

The fixture file uses JSON with `schemaVersion: 1`. Its fields are:

| Group              | Fields                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Network            | `minaNodeUrl`, `archiveNodeUrl`, `accountManagerUrl`, `networkId: "devnet"`, `chainId`, `slotDurationMs`, `slotsPerEpoch`            |
| Deployment         | `ownerPublicKey`, `controllerPublicKey`, `deploymentTxHash`, `deployedAtSlot`, `lifecyclePeriodDurationSlots`, `proofsEnabled: true` |
| Verification keys  | `ownerVerificationKeyHash`, `controllerVerificationKeyHash`                                                                          |
| Snapshot and proof | `artifactLifecycleId`, `stakingLedgerRoot`, `stakingLedgerPath`, `votingLedgerSqlitePath`, `exhaustedProofPath`                      |
| Voters             | `voters`, an array of objects with `privateKey` and `vote` (`"yay"`, `"nay"`, or `"abstain"`)                                        |

Set `artifactLifecycleId` to the lifecycle used when generating the prepared SQLite data, normally `"0"`.
File paths resolve relative to the fixture file. Use disposable keys only, and keep the fixture file outside version control.
The test process must use the same Mina, Archive, and account-manager endpoints as the fixture file.
For non-default endpoints, set `MINA_NODE_URL`, `ARCHIVE_NODE_URL`, and `LIGHTNET_ACCOUNT_MANAGER_ENDPOINT` before starting the process.

A new staking epoch can invalidate the fixture before Proposal creation. Export and rebuild for the current root when validation reports a mismatch.
A funded Owner can take more than one epoch transition to enter the staking ledger. Use observed membership, not a fixed delay.
Do not edit a proof file to change its root or replace it with a dummy proof.
Do not restore the existing-account deployment override to reuse legacy fixtures.

Fixture preparation and the full suites require a live network and real proof generation.
Repository changes alone do not establish a successful lifecycle run.

## Sources

- `package.json`
- `packages/sdk/package.json`
- `packages/sdk/README.md`
- `apps/cli/package.json`
- `apps/cli/src/commands/lightnet.ts`
- `apps/cli/test/ledger/README.md`
- `apps/cli/test/ledger/ledger-lightnet.test.ts`
- `apps/cli/test/utils/cli-test-utils.ts`
- `apps/cli/test/utils/prepared-lightnet-fixture.ts`
- `apps/api/package.json`
- `apps/api/test/e2e/proposal-lifecycle-lightnet.e2e.ts`
- `devops/scripts/verify-ledger-integration.mjs`
