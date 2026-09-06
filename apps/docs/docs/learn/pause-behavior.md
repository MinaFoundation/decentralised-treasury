---
title: Pause Behavior
sidebar_label: Pause Behavior
sidebar_position: 11
audience: user
page_kind: concept
---

Pause controls let break-glass signers stop treasury activity during an emergency.
They do not replace normal proposal voting.

## Global Treasury Pause

The Pause Controller stores the global `paused` value.
A global pause blocks these Treasury Owner actions:

- create a proposal;
- vote;
- tally;
- execute an approved proposal.

The Treasury Owner funding method does not use the global pause guard.
Funds can still enter the treasury while it is paused.

An Owner deployed with `proofOrSignature` also has an emergency withdrawal
path. A global pause does not block that direct signed account update. An Owner
deployed with the safe `proof` default does not have this signature path.

:::danger Pause does not lock the emergency Owner key

When enabled, the emergency path is not Proposal execution. It does not use
votes, Proposal status, `paidOutAmount`, the recipient commitment, lifecycle
rules, or the 3-of-5 Pause Controller signatures.

:::

Five ordered signer keys define the break-glass set.
The contract counts valid signature positions.

Use exactly five distinct public keys in the configured order.
At least three different keys must sign a global pause or unpause.

:::caution Repeated keys weaken the threshold

The contract counts valid positions and does not enforce key uniqueness.
A repeated key can let one signature satisfy multiple matching positions.

:::

## Proposal Pause

A proposal pause uses the Proposal `status` field.
It does not use a separate Boolean field.

```text
any status except PAUSED → PAUSED
PAUSED                   → UNKNOWN
```

While the status is `PAUSED`, the Proposal blocks voting, tally, and execution.
The proposal remains visible in the application.

:::danger A toggle can erase a final result

Toggling an `APPROVED` or `REJECTED` proposal changes its status to `PAUSED`.
The next toggle changes the status to `UNKNOWN`.

The prior final result is not restored.
A new valid tally is necessary before execution.

:::

## What Users Must Check

Do not use the pause event value as the authoritative proposal state.
The event includes a caller-supplied `paused` value.

After a pause action, read the Pause Controller or Proposal account on the MINA network.
Then wait for the application projection to update.

## Who Authorizes a Pause

The break-glass signers create signatures for a specific action and nonce.
A sender includes those signatures in the Mina transaction.

The current threshold is three valid signatures from five ordered public keys.
Key rotation requires the current threshold and binds both signer commitments.

## Sources

- `packages/sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.ts` — `pauseTreasury`, `unpauseTreasury`, `togglePauseProposal`
- `packages/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.ts` — signer count, threshold, and signed action data
- `packages/sdk/src/provable/contracts/treasury-owner.ts` — `requireNotPaused`, `togglePauseProposal`
- `packages/sdk/src/services/sqlite/sqlite-treasury-owner-service.ts` — `emergencyWithdraw`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts` — `requireNotPaused`, `togglePause`, `ProposalStatus`
- `packages/sdk/src/provable/events/treasury-proposal-events.ts` — `ProposalPauseToggledEvent`
