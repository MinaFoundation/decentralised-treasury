---
title: Local Development Quickstart
sidebar_label: Local Development Quickstart
---

The local stack brings up a deterministic treasury environment for development
and demos. For an operator-style Compose demo, use root `DEMO.md`. For package
development, use this page and the package READMEs.

## Stack

1. Postgres.
2. Local blockchain with optional archive endpoint.
3. CLI deploy and configuration.
4. API migrations.
5. API runtime.
6. Web app.

## Canonical Environment

Use the repository's checked-in `.env.dev` files when running packages directly
from the host. Use `pnpm env:bootstrap local-blockchain` or `pnpm testnet:env`
for the generated Compose/deployment env families described in the devops
runbooks.

## Source Material

- root `DEMO.md` for the local Compose demo
- `devops/TESTNET.md` for the real testnet operator path
- root `README.md`
- `packages/local-blockchain/README.md`
- `apps/api/README.md`
- `apps/web/README.md`
- `apps/cli/README.md`
