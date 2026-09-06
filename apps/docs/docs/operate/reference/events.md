---
title: Events
sidebar_label: Events
sidebar_position: 10
audience: operator
page_kind: reference
---

# Events

`TreasuryOwnerSmartContract.events` defines five event types. The Indexer discovers events, and the Processor builds projections.

## Authority

Events help discovery and projection. Mina account state at the recorded canonical block is the state authority.

Reconcile each material state transition on the Mina network.

## `proposalCreated`

`ProposalCreatedEvent` contains:

| Field | Type | Meaning |
| --- | --- | --- |
| `proposalPublicKey` | `PublicKey` | New Proposal account key. |
| `lifecycleId` | `UInt32` | Proposal lifecycle. |
| `amount` | `UInt64` | Requested amount. |
| `recipient` | `PublicKey` | Committed recipient. |
| `zkAppUriHash` | `Field` | Proposal content commitment. |
| `stakingEpochDataLedgerHash` | `Field` | Creation-time staking ledger root. |
| `stakingEpochDataLedgerTotalCurrency` | `UInt64` | Creation-time staking total currency. |
| `proposerPublicKey` | `PublicKey` | Current builder sender. |
| `senderPublicKey` | `PublicKey` | Signed transaction sender. |

The current contract sets `proposerPublicKey` and `senderPublicKey` to the same sender.

## `proposalVoteDispatched`

`ProposalVoteDispatchedEvent` contains:

| Field | Type | Meaning |
| --- | --- | --- |
| `proposalPublicKey` | `PublicKey` | Target Proposal. |
| `voterPublicKey` | `PublicKey` | Signed voter key. |
| `vote` | `Vote` | Vote enum value. |
| `senderPublicKey` | `PublicKey` | Signed transaction sender. |

The event does not contain voting weight. The Vote Reducer derives weight later.

## `proposalVotesTallied`

`ProposalVotesTalliedEvent` contains:

| Field | Type | Meaning |
| --- | --- | --- |
| `proposalPublicKey` | `PublicKey` | Tallied Proposal. |
| `lifecycleId` | `UInt32` | Proposal lifecycle. |
| `yayWeight` | `UInt64` | Weighted `yay` total. |
| `nayWeight` | `UInt64` | Weighted `nay` total. |
| `abstainWeight` | `UInt64` | Weighted abstain total. |
| `voteResult` | `Field` | Stored Proposal status value. |
| `senderPublicKey` | `PublicKey` | Signed transaction sender. |

This event exists only when tally succeeds. Low participation and abstain-only tallies do not emit it.

## `proposalExecuted`

`ProposalExecutedEvent` contains:

| Field | Type | Meaning |
| --- | --- | --- |
| `proposalPublicKey` | `PublicKey` | Executed Proposal. |
| `amountToPayOut` | `UInt64` | Amount in this partial or complete execution. |
| `senderPublicKey` | `PublicKey` | Signed transaction sender. |

The event does not contain the recipient or cumulative `paidOutAmount`. Read the Proposal and recipient accounts.

`amountToPayOut` can be zero. A zero event does not prove that a balance or `paidOutAmount` changed.

## `proposalPauseToggled`

`ProposalPauseToggledEvent` contains:

| Field | Type | Meaning |
| --- | --- | --- |
| `proposalPublicKey` | `PublicKey` | Target Proposal. |
| `paused` | `Bool` | Caller-supplied event value. |
| `senderPublicKey` | `PublicKey` | Signed transaction sender. |

:::warning Caller-supplied field

The contract does not bind `paused` to the resulting Proposal status. Do not use it as authoritative state.

Reconcile `status` on the Proposal account after the transaction.

:::

## Projection mapping

| Event | Processor handler | Main projection |
| --- | --- | --- |
| `proposalCreated` | `ProposalCreatedEventHandler` | Proposal record. |
| `proposalVoteDispatched` | `ProposalVoteDispatchedEventHandler` | Vote record. |
| `proposalVotesTallied` | `ProposalVotesTalliedEventHandler` | Vote tally and Proposal status. |
| `proposalExecuted` | `ProposalExecutedEventHandler` | Execution record. |
| `proposalPauseToggled` | `ProposalPauseToggledEventHandler` | Projected pause status. |

Indexer and Processor cursors support replay. They do not change contract state.

## Sources

- `packages/sdk/src/provable/events/treasury-proposal-events.ts`
- `packages/sdk/src/provable/contracts/treasury-owner.ts`
- `packages/indexer/src/events-indexer.ts`
- `apps/api/src/processors/proposals/proposal-created-event-handler.ts`
- `apps/api/src/processors/proposals/proposal-vote-dispatched-event-handler.ts`
- `apps/api/src/processors/proposals/proposal-votes-tallied-event-handler.ts`
- `apps/api/src/processors/proposals/proposal-executed-event-handler.ts`
- `apps/api/src/processors/proposals/proposal-pause-toggled-event-handler.ts`
- `apps/api/test/proposal-created-processor.test.ts`
- `apps/api/test/proposal-vote-processor.test.ts`
- `apps/api/test/proposal-votes-tallied-processor.test.ts`
- `apps/api/test/proposal-executed-processor.test.ts`
- `apps/api/test/proposal-pause-toggled-processor.test.ts`
