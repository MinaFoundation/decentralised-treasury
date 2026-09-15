---
title: Treasury Overview
sidebar_label: Two-minute overview
audience: user
page_kind: overview
---

# Treasury Overview

The Mina Decentralized Treasury is a public process for deciding how to use
shared funds. A person proposes work, the community reviews it, eligible Mina
stake votes, and the Treasury records the result. In the normal proposal flow,
funds can move only after an approved result and a later lifecycle boundary.

## The Complete Idea In Six Steps

1. A creator asks for an amount and names a recipient.
2. The Treasury records a commitment to the proposal content on Mina.
3. The community gets time to review the request.
4. Voters submit `yay`, `nay`, or `abstain`.
5. Proofs calculate voting weight and totals from a recorded staking snapshot.
6. If the result is approved, a later transaction can move funds to the fixed
   recipient.

The decision and the movement of funds are separate actions. An approval does
not make an immediate payment.

## What Makes The Result Checkable

The Treasury uses Mina account state for the rules that control status and
funds. It uses proofs to connect the tally to the recorded staking ledger and
vote actions. It also emits events that services turn into pages and API
responses.

The web application makes the process easier to use. It is not the final
authority for a material decision. You can compare its result with Mina
account state.

## What You Can Do

| Goal              | When it is available                          |
| ----------------- | --------------------------------------------- |
| Create a proposal | Proposal period                               |
| Review content    | At any time after the proposal is available   |
| Vote              | Voting period                                 |
| Check the result  | After the operator submits a successful tally |
| Execute funds     | Next lifecycle, after approval                |

## Current Limits

The current application does not provide Treasury upgrades, multiple voting
delegations, or milestone-based execution. Proposal Markdown is stored by an
application service. The Proposal account stores a commitment to the exact
content instead of the Markdown itself.

For a short first visit, continue to the [user quickstart](quickstart.md). If
blockchain terms are new to you, start with [Mina basics](foundations/mina-basics.md).

## Sources

- `README.md`
- `packages/sdk/src/provable/contracts/treasury-owner.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts`
- `packages/sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.ts`
- `apps/web/features/treasury/`
