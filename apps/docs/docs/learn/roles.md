---
title: Roles
sidebar_label: Roles
sidebar_position: 4
audience: user
page_kind: concept
---

The treasury separates normal participation, operation, and emergency authorization.
One person can hold more than one transaction role.

## User

A user can read proposals and public treasury state.
A user can also create, vote, or submit an execution transaction when all conditions are present.

Normal actions do not require approval from a named administrator.
Each transaction must still include its required signatures, proofs, and state conditions.

## Operator

The operator runs the infrastructure and prepares proof inputs.
The operator also submits the final tally when the required proofs are ready.

The operator keeps the indexer, processor, API, schedulers, workers, and web application available.
This role does not replace the on-chain authorization rules.

## Break-Glass Signer

Five ordered public keys define the break-glass signer set.
The contract counts valid signature positions, not distinct people.

Use exactly five distinct public keys in the configured order.
At least three different keys must sign each pause or key rotation action.
The contract does not enforce key uniqueness.

Break-glass signatures are separate from proposal votes.
A fee payer submits the authorized transaction and supplies the transaction fee.

## Treasury Owner Emergency Signer

The Treasury Owner account key is a separate emergency authority only when the
deployment uses `proofOrSignature`. Its MINA account signature can then
withdraw MINA directly from the Owner balance.

The safe deployment default is `proof`. In this mode, the emergency command
rejects the Owner account signature.

This action is not Proposal execution. It does not use votes, Proposal status, `paidOutAmount`, the Proposal recipient commitment, lifecycle rules, or the Pause Controller threshold.

For an enabled deployment, the MINA network requires one valid Treasury Owner
account signature. If policy requires several approvals, the key custody
system must enforce that policy.

The withdrawal mode cannot change for an Owner address. The deployed Owner
sets `setPermissions` to impossible.

## Transaction Roles

### Fee payer and sender

The fee payer submits a Mina transaction and supplies its fee.
Current transaction builders use the sender as the fee payer.

Owner create, vote, tally, execute, and Proposal-toggle methods require the transaction sender signature.
The current builders use that sender as the fee payer.

The sender can submit create, tally, or execute when all other inputs are valid.
The sender must also supply signed AccountUpdates when a method requires them.

### Proposal creator and bond payer

The current CLI and web builders use the sender as the proposal creator and bond payer.
A manually built transaction can use a different bond payer.
That transaction needs both the sender signature and the bond-payer signature.

### Proposal account

Each proposal has a separate Mina account under the Treasury Owner token.
Creation requires a signature for this new account.

The web application creates the Proposal account details during its creation flow.
Users do not deploy the Proposal contract separately.

### Voter

The voter controls the key used for a vote.
The vote transaction requires the voter signature.

The key receives weight only if the selected voting ledger gives it delegated stake.

### Recipient

The recipient is fixed when the proposal is created.
The Proposal account stores a hash of the recipient public key.

Execution can move funds only to that recipient.
The recipient does not have to be the bond payer.

## Sources

- `packages/sdk/src/provable/contracts/treasury-owner.ts` — `createProposal`, `vote`, `tallyVotes`, `executeProposal`, `togglePauseProposal`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts` — `Proposal`, `execute`
- `packages/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.ts` — `MULTISIG_PARTICIPANTS_COUNT`, `MIN_VALID_MULTISIG_SIGNATURES_COUNT`
- `apps/cli/src/ledger/transaction-signer.ts` — `addTransactionSignerOptions`, `resolveSigningAccount`
