---
title: Developer Overview
sidebar_label: Two-minute overview
audience: developer
page_kind: overview
---

# Developer Overview

The Treasury is a TypeScript monorepo with Mina zkApps, proof programs, command
tools, background services, APIs, and browser applications. A normal feature
can cross several of these layers.

## The System In One Flow

1. The web application or CLI builds a Mina transaction.
2. Treasury contracts check the transaction and update account state.
3. The contracts emit events.
4. The indexer reads Archive data and stores typed events.
5. The processor converts events into application views.
6. APIs serve proposal content and views to the web application.
7. Separate workers build proofs that a tally transaction supplies to the
   Proposal contract.

The chain is the write authority. The service databases are read models and
work stores.

## The Main Code Areas

| Area                                | Main path                    |
| ----------------------------------- | ---------------------------- |
| Contracts and proofs                | `packages/sdk/src/provable/` |
| Ledger, storage, and proof services | `packages/sdk/src/`          |
| CLI                                 | `apps/cli/`                  |
| Indexer                             | `packages/indexer/`          |
| Processor                           | `packages/processor/`        |
| Treasury API composition            | `apps/api/`                  |
| User application                    | `apps/web/`                  |
| Break-glass application             | `apps/backoffice/`           |
| Local Mina simulator                | `packages/local-blockchain/` |

## Development Network Modes

The repository supports three different development network modes:

- The in-repository o1js simulator gives deterministic funded accounts and slot controls.
- The Mina-repository single node runs a Mina daemon and Archive process without blockchain proofs.
- Docker Lightnet supplies a disposable Mina integration network and funded account manager.

Select a mode with [Development Network Modes](local-development/network-modes.md).
Do not run these modes on conflicting Mina or Archive ports.

The [native stack](local-development/native-stack.md) is an application process layout.
It is not a fourth network mode.

The Compose live-testnet stack is an operator deployment.
Use the [Operator section](../operate/index.md) for that stack.

Start with the [local development quickstart](local-development/quickstart.md).
Use the [full local blockchain demo](local-development/full-local-demo.md) when
you need the end-to-end behavior.

## How To Approach A Change

Begin with the user-visible result. Find the component that owns the rule,
then trace all consumers of its state, event, API shape, or compile output.

A contract event change can affect the SDK, indexer, processor, database
migration, API, web application, tests, and documentation. A web-only layout
change can stay inside the browser layers.

Read the [repository tour](foundations/repository-tour.md) for the workspace
boundaries. If Mina development is new to you, read
[Mina, o1js, and proofs](foundations/mina-o1js-and-proofs.md).

## Sources

- `README.md`
- `pnpm-workspace.yaml`
- `apps/api/README.md`
- `apps/cli/README.md`
- `apps/web/README.md`
- `packages/sdk/README.md`
- `packages/indexer/README.md`
- `packages/processor/README.md`
- `packages/local-blockchain/README.md`
- `packages/sdk/package.json`
- `devops/TESTNET_MINA_NODE.md`
- `devops/TESTNET.md`
