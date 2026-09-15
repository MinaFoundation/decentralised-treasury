---
title: On-Chain And Off-Chain Data
sidebar_label: On-chain and off-chain
audience: user
page_kind: concept
---

# On-Chain And Off-Chain Data

The Treasury has two connected views. Mina stores the state that the contracts
enforce. Off-chain services turn Mina events and proposal content into pages
that are easier to search and read.

You need both views, but they do different jobs.

## On-Chain Means Mina Account State

“On-chain” data is part of Mina state or a Mina transaction. Treasury
contracts use this data when they decide whether an action is valid.

Important on-chain facts include:

- Treasury and Proposal addresses;
- lifecycle configuration;
- requested amount and recipient commitment;
- staking snapshot values;
- Proposal status and execution progress;
- global and Proposal pause state;
- the commitment to proposal content.

For a material decision, read this state from a selected canonical Mina block.

## Off-Chain Services Make The State Usable

The Archive service exposes blocks, events, and actions. The Treasury indexer
reads those records. The processor converts typed events into proposal, vote,
tally, and execution views. APIs serve the views to the web application.

These services help you list proposals, search records, read Markdown, and see
the lifecycle in a useful form. They can lag behind Mina or briefly show a
pending result.

## Proposal Content Connects Both Views

Proposal Markdown is too large and unsuitable for direct storage in the
Proposal account. The creator therefore submits the Markdown to an application
service and puts a hash-based content commitment in the Mina transaction.

The commitment works like a fingerprint for the exact Markdown bytes. If one
character changes, the calculated commitment changes.

The web application can compare its stored content with its projected
commitment. For an independent check, calculate the commitment from the exact
Markdown and compare it with the Proposal token account `zkAppUri` on Mina.

## One Fact Can Appear At Different Times

Suppose Mina accepts a vote transaction.

1. The Proposal account and Archive data reflect the accepted transaction.
2. The indexer reads the Archive range.
3. The processor updates its proposal and vote views.
4. The API returns the new view.
5. The browser refreshes its display.

The layers do not update at the same instant. If the browser has not changed,
do not immediately submit the same transaction again. First check its hash and
Mina state.

## Select The Correct Source For The Question

| Question                                 | Primary place to check                        |
| ---------------------------------------- | --------------------------------------------- |
| Did Mina accept my transaction?          | Transaction result on the Mina network        |
| What status controls Proposal execution? | Proposal account state                        |
| What exact content did I review?         | Markdown plus its on-chain content commitment |
| Which proposals are easy to browse?      | Application projection                        |
| Is the application caught up?            | Indexer and processor status                  |

The [Verifiability and trust](../verifiability-and-trust.md) page gives the
full checks for important decisions. You can now continue to
[How the Treasury works](../how-it-works.md).

## Sources

- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts`
- `packages/sdk/src/provable/events/`
- `packages/indexer/src/`
- `packages/processor/src/`
- `apps/api/src/processors/proposals/`
- `apps/api/src/proposal-content-routes.ts`
- `apps/web/features/proposals/`
