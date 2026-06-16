---
sidebar_label: Proposal Journey
---

# Proposal Journey

A treasury proposal moves from an idea to a funding outcome through a sequence of visible stages. The journey is designed so participants can understand what is being requested, how voting affects the result, and when funds can be released.

## 1. Proposal Creation

A proposal starts as a funding request during the proposal period. It identifies the recipient, requested amount, and proposal details. Once created, it becomes a public item that participants can track.

At this stage, users care about:

- what the proposal funds,
- who receives the payout,
- how much is requested,
- whether the proposal is still in the creation window.

Creating a proposal also locks a proposal deposit tied to the requested amount. The same deposit amount is part of the payout cap, so the maximum proposal payout is the requested amount plus the deposit amount.

## 2. Exploration

After proposal creation, the treasury calendar includes an exploration period before voting. This gives participants time to review the request before votes are collected.

## 3. Voting

Participants vote yay, nay, or abstain during the voting period. Voting is weighted by delegated Mina stake, so the result is not a simple count of submitted votes.

The proposal uses the delegation picture selected for that voting round. Later delegation changes do not change the voting weight already used for that proposal.

## 4. Cooldown and Vote Counting

Vote counting waits until voting has ended and the treasury calendar reaches cooldown. The count converts the collected votes into proposal totals. Each voter is counted once, and the result separates yay, nay, and abstain support.

The result determines whether the proposal is approved or rejected according to the treasury approval rules.

## 5. Approval or Rejection

An approved proposal becomes eligible for payment. A rejected proposal cannot release funds.

Approval is not the same as payout. It means the proposal passed the required checks and can move to the payment step.

## What Counts as Approved

Approval depends on both participation and support:

- enough voting weight needs to participate for the result to be valid,
- at least one yay or nay vote needs to be present,
- yay votes need to meet the required share among yay and nay votes.

Abstain votes count toward participation, but they do not count as yay support.

The required participation and approval levels depend on the proposal size, treasury balance, and voting weight available for that round. Larger proposals can require stronger participation or approval.

## 6. Payment

Payment releases treasury funds to the proposal recipient in a later calendar window. A proposal can be paid in parts, so payout progress includes how much has already been paid and how much remains.

The payment step is where the approved decision becomes a treasury balance movement. The total payout cannot exceed the proposal amount plus the proposal deposit.

## 7. Pause Handling

The treasury can be globally paused through its emergency governance process. When globally paused, treasury actions that would normally proceed can be blocked until the pause state is changed.

An individual proposal can also be paused. A single-proposal pause does not erase the proposal or its votes, but it can block actions for that proposal until it is toggled back.

Pause state is a treasury safety signal: it affects whether calendar actions are available.

## Related Docs

- [Treasury concepts](concepts.md)
- [Voting and results](voting-and-results.md)
