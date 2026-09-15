---
title: Voting And Proofs
sidebar_label: Voting and proofs
audience: user
page_kind: concept
---

# Voting And Proofs

A Treasury vote is not one-person-one-vote. Its weight comes from Mina stake
that was delegated to the voting public key in a recorded staking-ledger
snapshot.

This page explains each part of that sentence.

## Stake And Delegation

MINA holders can delegate stake to a Mina public key. A delegate represents
that stake in the staking ledger. Delegation does not give the delegate the
private keys or MINA balances of the delegators.

For Treasury voting, the delegate public key is the voter identity. Its voting
weight is the eligible default-token stake grouped under that key.

A public key with no weight in the selected snapshot can submit a vote action,
but that action contributes zero voting weight.

## Why The Treasury Uses A Snapshot

Stake and delegation can change over time. A vote needs one fixed data set so
that its weight does not change while votes are being counted.

When a Proposal is created, it records a staking-ledger root and total
currency from Mina network state. The root is a compact commitment to the
complete staking ledger. Later proof work must start from that exact root.

The snapshot also records the historical Treasury Owner balance that the tally
uses when it calculates how much support the request needs.

## From Staking Ledger To Voting Ledger

The staking ledger is organized around Mina accounts. The voting ledger is
organized around delegate public keys.

The first proof program processes the staking accounts and adds each eligible
balance to its delegate. The final result is a voting ledger in which each
delegate has one voting weight.

The proof also shows that processing reached the end of the selected staking
ledger. This prevents an incomplete prefix from being treated as the complete
snapshot.

## What A Vote Records

During the Voting period, a voter signs one of three choices:

- `yay` supports the request;
- `nay` opposes the request;
- `abstain` participates without choosing either side.

The Proposal stores votes as ordered Mina actions. A second proof program
reads these actions, looks up each voter in the voting ledger, and calculates
the totals.

The reducer uses a nullifier ledger so that only the first valid vote from one
voter contributes weight. Later votes from the same key do not add the weight
again.

## What The Tally Decides

The tally verifies both final proofs. It then checks two different conditions:

1. **Participation:** enough weight submitted `yay`, `nay`, or `abstain`.
2. **Approval:** enough of the `yay + nay` weight is `yay`.

`abstain` counts toward participation but not toward the approval percentage.
Larger requests, relative to the recorded Treasury balance, require stronger
participation and approval.

If participation passes but approval does not, a successful tally stores
`REJECTED`. If a required tally precondition does not pass, the transaction can
fail and the Proposal can stay `UNKNOWN`.

## What The Proofs Do And Do Not Say

The proofs show that their defined calculations match their public inputs.
They let the Proposal contract check large ledger and vote calculations
through compact proof inputs.

The proofs do not say that the proposal text is useful, that the recipient is
trustworthy, or that the selected snapshot matches an external policy. People
must still review the request, and the operator must still select and preserve
the correct snapshot data.

Continue to [On-chain and off-chain data](on-chain-and-off-chain.md) to learn
where each part of the visible Treasury record comes from.

## Sources

- `packages/sdk/src/provable/staking-ledger-to-voting-ledger.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts`
- `packages/sdk/src/provable/account.ts`
- `packages/sdk/src/provable/voting-account.ts`
- `packages/sdk/src/ledgers/`
