---
title: Glossary
sidebar_label: Glossary
sidebar_position: 14
audience: user
page_kind: reference
---

## Acceptance Criteria

The participation and approval requirements that a proposal tally must apply.

## Approval

A successful tally result that stores `APPROVED`.
Approval makes execution possible after the lifecycle condition is met.

## Basis Point

One part of `10000`.
One hundred basis points equals one percent.

## Bond

The amount that creation moves into the shared Treasury Owner balance.
It equals `floor(requestedAmount / 10)` in the current implementation.

## Break-Glass Signer

One of five ordered signer keys for emergency actions.
At least three valid signatures authorize an action.

## Canonical Block

The selected Mina block used as the reference for account state.

## Content Commitment

The `zkAppUri` hash stored with the Proposal account.
It commits to the proposal Markdown without storing that Markdown on-chain.

## Cooldown Period

The fourth lifecycle period.
Voting is closed, and a tally can occur from this period onward.

## Delegate

A Mina public key that receives stake delegation.
The voting ledger groups eligible stake by delegate key.

## Execution

The action that moves shared treasury funds to the fixed recipient of an approved proposal.

## Exploration Period

The second lifecycle period.
It gives users time to review proposals before voting.

## Global Slot

A Mina slot number since genesis.
The treasury uses it to check lifecycle periods.

## Lifecycle

One sequence of Proposal, Exploration, Voting, and Cooldown periods.

## Lifecycle ID

The integer that identifies a lifecycle.
Lifecycle `0` starts at `treasuryDeployedAtSlot`.

## Mina Account State

The state stored for an account on the Mina network.
Treasury contracts use this state for their enforced conditions.

## Operator

The person or organization that runs services, prepares proofs, and submits a tally.

## Participation

The sum of `yay`, `nay`, and `abstain` voting weight.

## Proposal

A funding request with a recipient, requested amount, lifecycle, content commitment, status, and execution progress.

## Proposal Account

A Mina account created under the Treasury Owner token.
It stores the state for one proposal.

## Proposal Period

The first lifecycle period.
New proposals can be created during this period.

## Proposal Status

One of `UNKNOWN`, `APPROVED`, `REJECTED`, or `PAUSED`.

## Projection

Off-chain data that an indexer and processor derive from treasury events.
The web application reads this data.

## Recipient

The public key that can receive an approved proposal's execution funds.

## Reconciliation

The comparison of expected state with Mina account state after a transaction.

## Snapshot Treasury Balance

The Treasury Owner balance in the staking ledger recorded during proposal creation.
The tally uses this balance in its acceptance equations.

## Staking-Ledger Snapshot

The ledger hash and total currency recorded from `stakingEpochData` during proposal creation.

## Tally

The transaction that verifies the ledger and vote proofs.
It stores `APPROVED` or `REJECTED` when its preconditions succeed.

## Treasury Owner

The token contract that holds shared funds and coordinates proposal actions.

## Voting Ledger

The delegate-based ledger derived from the recorded staking ledger.
It supplies voting weights to the Vote Reducer.

## Voting Period

The third lifecycle period.
Users can submit `yay`, `nay`, or `abstain` during this period.

## Voting Weight

The default-token stake that the selected voting ledger assigns to a delegate key.

## Sources

- `packages/sdk/src/provable/contracts/treasury-owner.ts` — treasury and lifecycle terms
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts` — proposal state and actions
- `packages/sdk/src/provable/contracts/treasury-constants.ts` — bond and acceptance terms
- `packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts` — vote reduction terms
- `packages/sdk/src/provable/staking-ledger-to-voting-ledger.ts` — staking and voting ledger terms
- `apps/api/src/processors` — projection records
