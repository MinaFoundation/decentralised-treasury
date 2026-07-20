---
title: Environment
sidebar_label: Environment
---

The treasury stack uses environment variables for Mina endpoints, archive endpoints, database URLs, treasury contract addresses, lifecycle configuration, proof settings, and API URLs.

## Important Groups

- Mina and Archive endpoints.
- Treasury owner address and token id.
- Postgres connection.
- SQLite lifecycle data directory.
- Redis host and port for proof workers.
- Web app public API endpoints.
- Proof enablement flags.

## Local Convention

For package-direct local development, prefer the checked-in `.env.dev` files.
For Compose, demo, and testnet workflows, use the generated package-local
`.env.local-blockchain` or `.env.testnet` files from the devops runbooks.

The generated Compose env families expose only Caddy proxy ports on the host.
Native package development uses direct host ports for Postgres, APIs, and the
web app.
