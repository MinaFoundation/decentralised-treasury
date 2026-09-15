# Mina Decentralized Treasury Monorepo

This repository contains the SDK, CLI, indexer, processor, and app surfaces for
the Mina decentralized treasury project.

## Repository Layout

### Apps

- [`apps/cli`](apps/cli/README.md): operational CLI (`mina-treasury`)
- [`apps/api`](apps/api/README.md): indexer, processor, API wiring, and end-to-end tests
- [`apps/web`](apps/web/README.md): user web application
- [`apps/backoffice`](apps/backoffice/README.md): break-glass signer and submitter application
- [`apps/docs`](apps/docs/README.md): user, operator, and developer documentation site
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

### Required command tools

Complete [Required command tools](apps/docs/docs/developer/local-development/tools.md)
before a local demo or CLI procedure. The commands require `dotenvx` on `PATH`.
Workspace dependency installation does not supply that global command.

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

| Goal                                                        | Start here                                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Learn how to use the treasury                               | [User documentation](apps/docs/docs/learn/index.md)                                      |
| Configure and operate the treasury                          | [Operator documentation](apps/docs/docs/operate/index.md)                                |
| Develop and test the treasury                               | [Developer documentation](apps/docs/docs/developer/index.md)                             |
| Run the documentation site                                  | [Documentation site README](apps/docs/README.md)                                         |
| Run the fastest local simulator demo                        | [Local demo](DEMO.md)                                                                    |
| Compare the three development networks                      | [Development network modes](apps/docs/docs/developer/local-development/network-modes.md) |
| Provision the network and treasury on Kubernetes            | [Kubernetes runbooks](devops/runbooks/README.md)                                         |
| Operate Compose on a long-running live-testnet host         | [Compose live-testnet guide](apps/docs/docs/operate/deployment/compose-testnet.md)       |
| Start a Mina single-node development network                | [Mina single-node guide](apps/docs/docs/developer/local-development/mina-single-node.md) |
| Check Ledger and Auro support                               | [Signing support matrix](apps/docs/docs/learn/signing-with-ledger-and-auro.md)           |
| Inspect Compose services, ports, tests, and troubleshooting | [DevOps reference](devops/README.md)                                                     |
| Develop packages directly on the host                       | [Native development stack](apps/docs/docs/developer/local-development/native-stack.md)   |

The operator path uses one generated testnet environment family. The
development paths use the environment own mode-specific values. Do not mix
network endpoints, timing values, accounts, or snapshots between modes.

## Application Flow Documentation

The User and Operator guides describe the same application flow at different
levels. The [Developer documentation](apps/docs/docs/developer/index.md) maps
this flow to the applications, packages, local environments, and tests.

| Flow stage                        | User perspective                                                                         | Operator perspective                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Understand timing and snapshots   | [Lifecycle and Staking Snapshots](apps/docs/docs/learn/lifecycle-and-snapshots.md)       | [Lifecycle Configuration](apps/docs/docs/operate/lifecycle/configuration.md)                                              |
| Understand the system             | [How the Treasury Works](apps/docs/docs/learn/how-it-works.md)                           | [System Topology](apps/docs/docs/operate/architecture/system-topology.md)                                                 |
| Provision the infrastructure      | Not a user action.                                                                       | [Infrastructure Runbooks](apps/docs/docs/operate/infrastructure/index.md)                                                 |
| Select the Treasury configuration | Not a user action.                                                                       | [Configure the Treasury](apps/docs/docs/operate/lifecycle/configure-the-treasury.md)                                      |
| Deploy and verify                 | Not a user action.                                                                       | [Deploy the Treasury](apps/docs/docs/operate/deployment/deploy-the-treasury.md)                                           |
| Choose an interface               | [Web Application](apps/docs/docs/learn/web-app.md) or [CLI](apps/docs/docs/learn/cli.md) | [CLI Prerequisites](apps/docs/docs/operate/cli/prerequisites.md)                                                          |
| Prepare voting data               | [Voting Weight](apps/docs/docs/learn/vote.md#voting-weight)                              | [Ledgers and Proving](apps/docs/docs/operate/proving/ledgers-and-proving.md)                                              |
| Create and review a proposal      | [Create a Proposal](apps/docs/docs/learn/create-a-proposal.md)                           | [Create and Reconcile](apps/docs/docs/operate/lifecycle/ideal-lifecycle.md#4-create-a-proposal-and-reconcile)             |
| Vote                              | [Vote](apps/docs/docs/learn/vote.md)                                                     | [Vote and Reconcile](apps/docs/docs/operate/lifecycle/ideal-lifecycle.md#5-vote-and-reconcile)                            |
| Prove, tally, and read the result | [Results and Acceptance](apps/docs/docs/learn/results-and-acceptance.md)                 | [Tally and Reconcile](apps/docs/docs/operate/lifecycle/ideal-lifecycle.md#7-tally-and-reconcile)                          |
| Execute and reconcile             | [Execute an Approved Proposal](apps/docs/docs/learn/execute-a-proposal.md)               | [Execute and Reconcile](apps/docs/docs/operate/lifecycle/ideal-lifecycle.md#8-execute-an-approved-proposal-and-reconcile) |
| Use emergency controls            | [Pause Behavior](apps/docs/docs/learn/pause-behavior.md)                                 | [Break-Glass Operation](apps/docs/docs/operate/break-glass/index.md)                                                      |

## Choose A Development Network

Use one development network at a time. Each mode has different endpoints,
accounts, timing, and staking-ledger input.

| Development goal                              | Procedure                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Run the complete in-repository simulator flow | [Full local demo](DEMO.md)                                                                 |
| Compare all development network modes         | [Development network modes](apps/docs/docs/developer/local-development/network-modes.md)   |
| Run a Mina daemon and Archive locally         | [Mina single-node network](apps/docs/docs/developer/local-development/mina-single-node.md) |
| Run Docker Lightnet tests                     | [Docker Lightnet](apps/docs/docs/developer/local-development/lightnet.md)                  |
| Debug packages as separate host processes     | [Native development stack](apps/docs/docs/developer/local-development/native-stack.md)     |

The in-repository simulator is an o1js `Mina.LocalBlockchain` HTTP service.
The Mina single-node path uses a separate Mina repository checkout. Lightnet
runs Mina containers and a funded account manager.

The Compose live-testnet stack is an operator deployment. It is not a
development network. Use the
[Compose live-testnet procedure](apps/docs/docs/operate/deployment/compose-testnet.md)
for a long-running cloud host.

## Prepare Development Staking Ledgers

The simulator flow can create a matching six-account snapshot from the
generated Treasury Owner and five voter public keys:

```bash
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev staking-ledger create-development-snapshot \
  --output-path "$PWD/.data/local-blockchain-ledgers/lifecycle-0.json"
```

The command prints the Base58 ledger hash, decimal ledger field, and total
currency in nanomina. Its default total is `1500000000000` nanomina. Use the
decimal values in the simulator admin page. Import the same JSON before
tracing or proving.

The Mina single-node and Lightnet procedures export the active network's
staking epoch ledger through the Mina client. The automated Lightnet lifecycle
test uses its pinned fixture. Do not substitute one mode's snapshot for
another.

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
