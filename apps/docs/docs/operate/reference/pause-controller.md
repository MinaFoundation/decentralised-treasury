---
title: Pause Controller
sidebar_label: Pause Controller
sidebar_position: 6
audience: operator
page_kind: reference
---

# Pause Controller

## Intent

`TreasuryPauseControllerSmartContract` provides break-glass authorization. It controls the global pause flag and signer commitment.

## Place in the system

The Owner stores the Pause Controller public key. Normal Owner operations call `requireNotPaused`.

The supported Proposal-toggle workflow passes through the Owner and Pause Controller.
The Pause Controller does not store or change Proposal state.

The public Pause Controller method can also run directly.
A direct call consumes the Pause Controller nonce but does not toggle the Proposal.

## Actors

| Actor | Action |
| --- | --- |
| Five ordered break-glass positions | Hold distinct keys and sign operation-specific message hashes. |
| Fee payer | Pays the fee and submits the transaction. |
| Owner contract | Calls Proposal pause authorization and then toggles the Proposal. |
| Operator | Preserves key order, commitment, nonce, and target addresses. |
| Direct caller | Can submit the public authorization method without the Owner composite path. |

## State and signature input

| Name | Type | Purpose |
| --- | --- | --- |
| `multisigCommitment` | `Field` | Poseidon commitment to five ordered public keys. |
| `paused` | `Bool` | Global treasury pause flag. |
| `multisigParticipants` | Static compile and witness input | Supplies the ordered public keys. |

`MultisigSignatures` contains five signature positions. The circuit counts valid positions, not distinct people or signatures.

## Methods

| Method | Main effect |
| --- | --- |
| `init` | Sets permissions, signer commitment, and `paused = false`. |
| `requireAndIncrementNonce` | Requires the supplied nonce and increments it. |
| `verifySignatures` | Checks the key commitment and signature threshold. |
| `rotateMultisigKeys` | Replaces `multisigCommitment`. |
| `requireNotPaused` | Requires `paused = false`. |
| `pauseTreasury` | Sets `paused = true`. |
| `unpauseTreasury` | Sets `paused = false`. |
| `togglePauseProposal` | Authorizes a Proposal target and increments the nonce. |

`MultisigSignature.dataPauseTreasury`, `dataUnpauseTreasury`, `dataTogglePauseProposal`, and `dataRotateMultisigKeys` construct signed message hashes.

## Authorization

State edits and access require a Pause Controller proof. The verification key cannot change during the current protocol version.

Each break-glass operation requires:

- the current five-key commitment;
- at least three valid signature positions;
- the current account nonce;
- the transaction fee-payer signature.

Operate with exactly five distinct participant keys. At least three different keys must sign each operation.

The supported Owner composite path also needs the Owner transaction sender signature.
A direct Pause Controller call does not use this Owner sender binding.

:::danger Repeated keys weaken the threshold

The contract counts valid positions and does not enforce key uniqueness.

A key in multiple positions can reuse one signature in matching positions. Configure five distinct keys and use three different signers.

:::

The nonce is part of each signed message. A successful method increments the account nonce.

:::caution Use the Owner composite path for a Proposal toggle

The CLI and service call `TreasuryOwnerSmartContract.togglePauseProposal`.
This path verifies break-glass authorization and toggles the Proposal status.

A direct call to `TreasuryPauseControllerSmartContract.togglePauseProposal` only increments the Pause Controller nonce.
It does not change the Proposal status.

:::

## Lifecycle and state conditions

Pause operations have no lifecycle condition.

`pauseTreasury` can run when already paused. `unpauseTreasury` can run when already unpaused.

`togglePauseProposal` does not check the global pause flag.
It verifies authorization for the target Proposal public key and increments the nonce.

The method does not call `TreasuryProposalSmartContract.togglePause`.
Use the Owner composite path when the operation must change Proposal status.

## Business logic

The commitment is `Poseidon.hash` over five ordered public keys. The Operator must use the same order for signatures.

Initialize the Pause Controller with exactly five distinct public keys at deployment.

Message prefixes are:

| Identifier | Value |
| --- | --- |
| `multisigPrefix` | `MFDT` |
| `prefixTogglePauseProposal` | `MFDTtpp` |
| `prefixPauseTreasury` | `MFDTpt` |
| `prefixUnpauseTreasury` | `MFDTupt` |
| `prefixRotateMultisigKeys` | `MFDTrmk` |

`rotateMultisigKeys` signs the current commitment, new commitment, and nonce.

:::warning Key rotation

The method accepts the new commitment as a `Field`. Derive it from exactly five ordered replacement keys before submission.

Reconcile the new commitment and nonce after inclusion.

:::

The signed messages do not include a network ID or contract address. Use a separate signer and nonce domain for each deployment.

## Constants

| Identifier | Value |
| --- | --- |
| `MULTISIG_PARTICIPANTS_COUNT` | `5` |
| `MIN_VALID_MULTISIG_SIGNATURES_COUNT` | `3` |

## Events

The Pause Controller has no event map.

The Owner emits `proposalPauseToggled` after a Proposal pause call. Global pause and key rotation require direct state reconciliation.

## Invariants

- The witnessed key list must match `multisigCommitment`.
- At least three signature positions must verify.
- The five configured public keys must be distinct during operation.
- At least three different configured keys must sign each operation.
- The supplied nonce must equal the account nonce.
- A successful break-glass method increments the nonce.
- A direct `togglePauseProposal` call does not change Proposal state.
- `requireNotPaused` requires `paused = false`.
- Each operation uses a distinct message prefix.

## Errors

| Identifier or message | Cause |
| --- | --- |
| `TreasuryPauseControllerErrors.NOT_ENOUGH_PARTICIPANTS` | The participant configuration does not meet the required five-key operating configuration. |
| `TreasuryPauseControllerErrors.TREASURY_PAUSED` | A guarded Owner operation ran while paused. |
| `MultisigSignaturesErrors.INVALID_MULTISIG_COMMITMENT` | The supplied ordered keys do not match state. |
| `MultisigSignaturesErrors.NOT_ENOUGH_VALID_SIGNATURES` | Fewer than three signature positions verify. |

## CLI and UI operations

See the [CLI command index](./cli-commands) for signature-slot and command options.

- `pause-controller read-state` reads the commitment, pause flag, and nonce.
- `multisig-sign pause-treasury` builds one pause signature.
- `multisig-sign unpause-treasury` builds one unpause signature.
- `multisig-sign toggle-pause-proposal` builds one Proposal toggle signature.
- `multisig-sign rotate-multisig-keys` builds one rotation signature.
- The corresponding `pause-controller` commands submit the transactions.
- The Proposal-toggle command uses the Owner composite method.
- The backoffice application supports the break-glass signing and submission flow.

## Sources

- `packages/sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.ts`
- `packages/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.ts`
- `packages/sdk/src/provable/contracts/treasury-owner.ts`
- `packages/sdk/src/services/sqlite/sqlite-pause-controller-service.ts`
- `apps/cli/src/commands/pause-controller.ts`
- `apps/cli/src/commands/multisig-sign.ts`
- `apps/backoffice/features/runtime-config.ts`
- `packages/sdk/test/provable/contracts/treasury-pause-controller/treasury-pause-controller.test.ts`
