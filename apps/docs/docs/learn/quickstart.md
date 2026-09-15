---
title: User Quickstart
sidebar_label: Quickstart
audience: user
page_kind: quickstart
---

# User Quickstart

Your first visit can be read-only. You can learn the current period, open a
proposal, and check its status before you connect a wallet or submit a
transaction.

## Before You Start

You need a current browser. You need a compatible Mina wallet only when you
want to create, vote, or execute. The wallet must use the same Mina network as
the Treasury application.

A transaction can use MINA for its network fee. Proposal creation also uses a
bond. Read the confirmation in your wallet before you approve any transaction.

Use [Signing with Ledger and Auro](signing-with-ledger-and-auro.md) to select a
supported wallet and prepare it before your first transaction.

## Confirm The Deployment

Follow [Check your Treasury deployment](check-your-deployment.md) before connecting a wallet.
The default **Open local demo** link needs a Treasury running on your own machine.
For a shared deployment, obtain the application URL, public configuration record, and support contact from its operator.

## Take A Read-Only Tour

1. Select **Open Treasury**, or **Open local demo** after starting the local application.
2. Check the network and the current lifecycle period.
3. Open one proposal.
4. Find its requested amount, recipient, lifecycle, and status.
5. Read the proposal content and note its content-check status.

You now have the four facts that answer most first questions: what is
requested, who can receive it, when the decision occurs, and whether a final
result exists.

## Select One Action

Do not try to complete every stage during one visit. The lifecycle controls
which action is valid.

| Current condition                       | Useful next action                              |
| --------------------------------------- | ----------------------------------------------- |
| Proposal period                         | [Create a proposal](create-a-proposal.md)       |
| Exploration period                      | Review the proposal and its exact content       |
| Voting period                           | [Verify the content and vote](vote.md)          |
| Cooldown, with no final result          | Wait for the tally                              |
| Final result available                  | [Check the result](results-and-acceptance.md)   |
| Approved and next lifecycle has started | [Execute proposal funds](execute-a-proposal.md) |
| Treasury or proposal is paused          | [Read the pause behavior](pause-behavior.md)    |

If an action is unavailable, first check the period, network, wallet account,
and pause state. Do not repeatedly submit the same transaction while its first
result is unknown.

## Check What Happened

After a transaction, keep its hash. Wait until the application shows the new
state. For an important action, compare that display with the Proposal or
Treasury Owner account on Mina.

The application can be behind Mina while the indexer and processor catch up.
A temporary difference does not always mean that the transaction failed.

## Learn The Terms When You Need Them

- [Mina basics](foundations/mina-basics.md) explains accounts, wallets,
  transactions, zkApps, proofs, and slots.
- [The Treasury model](foundations/treasury-model.md) explains the shared
  balance, Proposal accounts, bonds, and delayed execution.
- [Voting and proofs](foundations/voting-and-proofs.md) explains where voting
  weight comes from.
- [On-chain and off-chain data](foundations/on-chain-and-off-chain.md) explains
  which view controls each decision.

## Sources

- `apps/web/README.md`
- `apps/web/features/treasury/`
- `apps/web/features/proposals/`
- `packages/ui/src/treasury-proposal-detail.tsx`
- `packages/sdk/src/provable/contracts/treasury-owner.ts`
