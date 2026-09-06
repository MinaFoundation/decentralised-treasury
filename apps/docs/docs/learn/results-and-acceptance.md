---
title: Results and Acceptance
sidebar_label: Results and Acceptance
sidebar_position: 7
audience: user
page_kind: concept
---

The tally applies a participation requirement and an approval requirement.
Both requirements change with the proposal size.

## Inputs

The equations use these values:

- `proposalAmount` is the requested amount.
- `snapshotTreasuryBalance` is the Treasury Owner balance in the recorded staking ledger.
- `snapshotTotalCurrency` is the recorded staking-ledger total currency.
- `yay`, `nay`, and `abstain` are proved voting weights.
- `10000` basis points equals `100%`.

All divisions use integer arithmetic.
Each division discards its fractional remainder.

## Acceptance Equations

```text
ratioBp =
  min(proposalAmount × 10000 / snapshotTreasuryBalance, 10000)

curve(ratioBp, c) =
  ratioBp × 10000
  / (ratioBp + c × (10000 - ratioBp) / 10000)

requiredParticipationBp =
  2000
  + (5000 - 2000) × curve(ratioBp, 500) / 10000

requiredApprovalBp =
  5100
  + (7000 - 5100) × curve(ratioBp, 1000) / 10000

requiredParticipation =
  snapshotTotalCurrency × requiredParticipationBp / 10000

approvalBp =
  yay × 10000 / (yay + nay)
```

The required participation range is `20%` through `50%`.
The required approval range is `51%` through `70%`.

Larger requests relative to the snapshot treasury balance need stronger support.
The ratio is capped at `100%`.

`abstain` counts toward participation.
It does not appear in the approval denominator.

## Three Tally Outcomes

Every successful tally also needs five distinct, non-initial Proposal action-state hashes.
Each target must occur in the Proposal account action-state history.

This rule can block a tally even when one high-weight vote meets both thresholds.

### Approved

Participation is sufficient, and at least one `yay` or `nay` vote exists.
The `yay` share also meets the required approval value.

The tally succeeds and stores `APPROVED`.

### Rejected

Participation is sufficient, and at least one `yay` or `nay` vote exists.
The `yay` share is below the required approval value.

The tally succeeds and stores `REJECTED`.

### Tally cannot complete

The tally fails when participation is insufficient.
It also fails when all participating weight is `abstain`.
It fails when the five action-state targets do not satisfy the history checks.

In all cases, the transaction does not store `REJECTED`.
The proposal stays `UNKNOWN`.

The operator can omit proof work when no successful state change is useful.
The proposal then also stays `UNKNOWN`.

## Check the Result

1. Wait until the operator submits the tally transaction.
2. Open the proposal in the web application, or run `proposal read-state`.
3. Check the stored Proposal status on the Mina network.
4. Compare the application result with the stored status.
5. If the values differ, wait for the indexer and processor. Check again.

Use this CLI command for a direct Proposal state read:

```bash
pnpm run cli -- proposal read-state \
  --treasury-owner-public-key <TREASURY_OWNER_PUBLIC_KEY> \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --mina-node-url <MINA_GRAPHQL_URL> \
  --network-id <NETWORK_ID>
```

| Stored status | Meaning for the user                                      | Next action                                      |
| ------------- | --------------------------------------------------------- | ------------------------------------------------ |
| `APPROVED`    | The tally completed and the approval condition passed.    | Wait for the next lifecycle, then execute.       |
| `REJECTED`    | The tally completed and the approval condition failed.    | Do not execute.                                  |
| `UNKNOWN`     | No successful tally stored a final result.                | Wait for operator status. Do not execute.        |
| `PAUSED`      | Break-glass control currently blocks Proposal operations. | Wait for the operator. Do not submit operations. |

## Fixed Values

The acceptance values are source constants.
They are not runtime environment settings.

A change to these values requires a rebuild.
It also changes the affected verification keys.

## Next Step

Continue to [Execute an Approved Proposal](execute-a-proposal.md) only when the
stored status is `APPROVED` and the next lifecycle has started.

## Sources

- `packages/sdk/src/provable/contracts/treasury-constants.ts` — acceptance constants and `BASIS_POINTS`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts` — `calculateAcceptanceCriteria`, `calculateApprovalStatus`, `tallyVotes`
- `packages/sdk/src/provable/contracts/treasury-owner.ts` — `tallyVotes`
- `apps/cli/src/commands/proposal.ts` — `proposal read-state`
