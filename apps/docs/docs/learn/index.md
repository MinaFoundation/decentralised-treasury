---
title: Learn About the Treasury
sidebar_label: Treasury Introduction
sidebar_position: 1
audience: user
page_kind: navigation
slug: /learn/
---

The Mina Decentralized Treasury coordinates funding decisions on the Mina network.
It combines funding proposals, stake-weighted voting, proofs, and on-chain execution.

The [original RFC](https://forums.minaprotocol.com/t/rfc-mina-decentralized-treasury-decentralized-on-chain-community-treasury/6924) describes a community-controlled treasury.
It proposes public proposal handling, historical staking-ledger snapshots, proposer bonds, and emergency pause controls.

This guide describes the current implementation.
It does not describe every future feature in the RFC.

## Why the Treasury Exists

The treasury gives the community a structured process for shared funds.
Users can inspect a request, vote, verify the result, and execute an approved proposal.

The process separates a funding decision from the movement of funds.
This separation gives users time to review each request and its result.

## What Is Available Now

The current implementation provides these functions:

- a four-period proposal lifecycle;
- voting weight from a recorded Mina staking ledger;
- `yay`, `nay`, and `abstain` votes;
- proof-based vote reduction and tally;
- partial execution of an approved proposal;
- global and proposal-specific pause controls;
- a web application and a CLI;
- indexed events and public service projections.

:::caution Current scope limits

The current implementation does not provide treasury upgrades, multiple voting delegations, or milestone-based execution.

Proposal content is stored in an application database after creation.
The Mina account stores a commitment to that content, not the Markdown text.

:::

## Start Here

1. Read [How the Treasury Works](how-it-works.md).
2. Learn the [Lifecycle and Staking Snapshots](lifecycle-and-snapshots.md).
3. Review the [Roles](roles.md).
4. Choose the [Web Application](web-app.md) or the [CLI](cli.md).
5. [Create a Proposal](create-a-proposal.md) during the Proposal period.
6. Review the exact content and [Vote](vote.md) during the Voting period.
7. Wait for tally, then check [Results and Acceptance](results-and-acceptance.md).
8. [Execute an Approved Proposal](execute-a-proposal.md) in the next lifecycle.
9. Use [Verifiability and Trust](verifiability-and-trust.md) to reconcile
   important results.
10. Understand [Pause Behavior](pause-behavior.md) for an emergency state.

## Sources

- `README.md`
- `packages/sdk/src/provable/contracts/treasury-owner.ts` — `TreasuryOwnerSmartContract`, `LifecyclePeriod`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts` — `TreasuryProposalSmartContract`
- `packages/sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.ts` — `TreasuryPauseControllerSmartContract`
