---
title: Provable Workflows
sidebar_label: Provable Workflows
---

This page explains the main workflows maintainers and operators use when working with SDK provable code. It focuses on how work moves through the system, not on the spec-defined proof IO and verification rules.

## Staking Ledger to Voting Ledger

This workflow creates a proof that converts Mina staking ledger accounts into delegate voting weights.

### 1. Prepare the staking ledger

The operator hydrates Mina staking ledger JSON into the SDK staking ledger storage. Once hydrated, the staking ledger can provide accounts, Merkle witnesses, and the staking root used by later steps.

### 2. Trace digest segments

Tracing dry-runs digest segments with proofs disabled. Each segment reads a fixed batch of staking accounts, updates the voting ledger, and records the witnesses needed to replay the segment later.

The trace includes enough data for a proving worker to reconstruct the same public input and witness reads without depending on live mutable context.

### 3. Prove digest segments

The prover reads stored traces and queues digest proof tasks. Workers replay each trace with proofs enabled and persist one base proof per trace.

### 4. Merge proofs

Merge orchestration finds adjacent proofs and queues merge jobs. The process repeats until one merged proof covers the prepared digest range.

### 5. Prove exhaustion

The final step proves that the next staking ledger position after the processed range is empty. The resulting side-loaded proof is ready for proposal tallying.

## Vote Reducer

This workflow creates a proof that reduces proposal vote actions into weighted totals.

### 1. Fetch or provide proposal actions

Vote actions can be supplied directly or fetched from an Archive node. When fetching from Archive, the service also resolves the proposal action-state history target used during tracing.

### 2. Trace vote batches

The tracer batches vote actions, pads short batches with dummy actions, and dry-runs the vote reducer with proofs disabled. Recording ledgers capture voting-account witnesses, nullifier witnesses, voting accounts, and nullifier values.

### 3. Prove vote batches

The prover queues one run-batch proof task per trace. Workers replay traces with proofs enabled and store base proofs.

### 4. Merge by action continuity

Vote reducer merge orchestration pairs proofs by action-hash continuity. A proof whose output action hash matches another proof's input action hash can be merged.

### 5. Use the merged proof in tallying

The final vote reducer proof is passed to treasury proposal tallying together with the staking-to-voting proof.

## Worker Runtime

Proof jobs run through a Redis-backed task queue. The queue stores serialized task input, and workers run tasks in child processes. This isolates long-running proof work from the queue process and lets proof tasks be retried.

The queue runtime is used for:

- staking-to-voting digest proof tasks,
- staking-to-voting merge tasks,
- vote reducer run-batch tasks,
- vote reducer merge tasks.

## SQLite Operator Services

Most callers should use services instead of manually wiring ledgers, storage, tracers, provers, and queues.

The SQLite staking-to-voting service starts storage, prepares ledgers, traces digest segments, proves digest segments, merges proofs, and runs exhaustion.

The SQLite vote reducer service starts voting/nullifier ledgers, can fetch proposal actions, traces vote batches, proves batches, merges proofs, and can clear persistent reducer state for a lifecycle.

The treasury owner service compiles the proof stack and drives owner-level transactions such as tallying and execution.

## Related Docs

- [Treasury overview](../../user/index.md)
- [Proposal lifecycle](../../user/proposal-lifecycle.md)
- [Voting and results](../../user/voting-and-results.md)
- [Architecture](provable-architecture.md)
- [Testing](../testing.md)
- [Reference](../reference/env-and-commands.md)
- [Troubleshooting](../troubleshooting.md)

## Related Specs

- [Staking ledger to voting ledger](../../specs/provable/staking-ledger-to-voting-ledger.md)
- [Vote reducer](../../specs/provable/vote-reducer.md)
- [Treasury owner](../../specs/provable/treasury-owner.md)
- [Treasury proposal](../../specs/provable/treasury-proposal.md)
