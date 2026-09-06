---
title: Lifecycle Configuration
sidebar_label: Lifecycle configuration
audience: operator
page_kind: concept
---

# Lifecycle Configuration

Use [Configure the Treasury](configure-the-treasury.md) to select the lifecycle
values. This page defines timing, epoch alignment, and snapshot selection.

The treasury uses four equal periods in each lifecycle. The default period
duration is `7140` Mina slots. Under Mesa, one slot is `90` seconds. The
default period is therefore one `178.5`-hour Mina epoch, or `7.4375` days.

Use [Voting Capacity and Period Sizing](voting-capacity-and-period-sizing.md)
to compare the voting window with delegate demand, Mina block capacity, and
proof work.

## Slot Equations

Use these terms:

```text
S = treasuryDeployedAtSlot
D = lifecyclePeriodDuration
L = lifecycleId
```

The period boundaries are:

```text
proposal start    = S + 4 * D * L
exploration start = proposal start + D
voting start      = proposal start + 2 * D
cooldown start    = proposal start + 3 * D
next lifecycle    = proposal start + 4 * D
```

Proposal creation is available in the proposal period. Voting is available in
the voting period. Tally is available from cooldown onward. Execution is
available from the next lifecycle onward.

The pinned o1js `requireBetween` precondition uses a closed interval. It
includes the lower and upper slot values. The contract sets the upper value to
`period start + D`. As a result, two bounded periods share one boundary slot:

- Proposal creation is valid from the Proposal start through the Exploration
  start, inclusive.
- Voting is valid from the Voting start through the Cooldown start,
  inclusive.

The UI and scheduler can show the new period at a shared boundary slot while
the preceding contract operation is still valid. Schedule operations away
from the boundary when possible.

## Mina Epoch Alignment

Epoch alignment is an Operator configuration requirement. The contract does
not check it.

The supported scheduler configuration has these rules:

- `D` equals one Mina epoch in slots.
- `S` is the first slot of a Mina epoch.

Do not set `D=14280` only to preserve the former two-week wall-clock period.
Under Mesa, that value spans two Mina epochs and does not fit the supported
snapshot mapping.

The scheduler calculates the required snapshot epoch as follows:

```text
deployedEpoch = floor(S / D)
snapshotEpoch = deployedEpoch + 4 * L
```

For the local Mina runbook, `D=48`. A 30-minute epoch uses `37500` milliseconds
per slot. One treasury lifecycle then lasts `192` slots.

## Snapshot Selection

Proposal creation records two values from the transaction network state:

- the `stakingEpochData` ledger hash;
- the `stakingEpochData` total currency.

The contract does not derive a snapshot epoch from `lifecycleId`. Correct epoch
alignment lets the scheduler select the same staking ledger later.

## Start Slot Effects

A future `S` delays all lifecycle operations. The CLI reports
`lifecycleStarted=false` before the start slot.

A past `S` selects the period given by the slot equations. An old start slot
can require historical staking ledger snapshots.

Do not use `S=0` only because an environment example contains that value.
Select and share an epoch start before deployment.

## Configuration Consistency

Keep these values equal:

| Value | Required consumers                                                         |
| ----- | -------------------------------------------------------------------------- |
| `D`   | compile, deploy, CLI, API, scheduler, web, backoffice                      |
| `S`   | deploy, API, voting-ledger scheduler                                       |
| `L`   | proposal, staking ledger, both proof programs, tally, API witness requests |

Changing `D` changes the compiled contract behavior. Recompile all affected
contracts and distribute the new verification keys.

## Sources

- `packages/sdk/src/provable/contracts/treasury-owner.ts` — lifecycle behavior; [MIP6: Reduce slot time to 90s](https://github.com/MinaProtocol/MIPs/blob/main/MIPS/mip-0006-slot-reduction-90s.md)
- `packages/sdk/src/services/sqlite/sqlite-treasury-owner-service.ts`
- `devops/docker/voting-ledger-scheduler-entrypoint.sh`
- `devops/TESTNET_MINA_NODE.md`
- `apps/cli/README.md`
