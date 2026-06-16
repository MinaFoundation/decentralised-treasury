# Provable Reference

This page collects commands, environment variables, storage notes, and a compact code map. Start with [Overview](overview.md) or [Architecture](architecture.md) if you need the subsystem context first.

## Commands

### SDK tests

```bash
pnpm --dir packages/sdk run test
pnpm --dir packages/sdk run test:all
pnpm --dir packages/sdk run test:proofs-enabled
```

### Local chain helpers

```bash
pnpm --dir packages/sdk run lightnet:start
pnpm --dir packages/sdk run lightnet:explorer
```

### Package Docker helpers

```bash
pnpm --dir packages/sdk run docker:up
pnpm --dir packages/sdk run docker:down
```

## Environment Variables

- `PROOFS_ENABLED=true` enables proof generation in compile/prove flows that read the environment.
- `TASK_ATTEMPTS` controls BullMQ retry attempts for queued tasks.
- `TASK_BACKOFF_MS` controls exponential backoff delay for queued tasks.
- `MAX_TASK_DURATION_MS` controls worker child-process timeout.

## Storage

SQLite-backed services use lifecycle ids to derive database paths. Staking ledgers, voting ledgers, nullifier ledgers, traces, and proofs are stored under lifecycle-specific namespaces so long-running proving flows can resume across service calls.

Vote reducer state can be cleared through `SqliteVoteReducerService.clearPersistentState()` when a lifecycle needs to be retraced from scratch.

## Compact Code Map

Use this map when you already know the concept and need the owning implementation area:

- On-chain zkApps: `src/provable/contracts/`
- Off-chain circuits and primitives: `src/provable/`
- Ledger implementations: `src/ledgers/`
- Storage adapters: `src/storage/`
- Tracing, proving, and workers: `src/proving/`
- SQLite services: `src/services/sqlite/`

## Related Docs

- [Treasury overview](../treasury/index.md)
- [Treasury concepts](../treasury/concepts.md)
- [Overview](overview.md)
- [Architecture](architecture.md)
- [Workflows](workflows.md)
- [Testing](testing.md)

## Related Specs

- [Provable primitives](../../specs/provable/provable-primitives.md)
- [Staking ledger to voting ledger](../../specs/provable/staking-ledger-to-voting-ledger.md)
- [Treasury owner](../../specs/provable/treasury-owner.md)
- [Treasury pause controller](../../specs/provable/treasury-pause-controller.md)
- [Treasury proposal](../../specs/provable/treasury-proposal.md)
- [Vote reducer](../../specs/provable/vote-reducer.md)

