---
title: Frequently Asked Questions
sidebar_label: FAQ
sidebar_position: 13
audience: user
page_kind: reference
---

## Why Does Voting Use Delegated Stake?

The system transforms a recorded Mina staking ledger into voting accounts keyed by delegate.
This process gives each delegate key the aggregated default-token stake delegated to it.

## Can I Vote More Than Once?

The transaction can dispatch more than one action from the same voter key.
The proof logic counts that key's voting weight only once.

The first counted vote fixes the counted position.
A later action does not add or move that voting weight.

## How Does `abstain` Work?

`abstain` adds voting weight to participation.
It does not add weight to the `yay` or `nay` approval denominator.

## Why Is a Proposal Still `UNKNOWN` After Voting?

The operator might not have submitted a successful tally.
The tally also fails when participation is insufficient or all weight is `abstain`.

The Owner also checks five distinct, non-initial Proposal action-state hashes.
Too little action-state history can prevent a tally even when one voter has enough weight.

These failures do not store `REJECTED`.
The proposal stays `UNKNOWN`.

## Why Can an Approved Proposal Be Unable to Execute?

Execution starts only in the next lifecycle.
A global pause or Proposal pause can also block execution.

The shared treasury balance can be too low.
Approval does not reserve funds for a proposal.

## Is the Bond Returned?

No current contract method refunds the bond.
The bond enters the shared Treasury Owner balance.

If the proposal is executed, its recipient can receive the request plus the bond component.
A rejected or unresolved proposal leaves the bond in the shared balance.

## Can the Recipient Differ from the Bond Payer?

Yes.
The recipient is fixed in the proposal, but the signed bond payer can be another account.

The current web and CLI builders use the sender as the bond payer.

## Can a Proposal Execute More Than Its Request?

Yes, but only by the bond component.
The total cap is `requestedAmount + floor(requestedAmount / 10)`.

## Who Can Submit Execution?

The smart contract accepts any valid signed sender with the required inputs.
The current web application enables execution only for the recorded proposal creator.

Use the [CLI](./cli) when another sender must submit the transaction.

## What Happens When Content Upload Fails?

The on-chain proposal still exists.
The content commitment remains in its Proposal account.

The web application keeps a local retry record.
Use **Retry content upload** when the proposal page offers it.

## Why Can the Web Application Be Behind?

The indexer must read Archive data, and the processor must update its records.
This process can finish after the Mina state changes.

Check Mina account state directly when the result is material or uncertain.

## What Does Proposal Pause Do to a Final Result?

A toggle changes any non-`PAUSED` status to `PAUSED`.
The next toggle changes `PAUSED` to `UNKNOWN`.

It does not restore `APPROVED` or `REJECTED`.
A new successful tally is necessary before execution.

## Sources

- `packages/sdk/src/provable/contracts/treasury-owner.ts` — lifecycle guards and treasury methods
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts` — tally, execution, and pause behavior
- `packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts` — first-vote counting
- `packages/sdk/src/provable/contracts/treasury-constants.ts` — bond and acceptance constants
- `apps/web/features/proposals/containers/proposal-detail-page-container.tsx` — web vote and execution flows
- `apps/web/features/proposals/lib/proposal-content-retry-store.ts` — content retry state
- `apps/api/src/proposal-content-routes.ts` — proposal content checks
