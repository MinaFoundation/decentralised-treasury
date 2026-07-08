---
title: Testing Strategy
sidebar_label: Testing Strategy
---

Provable tests serve two different needs:

- fast feedback for circuit and service behavior with proofs disabled,
- higher-confidence proof execution with `PROOFS_ENABLED=true`.

Use this page to choose the right test scope and understand what each group of tests is meant to validate.

## Running Tests

From the repo root:

```bash
pnpm --dir packages/sdk run test
pnpm --dir packages/sdk run test:all
pnpm --dir packages/sdk run test:proofs-enabled
```

Focused tests are usually better while working on one area:

```bash
pnpm --dir packages/sdk run test -- ./test/provable/staking-ledger-to-voting-ledger.test.ts
pnpm --dir packages/sdk run test -- ./test/provable/contracts/treasury-proposal/vote-reducer.test.ts
pnpm --dir packages/sdk run test -- ./test/proving/tracing/vote-reducer-tracer.test.ts
pnpm --dir packages/sdk run test -- ./test/proving/prover/staking-ledger-to-voting-ledger-prover.test.ts
```

Use proofs-enabled tests when you need proof generation rather than proof-disabled method execution:

```bash
PROOFS_ENABLED=true pnpm --dir packages/sdk run test -- ./test/provable/staking-ledger-to-voting-ledger.test.ts
```

## What To Test

### Off-chain Circuits and On-chain zkApps

Use `test/provable/` when the behavior belongs to on-chain zkApps, off-chain circuits, proof IO, events, or provable primitives.

Representative tests:

- `test/provable/staking-ledger-to-voting-ledger.test.ts`
- `test/provable/contracts/treasury-proposal/vote-reducer.test.ts`
- `test/provable/contracts/treasury-proposal/treasury-proposal.test.ts`
- `test/provable/contracts/treasury-pause-controller/treasury-pause-controller.test.ts`
- `test/provable/contracts/treasury-pause-controller/multisig-signatures.test.ts`
- `test/provable/events/treasury-proposal-events.test.ts`
- `test/provable/merkle-tree/prefixed-merkle-tree.test.ts`

### Trace and Replay Behavior

Use `test/proving/tracing/` when the behavior concerns trace generation, recorded witnesses, archive action fetching, or proof-disabled replay preparation.

Representative tests:

- `test/proving/tracing/staking-ledger-to-voting-leder-tracer.test.ts`
- `test/proving/tracing/vote-reducer-tracer.test.ts`

### Worker and Prover Behavior

Use `test/proving/prover/` and `test/proving/tasks/` when the behavior concerns queued proof jobs, proof storage, merge orchestration, or worker task serialization.

Representative tests:

- `test/proving/prover/staking-ledger-to-voting-ledger-prover.test.ts`
- `test/proving/prover/vote-reducer-prover.test.ts`
- `test/proving/tasks/staking-ledger-to-voting-ledger-digest-task.test.ts`
- `test/proving/tasks/staking-ledger-to-voting-ledger-merge-task.test.ts`
- `test/proving/task-queue.test.ts`

### Integration Behavior

Use integration tests when the question spans contracts, services, ledger storage, and transaction construction.

Representative tests:

- `test/integration/treasury-owner.test.ts`
- `test/integration/service-composition.test.ts`

## Debugging Test Failures

When a circuit test fails, first identify whether the failure comes from:

- a failed assertion inside the circuit,
- wrong witness data,
- mismatch between recorded trace and replay context,
- missing compile/setup,
- proof generation timing or worker failure,
- persistent storage from a previous lifecycle.

For trace/prover failures, inspect whether the trace exists, whether proof storage has base proofs, and whether Redis workers are running when the test depends on queued work.

## Related Docs

- [Treasury overview](../user/index.md)
- [Treasury concepts](../user/concepts.md)
- [Workflows](provable/provable-workflows.md)
- [Troubleshooting](troubleshooting.md)
- [Reference](reference/env-and-commands.md)

## Related Specs

- [Provable primitives](../specs/provable/provable-primitives.md)
- [Staking ledger to voting ledger](../specs/provable/staking-ledger-to-voting-ledger.md)
- [Treasury owner](../specs/provable/treasury-owner.md)
- [Treasury pause controller](../specs/provable/treasury-pause-controller.md)
- [Treasury proposal](../specs/provable/treasury-proposal.md)
- [Vote reducer](../specs/provable/vote-reducer.md)
