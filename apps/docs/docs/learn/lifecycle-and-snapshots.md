---
title: Lifecycle and Staking Snapshots
sidebar_label: Lifecycle and Snapshots
sidebar_position: 3
audience: user
page_kind: concept
---

Treasury activity follows a lifecycle with four equal periods.
Mina global slots determine the current period.

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

The supported scheduler configuration aligns one period with one Mina epoch.
The operator sets `D` to one Mina epoch and sets `S` to an epoch start.

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
