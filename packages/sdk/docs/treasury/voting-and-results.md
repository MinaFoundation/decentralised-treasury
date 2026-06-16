---
sidebar_label: Voting and Results
---

# Voting and Results

Treasury voting answers one practical question: does a proposal have enough support to release funds?

## Where Voting Weight Comes From

Voting weight comes from delegated Mina stake. If more stake is delegated behind a voter, that voter carries more weight in the result.

In user terms:

- stake delegated to a voter contributes to that voter's voting weight,
- the voting round uses one selected view of delegation,
- the voting result depends on that selected view, not on later delegation changes.

## How Votes Are Counted

Each vote contributes to one of three totals:

- yay,
- nay,
- abstain.

The count tracks which voters have already participated so repeated votes cannot inflate the result.

## What A Result Means

The result is a proposal status, not just a set of numbers. After votes are counted, the proposal can become approved or rejected.

An approved proposal can move to payment. A rejected proposal remains part of the treasury history but cannot release the requested funds.

## What Counts as Approved

Approval depends on both participation and support:

- enough voting weight needs to participate,
- yay votes need to meet the required share among yay and nay votes,
- abstain votes count toward participation but not toward yay support.

The required support levels depend on proposal size, treasury balance, and the voting weight available for that round.

## Why The Result Can Be Checked

Users do not need to repeat the full count themselves. The system is designed so the final result can be checked against the rules of the treasury.

For users, the outcome is a result that can be trusted without asking every participant to repeat all the work.

## Related Docs

- [Treasury concepts](concepts.md)
- [Proposal lifecycle](proposal-lifecycle.md)
