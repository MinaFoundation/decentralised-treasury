---
title: Development Network Modes
sidebar_label: Network modes
audience: developer
page_kind: concept
---

# Development Network Modes

Select one network mode before you create environment files or start services.
Each mode has a different clock, account source, endpoint set, and test boundary.

These modes are for development and test work. Use the
[Operator section](../../operate/index.md) for a live Treasury deployment.

## Choose One Mode

| Mode                         | Best use                        | Mina GraphQL                    | Account source             | Staking-ledger source                   |
| ---------------------------- | ------------------------------- | ------------------------------- | -------------------------- | --------------------------------------- |
| In-repository o1js simulator | Deterministic full lifecycle    | `http://127.0.0.1:8080/graphql` | Built-in funded accounts   | CLI development-snapshot command        |
| Docker Lightnet              | Mina integration tests          | `http://127.0.0.1:8080/graphql` | Account manager on `8181`  | Container export or pinned test fixture |
| Mina-repository single node  | Local Mina and Archive behavior | `http://127.0.0.1:3001/graphql` | Local online whale account | `mina ledger export`                    |

Do not run two modes on the same ports. Stop the current mode before you select another mode.

## Use The In-Repository o1js Simulator

The `@repo/local-blockchain` package runs an internal `Mina.LocalBlockchain`.
It supplies only the Mina and Archive surfaces that this repository uses.
Its admin page shows funded accounts and controls the global slot and staking
snapshot.

The simulator is not a Mina daemon. It does not provide full Lightnet or Mina GraphQL compatibility.

Use the [local blockchain procedure](local-blockchain.md) for setup, endpoints,
snapshot preparation, checks, and shutdown. Use the [full local blockchain
demo](full-local-demo.md) for the proof-enabled Treasury flow.

## Use Docker Lightnet

Lightnet provides a Docker-based Mina network and a funded account manager.
Use it for integration behavior that the in-repository simulator does not provide.

Follow [Run Tests with Lightnet](lightnet.md) for the start, check, account, test, and stop commands.

Lightnet uses `devnet` as the signature network in repository commands.
It is not a public testnet and must not hold real funds.

## Use The Mina-Repository Single Node

This mode runs a Mina daemon, Archive process, and Archive Postgres outside this repository.
It needs a separate Mina repository checkout and a working Nix environment.

The local network uses these ports:

| Port   | Surface                    |
| ------ | -------------------------- |
| `3000` | Mina daemon client         |
| `3001` | Mina GraphQL               |
| `5433` | Ephemeral Archive Postgres |
| `8282` | Archive GraphQL            |

Use the [Mina single-node procedure](mina-single-node.md) for account
extraction, startup, health checks, ledger export, root verification, lifecycle
alignment, and shutdown. The procedure uses `--no-proofs` and creates a local
demo network. Do not use the Kubernetes Mina daemon page for this local
network.

## Keep Live Testnet Operation Separate

A live testnet is not a development network mode. The long-running Compose
deployment uses external Mina, Archive, and staking-snapshot services.

Use [Run Compose on a Live Testnet](../../operate/deployment/compose-testnet.md)
for that operator path.

## Avoid Port And Environment Conflicts

The o1js simulator and Lightnet both use Mina port `8080` in repository workflows.
They also use Archive port `8282` when Archive support is active.

The Mina-repository single node also uses Archive port `8282`.
Stop the current Archive process before another mode uses that port.

The full simulator demo also publishes application proxy ports. Stop that
application stack before another local process uses the same ports.

Use one environment family for all processes in one run.
Do not mix endpoints, network IDs, or lifecycle values from different
networks. Apply the documented direct-host overrides to one selected family
when a native process needs them.

## Understand The Limits

The o1js simulator gives deterministic admin controls, but it implements a small protocol surface.
Lightnet gives broader Mina behavior, but it remains a disposable Docker network.

The Mina-repository single node uses Mina binaries, but the documented command
disables blockchain proofs.

No development mode replaces release checks on the selected deployment network.

## Sources

- `package.json`
- `DEMO.md`
- `packages/local-blockchain/README.md`
- `packages/local-blockchain/src/server.ts`
- `packages/local-blockchain/test/local-blockchain-server.test.ts`
- `packages/sdk/package.json`
- `apps/cli/src/commands/lightnet.ts`
- `apps/cli/test/utils/cli-test-utils.ts`
- `devops/README.md`
- `devops/TESTNET.md`
- `devops/TESTNET_MINA_NODE.md`
- `devops/compose.yml`
