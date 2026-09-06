---
title: Verifiability and Trust
sidebar_label: Verifiability and Trust
sidebar_position: 12
audience: user
page_kind: concept
---

The treasury combines on-chain rules, proofs, events, and application projections.
Each part answers a different question.

## Mina Account State

Use Mina account state at the recorded canonical block for a material decision.
The Treasury Owner and Proposal accounts contain the state that contract methods enforce.

Important Proposal fields include:

- the recipient hash;
- requested amount;
- lifecycle ID;
- staking-ledger hash and total currency;
- `status`;
- `paidOutAmount`;
- the `zkAppUri` content commitment.

Important Treasury Owner fields include `treasuryDeployedAtSlot` and the Pause Controller public key.
The Treasury Owner balance is the shared balance for treasury funds and bonds.

## What Proofs Establish

The staking-ledger proof transforms the recorded staking ledger into delegate-based voting accounts.
It binds the resulting voting-ledger root to the recorded staking-ledger root.

The Vote Reducer proof applies votes to that voting ledger.
It counts each voter key once and returns `yay`, `nay`, and `abstain` weights.

The tally transaction verifies both proofs.
It then applies the acceptance equations and updates the Proposal status.

These proofs establish the business relations encoded in the programs.
They do not establish the availability of off-chain services.

## Events and Projections

Treasury methods emit events for creation, votes, tallies, executions, and proposal pause toggles.
The indexer reads these events from an Archive source.

The processor converts indexed events into proposal, vote, tally, and execution records.
The App API and web application read those records.

The projection can lag behind the Mina network.
An unavailable service can also make a valid transaction temporarily invisible.

## Proposal Content

The Proposal account commits to a hash derived from the Markdown content.
The App API calculates the same hash before it stores the Markdown.

This check detects content that does not match the commitment.
It does not make the application database permanent public storage.

## A Practical Check

For an important action, keep these values:

- transaction hash;
- Mina network ID;
- Treasury Owner public key;
- Proposal public key;
- relevant block height or state hash;
- expected state fields before and after the action.

First, confirm transaction inclusion.
Next, read the expected account state from the Mina network.
Finally, compare the application projection with that state.

## Sources

- `packages/sdk/src/provable/contracts/treasury-owner.ts` — Treasury Owner state, methods, and events
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts` — Proposal state and proof checks
- `packages/sdk/src/provable/staking-ledger-to-voting-ledger.ts` — `StakingLedgerToVotingLedger`
- `packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts` — `VoteReducer`
- `packages/indexer/src/events-indexer.ts` — `EventsIndexer`
- `apps/api/src/processors/proposals/proposal-created-event-handler.ts` — proposal creation projection
- `apps/api/src/processors/proposals/proposal-votes-tallied-event-handler.ts` — tally projection
- `apps/api/src/proposal-content-routes.ts` — content hash check and storage
