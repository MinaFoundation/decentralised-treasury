---
title: Testing Strategy
sidebar_label: Testing
audience: developer
page_kind: procedure
---

# Testing Strategy

A useful test should identify the behavior you changed when it fails. Start
with the smallest matching test, then add broader checks when the change
crosses a process, storage, proof, or network boundary.

## Workspace Checks

```bash
pnpm check-types
pnpm lint
pnpm build
```

These commands run the matching package scripts through Turborepo.

## Package Tests

| Scope                | Command                                                              |
| -------------------- | -------------------------------------------------------------------- |
| SDK                  | `pnpm --dir packages/sdk run test:all`                               |
| SDK with real proofs | `pnpm --dir packages/sdk run test:proofs-enabled:all`                |
| CLI                  | `pnpm --dir apps/cli run test`                                       |
| Indexer              | `pnpm --dir packages/indexer run test:unit`                          |
| Processor            | `pnpm --dir packages/processor run test:unit`                        |
| API                  | `pnpm --dir apps/api run test`                                       |
| Web                  | `pnpm --dir apps/web run test`                                       |
| Backoffice           | `pnpm --dir apps/backoffice run test`                                |
| Shared UI            | `pnpm --dir packages/ui run test`                                    |
| Local blockchain     | `PROOFS_ENABLED=false pnpm --dir packages/local-blockchain run test` |

Run the relevant package type check before its tests.

## Backend Checks

Run backend coverage:

```bash
pnpm test:backend
```

Run Postgres integration tests with a suitable database:

```bash
pnpm test:backend:postgres
```

## Local Blockchain Coverage

The local-blockchain suite includes a full Treasury transaction flow. It
deploys, funds, creates, votes, tallies, executes, advances slots, and reads
Archive actions.

```bash
PROOFS_ENABLED=false pnpm --dir packages/local-blockchain run test
```

This command explicitly selects dummy proofs. It does not check real proof generation.
The underlying test suite defaults to `false` only when `PROOFS_ENABLED` is unset.
It accepts exactly `false` or `true` from the inherited environment.

To select real proof work explicitly:

```bash
PROOFS_ENABLED=true pnpm --dir packages/local-blockchain run test
```

This mode compiles circuits and can take substantial time and memory.
Do not use an unqualified package command when the shell contains settings from a different proof workflow.

The API local-blockchain e2e checks one `ProposalCreated` ingestion pipeline:

```bash
pnpm test:backend:e2e:local-blockchain
```

This API test does not run the complete governance lifecycle.

## Two-Pass Local E2E

The root runner executes each selected suite with `PROOFS_ENABLED=false`, then with `PROOFS_ENABLED=true`.
It sets each child process mode explicitly. An inherited proof mode does not select the runner's pass.
Every selected first-pass suite must succeed before the second pass starts.

Install the pinned workspace dependencies and start Docker for suites that use managed services or browsers.
Install Chromium before selecting `web` or `backoffice`:

```bash
pnpm --dir apps/web exec playwright install chromium
pnpm --dir apps/backoffice exec playwright install chromium
```

On Linux, use the Playwright `install --with-deps chromium` option when system browser libraries are absent.
Keep sufficient disk space for images, logs, source maps, proof caches, and coverage output.
Real proof work can use substantial RAM. The runner does not supply a universal memory sizing guarantee.
Avoid concurrent proof runs on an unmeasured machine.

Run one selected suite first:

```bash
pnpm test:e2e:local:two-pass service
```

Run the complete default selection:

```bash
pnpm test:e2e:local:two-pass
```

| Selection                             | Coverage intent                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `service`                             | Simulator transaction flow, Archive ranges, and GraphQL errors.                                                  |
| `service-errors`                      | Focused GraphQL errors; opt in explicitly.                                                                       |
| `api`                                 | Proposal creation ingestion and projection.                                                                      |
| `api-recovery`, `api-payout-recovery` | Backend recovery and payout projection scenarios.                                                                |
| `cli`, `cli-negative`, `cli-ledger`   | CLI lifecycle, rejection cases, and varied staking-ledger scenarios. `cli-ledger` is not a physical device test. |
| `web`, `backoffice`                   | Browser scenarios against managed local services.                                                                |
| `compose`                             | Compose application pipeline.                                                                                    |

The default selection includes every row except `service-errors` as a separate suite.
Pass suite names as arguments without an extra `--` separator.
Keep source files unchanged between passes. The runner rejects source changes and inconsistent reported cases.

Results are written under `coverage/local-e2e/<RUN_ID>/`.
The incremental `summary.json` records modes, counts, coverage, exit status, and source consistency.
Each suite directory contains its logs and collected reports.
Check that all selected suites completed both modes; an existing partial summary is not a passing result.

`E2E_RUN_ID` can select a new, unused output directory name.
`E2E_SUITE_TIMEOUT_MS` overrides the per-suite timeout with a positive integer in milliseconds.
The defaults are 30 minutes without proofs and 120 minutes with proofs.
A timeout is a failed run, not proof that the operation completed.

Available commands describe test coverage intent. They do not establish a current passing release result or physical Ledger behavior.

## Compose Checks

Run the service smoke test:

```bash
pnpm compose:test
```

Run the Compose integration e2e:

```bash
pnpm compose:e2e
```

The Compose e2e checks deployment, funding, proposal creation, ingestion,
projection, API content, and web rendering. It does not vote, tally, or execute.

Use the [full local demo](local-development/full-local-demo.md) for the complete
proof-enabled manual lifecycle.

## Browser And Device Checks

Backoffice browser tests use Playwright:

```bash
pnpm --dir apps/backoffice run test:e2e
```

Automated tests mock WebHID. Complete the physical Ledger release checks in the
[Backoffice guide](apps/backoffice.md) for Ledger changes.

Use [Signing with Ledger and
Auro](/learn/signing-with-ledger-and-auro#set-up-ledger-in-a-browser) for the
browser and device prerequisites.

The CLI has software, transport-mocker, Lightnet, and physical-device Ledger
tests:

```bash
pnpm --dir apps/cli run test:ledger:software
pnpm --dir apps/cli run test:ledger:mocker
pnpm --dir apps/cli run test:ledger:lightnet
pnpm --dir apps/cli run test:ledger:device
pnpm --dir apps/cli run test:ledger:cli-device
```

The physical tests wait for device confirmation. The complete CLI device flow
starts its own simulator and can take substantial time.

Use the [CLI Ledger
setup](/learn/signing-with-ledger-and-auro#set-up-ledger-for-the-cli) before a
physical CLI test.

## Documentation Checks

```bash
pnpm docs:check
```

Read [Documentation development](documentation.md) for narrower commands and
generated-page rules.

## Test Boundaries

A passing unit test does not prove cross-process integration. A simulator test
does not prove real Mina, Archive, hardware, or production behavior.

A proof-disabled test does not replace a proof-enabled test. Record each
unverified boundary in the change description.

## Sources

- `package.json`
- `apps/api/package.json`
- `apps/backoffice/package.json`
- `apps/cli/package.json`
- `apps/cli/test/ledger/README.md`
- `apps/docs/package.json`
- `apps/web/package.json`
- `packages/indexer/package.json`
- `packages/local-blockchain/package.json`
- `packages/processor/package.json`
- `packages/sdk/package.json`
- `packages/ui/package.json`
- `devops/test/compose-e2e.mjs`
- `devops/test/run-local-e2e.mjs`
- `packages/local-blockchain/test/proof-mode.ts`
- `packages/local-blockchain/test/local-blockchain-server.test.ts`
