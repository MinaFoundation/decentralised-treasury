---
title: Developer Troubleshooting
sidebar_label: Troubleshooting
audience: developer
page_kind: procedure
---

# Developer Troubleshooting

When the local stack fails, find the first boundary that does not respond.
Check its configuration and inputs before you restart a process or remove local
data. This keeps the original failure available for diagnosis.

## Check Ports

The standard local ports are:

| Service              |   Port |
| -------------------- | -----: |
| Redis                | `6379` |
| Local Mina and admin | `8080` |
| Local Archive        | `8282` |
| Web                  | `3100` |
| Backoffice           | `3200` |
| App API proxy        | `4100` |
| Indexer API proxy    | `4101` |
| Processor API proxy  | `4102` |
| Documentation        | `3300` |

Stop an older stack when one of these ports is in use.

## Check The Simulator

```bash
curl --fail-with-body http://127.0.0.1:8080/healthz
curl --fail-with-body http://127.0.0.1:8080/admin/state
```

Confirm that the Archive process started on `8282`. The archive server is not
started when `MINA_ARCHIVE_PORT` is absent.

## Check The Application Stack

```bash
curl --fail-with-body http://127.0.0.1:4100/healthz
curl --fail-with-body http://127.0.0.1:4101/healthz
curl --fail-with-body http://127.0.0.1:4101/status
curl --fail-with-body http://127.0.0.1:4102/healthz
curl --fail-with-body http://127.0.0.1:4102/status
```

A health response only confirms that the HTTP process responds. Compare status
values at two different times to confirm ingestion and processing progress.

Use `pnpm local-blockchain:logs` for the Compose logs.

## Check Environment Files

Regenerate the local environment family when a file is missing:

```bash
pnpm env:bootstrap local-blockchain
```

The generator preserves existing keys by default. A new Treasury Owner key
requires a matching deployment, browser configuration, and staking snapshot.

Check that CLI, API, web, and Compose files use the same Treasury Owner address.
Check that all lifecycle durations are equal.

## Check Lifecycle SQLite Data

The CLI and API must resolve the same absolute SQLite directory. Confirm that
the lifecycle file exists before you request an account or witness.

Do not reuse lifecycle `0` data with another staking snapshot. Use another data
directory or archive the old lifecycle files.

## Check Proof Work

Confirm that Redis responds:

```bash
redis-cli -h 127.0.0.1 -p 6379 ping
```

The tracer, prover, merger, and worker must use the same lifecycle ID and queue
name. Confirm that the proof flag matches the intended test.

Real proof compilation can appear idle and use substantial memory. Check the
worker output before you start a second compile.

## Check Proposal Timing

Read Treasury Owner state after each manual slot change. Confirm the lifecycle
ID and period before you submit a transaction.

Five distinct non-initial action-state values are required by the manual demo
tally path. Submit at least five included vote actions before Cooldown. A
voter's later actions do not add weight after that voter's first valid action.

## Check Documentation

Regenerate promoted pages and run validation:

```bash
pnpm --dir apps/docs run generate:developer-guides
pnpm --dir apps/docs run validate:docs
pnpm --dir apps/docs run build
```

Use [Failures and remedies](../operate/failures/index.md) for deployed service
failures and controlled recovery.

## Sources

- `DEMO.md`
- `apps/api/README.md`
- `apps/web/README.md`
- `packages/local-blockchain/README.md`
- `devops/README.md`
- `apps/docs/README.md`
