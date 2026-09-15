---
title: The Treasury Model
sidebar_label: The Treasury model
audience: user
page_kind: concept
---

# The Treasury Model

The Treasury turns one question into a controlled process: should shared funds
go to this recipient for this request?

Three contract parts divide the work. The Treasury Owner coordinates the
process and holds the shared balance. A Proposal account records one request.
The Pause Controller can authorize emergency pause actions.

## The Treasury Owner Is The Shared Center

The Treasury Owner is a Mina zkApp account. It holds the shared MINA balance
and defines the lifecycle timing. It also creates Proposal accounts under its
token and coordinates vote, tally, and execution transactions.

The name “Owner” describes the contract role. It does not mean that one person
can freely decide where the funds go. Normal execution must satisfy the
contract rules.

## One Proposal Is One Funding Record

Each Proposal account records the fixed facts for one request:

- proposal address;
- lifecycle ID;
- requested amount;
- recipient commitment;
- content commitment;
- staking-ledger snapshot values;
- status and execution progress.

The full proposal text is Markdown. An application service stores that text.
The Mina account stores a hash-based commitment to the exact bytes. If the
text changes, its commitment also changes.

## Creation Includes A Bond

Proposal creation moves a bond into the shared Treasury Owner balance. The
current bond is one tenth of the requested amount, with integer rounding.

The bond is not kept in a separate Proposal account. It becomes part of the
shared Owner balance. The current execution cap includes the requested amount
and the bond.

Before you create a proposal, treat the bond as a real transfer. Check the
amount and network in the wallet confirmation.

## Time Separates Review, Decision, And Funds

One lifecycle has four periods:

1. **Proposal:** creators submit requests.
2. **Exploration:** the community reviews the requests.
3. **Voting:** eligible keys submit votes.
4. **Cooldown:** voting closes and a tally can occur.

An approved Proposal cannot execute until the next lifecycle starts. This
delay keeps approval separate from the later movement of funds.

## Approval Is Not The Same As Execution

A successful tally stores `APPROVED` or `REJECTED`. If a tally cannot satisfy
its preconditions, the Proposal can remain `UNKNOWN`.

An `APPROVED` status makes execution possible after the time gate. It does not
send funds by itself. A later transaction names an amount and the fixed
recipient. Execution can occur in parts, but the recorded total cannot pass
the Proposal execution cap.

## A Small Example

Suppose a creator requests funds for a public project.

1. The creator publishes the request, recipient, and content commitment.
2. The community reviews the same content during Exploration.
3. Eligible stake votes during Voting.
4. The operator prepares proofs and submits a tally during or after Cooldown.
5. If the stored result is `APPROVED`, a person can submit an execution
   transaction after the next lifecycle starts.
6. The Treasury Owner sends only the permitted amount to the fixed recipient.

The [complete flow](../how-it-works.md) adds the service and proof details.
First, read [Voting and proofs](voting-and-proofs.md).

## Sources

- `packages/sdk/src/provable/contracts/treasury-owner.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts`
- `packages/sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.ts`
- `packages/sdk/src/provable/contracts/treasury-constants.ts`
- `packages/sdk/src/utils/proposal-content-hash.ts`
