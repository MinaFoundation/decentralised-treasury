---
title: Proving and Workers
sidebar_label: Proving and Workers
---

Proof generation is split into tracing, queued proving, worker execution, merge orchestration, and final proof use.

## Staking Ledger To Voting Ledger

Operators hydrate staking ledger JSON, trace digest batches with proofs disabled, queue proof jobs, merge compatible proofs, and prove exhaustion.

## Vote Reducer

Operators fetch proposal actions, trace vote batches, queue run-batch proofs, merge by action continuity, and submit the final proof to tallying.

## Worker Runtime

Workers use Redis-backed task queues and execute proof tasks in child processes. Multiple workers can process the same lifecycle queue when they share Redis and queue naming.

## Source Material

- [Provable workflows](../provable/provable-workflows.md)
- `apps/cli/README.md`
- `packages/sdk/src/proving/`
