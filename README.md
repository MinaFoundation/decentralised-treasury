# Mina Decentralized Treasury Monorepo

This repository contains the SDK, CLI, indexer, processor, and app surfaces for
the Mina decentralized treasury project.

## Repository Layout

### Apps

- [`apps/cli`](apps/cli/README.md): operational CLI (`mina-treasury`)
- [`apps/api`](apps/api/README.md): indexer, processor, API wiring, and end-to-end tests
- [`apps/web`](apps/web/README.md): user web application
- [`apps/backoffice`](apps/backoffice/README.md): break-glass signer and submitter application
- [`apps/docs`](apps/docs/README.md): user and operator documentation site
- [`devops`](devops/README.md): Kubernetes runbooks, Docker Compose stack, and testnet tools

### Packages

- [`packages/sdk`](packages/sdk/README.md): provable contracts, services, workers, and shared treasury logic
- [`packages/indexer`](packages/indexer/README.md): Archive ingestion and indexed-events API
- [`packages/processor`](packages/processor/README.md): event processing and projection API
- [`packages/ui`](packages/ui/README.md): shared React UI components
- [`packages/local-blockchain`](packages/local-blockchain/README.md): local Mina and Archive simulator
- `packages/eslint-config`: shared ESLint configuration
- `packages/typescript-config`: shared TypeScript configuration

For package-specific details:

- [CLI](apps/cli/README.md)
- [API runtime](apps/api/README.md)
- [SDK](packages/sdk/README.md)
- [Indexer](packages/indexer/README.md)
- [Processor](packages/processor/README.md)

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

The workspace uses the
[`maht0rz/o1js` commit `87bc121a`](https://github.com/maht0rz/o1js/commit/87bc121acad6ba4d81df499e49ff44800c130ded).

This commit is based on `o1js@3.0.0`. It includes Mesa support and
the native Node.js prover.

The workspace packages use this pinned commit.

## Common Workspace Commands

From repo root:

```bash
pnpm check-types
pnpm build
pnpm lint
```

## Choose A Run Path

| Goal                                                        | Start here                                                |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| Learn how to use the treasury                               | [User documentation](apps/docs/docs/learn/index.md)       |
| Configure and operate the treasury                          | [Operator documentation](apps/docs/docs/operate/index.md) |
| Run the documentation site                                  | [Documentation site README](apps/docs/README.md)          |
| Run the fastest local simulator demo                        | [Local demo](DEMO.md)                                     |
| Provision the network and treasury on Kubernetes            | [Kubernetes runbooks](devops/runbooks/README.md)           |
| Run the Compose stack against a Mina testnet node           | [Testnet runbook](devops/TESTNET.md)                      |
| Start a local Mina daemon and Archive node                  | [Local Mina node runbook](devops/TESTNET_MINA_NODE.md)    |
| Inspect Compose services, ports, tests, and troubleshooting | [DevOps reference](devops/README.md)                      |
| Develop packages directly on the host                       | The native workflow below and the linked package READMEs  |

The operator path uses generated package-specific files for one selected
environment family. It exposes only Caddy proxy ports on the host. The native
development path uses `.env.dev` files and direct service ports such as `3100`,
`4000`, and `5432`.

## Application Flow Documentation

The user and operator guides describe the same application flow at different
levels.

| Flow stage                        | User perspective                                                                         | Operator perspective                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Understand timing and snapshots   | [Lifecycle and Staking Snapshots](apps/docs/docs/learn/lifecycle-and-snapshots.md)       | [Lifecycle Configuration](apps/docs/docs/operate/lifecycle/configuration.md)                                              |
| Understand the system             | [How the Treasury Works](apps/docs/docs/learn/how-it-works.md)                           | [System Topology](apps/docs/docs/operate/architecture/system-topology.md)                                                 |
| Provision the infrastructure      | Not a user action.                                                                       | [Infrastructure Runbooks](apps/docs/docs/operate/infrastructure/index.md)                                                |
| Select the Treasury configuration | Not a user action.                                                                       | [Configure the Treasury](apps/docs/docs/operate/lifecycle/configure-the-treasury.md)                                      |
| Deploy and verify                 | Not a user action.                                                                       | [Deploy the Treasury](apps/docs/docs/operate/deployment/deploy-the-treasury.md)                                           |
| Choose an interface               | [Web Application](apps/docs/docs/learn/web-app.md) or [CLI](apps/docs/docs/learn/cli.md) | [CLI Prerequisites](apps/docs/docs/operate/cli/prerequisites.md)                                                          |
| Prepare voting data               | [Voting Weight](apps/docs/docs/learn/vote.md#voting-weight)                              | [Ledgers and Proving](apps/docs/docs/operate/proving/ledgers-and-proving.md)                                              |
| Create and review a proposal      | [Create a Proposal](apps/docs/docs/learn/create-a-proposal.md)                           | [Create and Reconcile](apps/docs/docs/operate/lifecycle/ideal-lifecycle.md#4-create-a-proposal-and-reconcile)             |
| Vote                              | [Vote](apps/docs/docs/learn/vote.md)                                                     | [Vote and Reconcile](apps/docs/docs/operate/lifecycle/ideal-lifecycle.md#5-vote-and-reconcile)                            |
| Prove, tally, and read the result | [Results and Acceptance](apps/docs/docs/learn/results-and-acceptance.md)                 | [Tally and Reconcile](apps/docs/docs/operate/lifecycle/ideal-lifecycle.md#7-tally-and-reconcile)                          |
| Execute and reconcile             | [Execute an Approved Proposal](apps/docs/docs/learn/execute-a-proposal.md)               | [Execute and Reconcile](apps/docs/docs/operate/lifecycle/ideal-lifecycle.md#8-execute-an-approved-proposal-and-reconcile) |
| Use emergency controls            | [Pause Behavior](apps/docs/docs/learn/pause-behavior.md)                                 | [Break-Glass Operation](apps/docs/docs/operate/break-glass/index.md)                                                      |

## Native Dev Workflow

This section is for package development and debugging without Compose. For the
recommended full-stack paths, use the [local demo](DEMO.md) or the
[testnet runbook](devops/TESTNET.md).

The CLI and API must use the same absolute SQLite directory. Run these commands
from the repository root in every API or CLI terminal:

```bash
export SQLITE_DATA_DIRECTORY="$PWD/.data/native/sqlite"
mkdir -p "$SQLITE_DATA_DIRECTORY"
```

The web `.env.dev` file is worktree-local. Create it with the direct native
ports from the [web application README](apps/web/README.md#environment). After
contract compilation, add the emitted browser proof values to this file.

### Start the local blockchain

Run this long-lived process in its own terminal:

```bash
dotenvx run -f packages/local-blockchain/.env.dev -- pnpm run --dir packages/local-blockchain dev
```

### Set the staking ledger state in the local blockchain

Select one lifecycle staking ledger. It must contain the configured Treasury
Owner default-token account with a nonzero historical balance. It must also
contain every delegate that will submit a weighted vote.

Open `http://127.0.0.1:8080/admin`. Set the values from that exact snapshot:

| Field                                 | Value                         |
| ------------------------------------- | ----------------------------- |
| `stakingEpochDataLedgerTotalCurrency` | `<TOTAL_CURRENCY_NANOMINA>`   |
| `stakingEpochDataLedgerHash`          | `<STAKING_LEDGER_ROOT_FIELD>` |

The JSON file, these values, and the later proof must describe the same
snapshot. A voter that is absent from this snapshot has zero voting weight.

### Start the Indexer, Processor and API

Open a new terminal. Set the shared `SQLITE_DATA_DIRECTORY` value again. The
final command is a long-lived process.

```bash
docker run --name treasury-postgres \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=treasury_api \
  -p 5432:5432 \
  -d postgres:16

dotenvx run -f apps/api/.env.dev -- pnpm run --dir apps/api migration:run

dotenvx run -f apps/cli/.env.dev -f apps/api/.env.dev -- pnpm run --dir apps/api dev
```

### Deploy the treasury

Set `SENDER_PRIVATE_KEY` in `apps/cli/.env.dev` to a funded key from the local
blockchain admin page. For Lightnet, use an account acquired from Lightnet.

```bash
dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev treasury-owner compile

dotenvx run -f apps/cli/.env.dev -- pnpm run --dir apps/cli dev treasury-owner deploy
```

Copy the complete `browserEnv` object from the compile result to
`apps/web/.env.dev`. Keep the Treasury Owner address from the deployment result
for the API, web application, and later commands.

### Prepare the voting ledger

This step is required before tally unless a matching exhausted proof already
exists. The staking ledger must match the hash configured in the local
blockchain.

Open a new CLI terminal. Set the shared `SQLITE_DATA_DIRECTORY` value again.
Compile and trace in this terminal:

```bash
dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev staking-ledger from-file \
  --lifecycle-id 0 \
  --staking-ledger-path <NATIVE_STAKING_LEDGER_JSON_PATH>

dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev staking-ledger-to-voting-ledger compile

dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev staking-ledger-to-voting-ledger trace-digest \
  --lifecycle-id 0
```

Keep Redis running in a second terminal:

```bash
docker run --rm -p 6379:6379 redis:7-alpine
```

Keep the proof worker running in a third terminal:

```bash
dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev worker start \
  --queue-name treasury-native-0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379
```

Run the proof commands in the main terminal:

```bash
dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev staking-ledger-to-voting-ledger prove-digest \
  --lifecycle-id 0 \
  --queue-name treasury-native-0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379

dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev staking-ledger-to-voting-ledger prove-merge \
  --lifecycle-id 0 \
  --queue-name treasury-native-0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379 \
  --proof-output-path .data/dev/staking-ledger-merge.json

dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev staking-ledger-to-voting-ledger prove-exhaust \
  --lifecycle-id 0 \
  --proof-output-path .data/dev/staking-ledger-exhausted.json
```

### Start the web application

Run this long-lived process in a separate terminal:

```bash
dotenvx run -f apps/cli/.env.dev -f apps/api/.env.dev -f apps/web/.env.dev -- pnpm run --dir apps/web dev
```

### Create the first proposal

Create during the Proposal period. Use the web application, or use this CLI
command. Keep one recipient public key for creation and execution.

```bash
dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev proposal create \
  --proposal-lifecycle-id 0 \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --amount 1000000000 \
  --content-file "$PWD/DEMO_PROPOSAL.md" \
  --api-url http://127.0.0.1:4000
```

If `--proposal-private-key` is absent, the CLI generates the Proposal keypair
in memory and discards the private key after deployment. The CLI prints a
warning because Proposal permissions make this private key unusable after
deployment. Save the proposal address from the output for later operations.

### Prepare voter accounts

Each voter account must exist on the local blockchain. Transfer local test
MINA to each voter account that the flow will use:

```bash
dotenvx run -f apps/cli/.env.dev -- \
  pnpm --dir apps/cli run dev transfer \
  --recipient-public-key <VOTER_PUBLIC_KEY> \
  --amount 100000000000
```

Repeat this command for the test voters. This is local account preparation. It
is not part of voting weight. Voting weight comes from the recorded staking
ledger.

### Fund the treasury

```bash
dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev treasury-owner fund-treasury \
  --amount 100000000000
```

### Vote

Advance the local blockchain to the Voting period. Confirm the current period
with `treasury-owner read-state`. Submit votes from eligible keys:

```bash
dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev proposal vote \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --voter-private-key <VOTER_PRIVATE_KEY> \
  --vote yay \
  --wait true
```

Use `yay`, `nay`, or `abstain`. Repeat the command with at least five eligible
voter keys so the local tally flow has five non-initial action-state values.
Keep each transaction hash.

### Tally votes

Advance the local blockchain to Cooldown. Reuse the Redis process and proof
worker from the voting-ledger step. If they are not running, start them in
separate terminals before the proof commands.

```bash
dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev proposal fetch-actions \
  --archive-node-url http://127.0.0.1:8282/graphql \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --output-path .data/dev/vote-actions.json

dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev vote-reducer compile

dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev vote-reducer trace-run-batch \
  --lifecycle-id 0 \
  --vote-actions-path .data/dev/vote-actions.json

dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev vote-reducer prove-run-batch \
  --lifecycle-id 0 \
  --queue-name treasury-native-0 \
  --redis-host=127.0.0.1 \
  --redis-port=6379

dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev vote-reducer prove-merge \
  --lifecycle-id 0 \
  --proof-output-path .data/dev/vote-reducer-merge.json \
  --queue-name treasury-native-0 \
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

Read Proposal state after inclusion. Continue only when the stored status is
`APPROVED`.

### Execute the approved proposal

Advance the local blockchain to lifecycle `1`. Use the same recipient public
key that proposal creation committed:

```bash
dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev proposal execute \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --wait true
```

Read Proposal state again. Confirm that `paidOutAmount` increased. Confirm the
Treasury Owner and recipient balance changes.

### Optional: test proposal pause

Do not use the approved proposal from the completed flow. A pause toggle can
erase a stored `APPROVED` or `REJECTED` result. Use a separate unresolved
proposal for this test. See [Pause Behavior](apps/docs/docs/learn/pause-behavior.md)
and [Break-Glass Operation](apps/docs/docs/operate/break-glass/index.md).

Read `pause-controller read-state`. Use its current nonce. Obtain signatures
from at least three of the five ordered participants:

```bash
dotenvx run -f apps/cli/.env.dev -- \
  pnpm run --dir apps/cli dev multisig-sign toggle-pause-proposal \
  --multisig-signer-private-key <SIGNER_PRIVATE_KEY> \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --nonce <PAUSE_CONTROLLER_NONCE>
```

Put each signature in its participant slot. Then submit the transaction:

```bash
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

Use the [CLI command index](apps/docs/docs/operate/reference/cli-commands.md)
for the complete option and environment-field reference. The documentation
check compares that index with the registered CLI commands.

## Notes

- Root `package.json` exposes `mina-treasury` as a bin path, but local execution
  from source should still use the command above (`pnpm --dir apps/cli run ...`).
- For runtime wiring and service APIs, use the [API README](apps/api/README.md).
