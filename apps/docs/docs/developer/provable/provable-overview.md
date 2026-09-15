---
title: Provable Layer Overview
sidebar_label: Provable overview
audience: developer
page_kind: concept
---

# Provable Layer Overview

The provable layer is where Treasury rules become contract checks and proof
relations. `@repo/sdk` owns those zkApps and proof programs together with the
ledger models, storage, services, and workers that support them.

This page assumes that you know the basic difference between normal TypeScript,
a Mina contract method, and a ZkProgram. If you do not, start with
[Mina, o1js, and proofs](../foundations/mina-o1js-and-proofs.md).

## On-chain Contracts

| Contract          | Responsibility                                                                         |
| ----------------- | -------------------------------------------------------------------------------------- |
| Treasury Owner    | Own Treasury funds, lifecycle rules, Proposal creation, tally dispatch, and execution. |
| Treasury Proposal | Store request data, accept vote actions, verify tally inputs, and store a result.      |
| Pause Controller  | Verify threshold signatures for pause and participant changes.                         |

The Treasury Owner deploys Proposal child accounts under its derived token.
The Pause Controller address is bound into the Treasury Owner configuration.

## Proof Programs

| Program                         | Responsibility                                                  |
| ------------------------------- | --------------------------------------------------------------- |
| Staking Ledger to Voting Ledger | Convert a Mina staking snapshot into delegated voting balances. |
| Vote Reducer                    | Reduce ordered vote actions and enforce first-vote nullifiers.  |

The Proposal contract verifies both proof types during tallying. Verification
keys are compile-time dependencies.

## Off-chain Support

Ledger classes model staking accounts, voting balances, and nullifiers. SQLite
adapters persist lifecycle data and proof progress.

Tracing creates deterministic proof tasks. Redis workers execute tasks and
store results for merging.

## Main Source Areas

| Area                | Path                                   |
| ------------------- | -------------------------------------- |
| Contracts           | `packages/sdk/src/provable/contracts/` |
| Proof programs      | `packages/sdk/src/provable/`           |
| Ledgers             | `packages/sdk/src/ledgers/`            |
| Storage             | `packages/sdk/src/storage/`            |
| Services            | `packages/sdk/src/services/`           |
| Tracing and workers | `packages/sdk/src/proving/`            |

Read [Provable architecture](provable-architecture.md) for dependency and trust
boundaries. Read [Provable workflows](provable-workflows.md) for data movement.

The Operator [technical reference](../../operate/reference/index.md) contains
the detailed contract methods, checks, events, constants, and acceptance rules.

## Sources

- `packages/sdk/README.md`
- `packages/sdk/src/provable/contracts/treasury-owner.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts`
- `packages/sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.ts`
- `packages/sdk/src/provable/staking-ledger-to-voting-ledger.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts`
