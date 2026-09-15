---
title: Lifecycle and Staking Snapshots
sidebar_label: Lifecycle and Snapshots
sidebar_position: 3
audience: user
page_kind: concept
---

The Treasury follows a fixed schedule with four equal periods. Mina global
slots determine what you can do now and when the next action becomes available.

Read [Mina basics](foundations/mina-basics.md) if global slots or account state
are new terms. Read [Voting and proofs](foundations/voting-and-proofs.md) for
the reason that the Treasury records a staking snapshot.

## The Four Periods

| Period      | Main user activity                   |
| ----------- | ------------------------------------ |
| Proposal    | Create proposals.                    |
| Exploration | Review proposals before voting.      |
| Voting      | Submit `yay`, `nay`, or `abstain`.   |
| Cooldown    | Voting is closed. A tally can occur. |

Execution is separate from these four periods.
An approved proposal becomes executable from the next lifecycle.

## Period Start Equations

The equations use these values:

- `S` is `treasuryDeployedAtSlot`.
- `D` is the lifecycle period duration.
- `L` is the lifecycle ID.

```text
proposal start    = S + 4 × D × L
exploration start = proposal start + D
voting start      = proposal start + 2 × D
cooldown start    = proposal start + 3 × D
next lifecycle    = proposal start + 4 × D
```

The default value of `D` is `7140` slots. Under Mesa, this is one Mina epoch
of `178.5` hours, or `7.4375` days. Four periods are `29.75` days.
The application calculates the current period from `S`, `D`, and the current global slot.

The contract uses a closed Mina slot range for Proposal and Voting operations.
Both the start slot and the end slot are valid. The contract sets the end slot
to `period start + D`. Therefore, the first slot of Exploration also satisfies
the Proposal range. The first slot of Cooldown also satisfies the Voting range.
Submit time-limited operations before these shared boundary slots when
possible.

## Mina Epoch Alignment

The supported live-network operating convention aligns one period with one
Mina epoch. The operator sets `D` to one Mina epoch and sets `S` to an epoch
start.

This alignment is an operator rule.
The Treasury Owner contract does not check epoch alignment.

## What Proposal Creation Records

Proposal creation reads `stakingEpochData` from the transaction network state.
It records the staking-ledger hash and total currency on the Proposal account.

The contract does not calculate a snapshot epoch from the lifecycle ID.
It records the network state that the creation transaction uses.

Later proofs must use the recorded ledger hash.
Later stake or delegation changes do not change that recorded snapshot.

The contract does not check snapshot viability during creation.
Before creation, verify that the exact ledger data is available.
The ledger must contain the default-token Treasury Owner account with a nonzero balance.

## The First Usable Snapshot After Deployment

A newly funded Owner can have a positive current balance and still be absent from the active staking ledger.
Its funding transaction does not rewrite a historical snapshot.
The first usable Proposal needs a recorded ledger containing that Owner with a positive default-token balance.

The startup sequence has these boundaries:

| Stage                  | What must be established                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Schedule selection     | Before deployment, select an epoch-aligned start slot with enough time for funding and snapshot availability.               |
| Deployment and funding | Mina includes the transactions and the current Owner balance is positive. This alone does not establish snapshot readiness. |
| Snapshot availability  | An exported ledger matches the observed staking root and contains the positive Owner entry.                                 |
| Proposal period        | The configured schedule is in a Proposal period, and the ledger used by creation is still verified and available.           |
| Creation check         | The included Proposal records the same root. A changed root requires its own matching ledger check.                         |

For an existing schedule, calculate each Proposal start as `S + 4 × D × L`.
If the first eligible snapshot appears outside a Proposal period, use a later scheduled Proposal period.
Verify that period's active snapshot again. Do not assume that a previously eligible file is still the recorded ledger.
If the Owner entry is absent or zero, postpone creation and check a later authoritative snapshot.

The start slot remains the deployed value. Funding cannot move an existing schedule.
No fixed waiting time follows from the Treasury contracts; readiness depends on the target network's observed staking ledger.
Ask the operator to confirm readiness before you commit a bond for a new deployment.

## Why the Snapshot Matters

The snapshot fixes the data used to calculate voting weight.
It also supplies the eligible currency value for the participation requirement.

The tally uses the Treasury Owner balance from the same recorded staking ledger.
This balance helps set the participation and approval thresholds.

## What Can Happen When

- Create a proposal only during its Proposal period.
- Vote only during its Voting period.
- Tally from its Cooldown period onward.
- Execute from the start of the next lifecycle onward.

## Sources

- `packages/sdk/src/provable/contracts/treasury-owner.ts` — `LIFECYCLE_PERIOD_DURATION`, `LifecyclePeriod`, `getLifecyclePeriodSlotRange`, and `snapshotStakingEpochData`; [MIP6: Reduce slot time to 90s](https://github.com/MinaProtocol/MIPs/blob/main/MIPS/mip-0006-slot-reduction-90s.md)
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts` — `stakingEpochDataLedgerHash`, `stakingEpochDataLedgerTotalCurrency`
- `apps/web/features/treasury/lib/treasury-lifecycle.ts` — lifecycle calculations
- `devops/docker/voting-ledger-scheduler-entrypoint.sh` — lifecycle snapshot scheduling
