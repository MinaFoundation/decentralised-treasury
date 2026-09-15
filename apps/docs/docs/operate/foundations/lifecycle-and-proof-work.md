---
title: Lifecycle And Proof Work
sidebar_label: Lifecycle and proof work
audience: operator
page_kind: concept
---

# Lifecycle And Proof Work

The Treasury lifecycle is both a user schedule and an operator schedule. Users
see four periods. Operators must prepare the data for later periods before the
system needs it.

## The Lifecycle Clock

The Treasury uses Mina global slots. One lifecycle contains four equal
periods:

| Period         | User activity            | Main operator concern                         |
| -------------- | ------------------------ | --------------------------------------------- |
| Proposal       | Create funding requests  | Preserve the exact staking snapshot           |
| Exploration    | Review proposal content  | Confirm proposal and content projections      |
| Voting         | Submit vote actions      | Monitor availability and action ingestion     |
| Cooldown       | Voting is closed         | Build proofs and submit a tally               |
| Next lifecycle | Execute approved amounts | Check status, time gate, and remaining amount |

The configured deployment slot and period duration determine every boundary.
The supported live-network operating convention aligns one Treasury period
with one Mina epoch. The contract checks slot ranges, but it does not check
this epoch alignment.

## Proposal Creation Selects The Proof Data

When a Proposal is created, it records the staking-ledger root and total
currency from Mina network state. The Proposal does not fetch the complete
ledger file.

The operator must preserve the complete ledger that matches the recorded
root. That ledger must contain the default-token Treasury Owner account with a
nonzero balance. It must also contain the delegates that can receive voting
weight.

If the exact ledger is missing, later proof work cannot safely replace it with
a newer ledger. A similar file or a ledger from the same calendar day is not
the same proof input.

## First Proof: Build Voting Weights

The staking-ledger program reads accounts in fixed-size batches. It adds each
eligible balance to its delegate in a voting ledger. The work ends with an
exhaustion proof that shows that the complete selected staking ledger was
processed.

The important chain is:

```text
snapshot file
  -> staking ledger root
  -> traced account batches
  -> merged proof
  -> exhausted proof
  -> voting ledger root
```

Check every root as the data moves through this chain.

## Second Proof: Reduce Proposal Votes

The Vote Reducer reads the ordered action history for one Proposal. It looks
up each voter in the voting ledger, prevents repeated weight through the
nullifier ledger, and accumulates `yay`, `nay`, and `abstain` totals.

Its inputs must identify the same Proposal action range and voting ledger root
that the final tally expects.

## The Tally Joins Both Proofs

The tally transaction supplies both final proofs to the Proposal contract.
The contract connects them to its stored snapshot and action state, then
applies the participation and approval rules.

A proof job can finish successfully and still be unsuitable for a tally. For
example, it can use a different lifecycle, root, verification key, or action
range. Always reconcile public inputs before submission.

## Data Products Need One Lifecycle Identity

The snapshot archive, SQLite state, trace markers, proof files, Redis jobs, and
Proposal state all refer to a lifecycle. Use one lifecycle ID and one snapshot
root across them.

Do not treat a completion marker as sufficient by itself. A marker says that a
stage finished. You must still compare its inputs and outputs with the next
stage.

Use [Ledgers and proving](../proving/ledgers-and-proving.md) for commands and
rebuild steps. Use [Lifecycle configuration](../lifecycle/configuration.md) for
the exact slot equations.

## Sources

- `packages/sdk/src/provable/staking-ledger-to-voting-ledger.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts`
- `packages/sdk/src/proving/`
- `packages/sdk/src/storage/`
- `devops/docker/voting-ledger-scheduler-entrypoint.sh`
- `devops/docker/proving-scheduler-entrypoint.sh`
