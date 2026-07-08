---
title: System Architecture
sidebar_label: System Architecture
---

The system connects Mina, off-chain proving, event indexing, API projection, and a browser UI.

## End-to-End Flow

1. The CLI or web app submits treasury transactions to a Mina node.
2. Treasury zkApps emit proposal lifecycle events.
3. The indexer reads archive events and persists typed event rows in Postgres.
4. The processor consumes typed events and writes projection tables.
5. The API exposes proposal content, proposal lists, lifecycle data, status endpoints, and ledger witness data.
6. The web app reads Mina GraphQL and API routes to present the treasury.
7. Operators use CLI and SDK services to prepare proof-backed tallies.

## System Surfaces

- **Web app**: user-facing dashboard and proposal interactions.
- **CLI**: operational control surface for deploy, prove, tally, execute, and pause.
- **API app**: app API, indexer API, processor API, indexer worker, processor worker.
- **SDK**: zkApps, circuits, ledgers, storage, services, and workers.
- **Local blockchain**: deterministic local Mina-like runtime for demos and tests.
