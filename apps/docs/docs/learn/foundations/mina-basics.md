---
title: Mina Basics For Treasury Users
sidebar_label: Mina basics
audience: user
page_kind: concept
---

# Mina Basics For Treasury Users

You do not need prior blockchain knowledge to understand the Treasury. Start
with five ideas: network state, accounts, keys, transactions, and slots.

## Mina Is A Shared Record

Mina is the network on which the Treasury runs. The network keeps account
state. Account state includes balances and can also include data for a smart
contract.

The network groups accepted transactions into blocks. When you check an
important result, you select a recent canonical block and read the account
state at that block.

## An Account Has An Address

A Mina public key identifies an account. People often call this public key an
address. You can share it so that another person can find the account or send
funds to it.

A private key controls the account. A wallet protects this key and asks you to
approve a signature. Never put a private key in proposal content, a support
message, or a command that another person supplied.

The Treasury uses several accounts:

- the Treasury Owner account holds shared funds and coordinates proposals;
- each Proposal account stores the state for one funding request;
- normal Mina accounts submit transactions or receive funds.

## A Transaction Requests A State Change

A transaction asks the network to change state. For example, it can create a
proposal, record a vote action, tally votes, or execute part of an approved
amount.

The network accepts a transaction only when its signatures, proofs,
permissions, and state conditions are valid. A wallet approval means that you
signed the request. It does not guarantee that the network accepted it.

Keep the transaction hash. It lets you find the result later.

## A zkApp Applies Programmed Rules

Mina calls a smart-contract application a zkApp. A zkApp method checks rules
before it changes account state.

The Treasury zkApps check facts such as the current period, pause state,
proposal result, recipient, requested amount, and execution limit. These
checks run as part of the Mina transaction flow.

A zero-knowledge proof can show that a defined calculation followed its
program without putting every calculation step in the transaction. In this
Treasury, proofs connect a recorded staking ledger and recorded vote actions
to the final tally inputs.

## A Slot Is Mina's Time Unit

The Treasury does not use a calendar date directly. It uses Mina global slots.
A global slot is a numbered position in the Mina schedule.

The Treasury groups slots into four periods: Proposal, Exploration, Voting,
and Cooldown. This is why an action can be valid now and invalid after the
network moves to another slot.

## How These Ideas Fit Together

| Mina idea   | Treasury example                                      |
| ----------- | ----------------------------------------------------- |
| Account     | Treasury Owner or one Proposal                        |
| Public key  | Proposal address, voter address, or recipient address |
| Transaction | Create, vote, tally, or execute                       |
| zkApp rule  | Permit a vote only during the Voting period           |
| Proof       | Show the voting weights and reduced vote totals       |
| Global slot | Determine the current lifecycle period                |

Next, read [The Treasury model](treasury-model.md). It builds the funding
process from these Mina ideas.

## Sources

- `packages/sdk/src/provable/contracts/treasury-owner.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts`
- `packages/sdk/src/provable/staking-ledger-to-voting-ledger.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts`
- `packages/local-blockchain/README.md`
