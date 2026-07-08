---
title: Specifications
sidebar_label: Specifications
---

Specifications are the source contracts for the system. They define the concepts, intended behavior, invariants, interfaces, proof IO, state commitments, and acceptance criteria that user and developer documentation translate.

## Recommended Reading Order

1. [Provable primitives](provable/provable-primitives.md)
2. [Treasury owner](provable/treasury-owner.md)
3. [Treasury proposal](provable/treasury-proposal.md)
4. [Treasury pause controller](provable/treasury-pause-controller.md)
5. [Staking ledger to voting ledger](provable/staking-ledger-to-voting-ledger.md)
6. [Vote reducer](provable/vote-reducer.md)

## Traceability

- User proposal lifecycle maps to treasury owner and treasury proposal specs.
- Voting weight maps to staking-ledger-to-voting-ledger and vote reducer specs.
- Pause and emergency governance map to pause controller, owner, and proposal specs.
- Developer proof workflows map to the circuit specs and provable primitives.
