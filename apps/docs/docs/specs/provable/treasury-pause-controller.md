---
title: Treasury Pause Controller
sidebar_label: Treasury Pause Controller
---

## Summary

`TreasuryPauseControllerSmartContract` must be the pause controller zkApp that owns global pause authority. It separates emergency authorization from normal treasury execution by keeping a pause flag and a multisig authority commitment on a dedicated zkApp account.

`TreasuryOwnerSmartContract` depends on the pause controller for two decisions:

- Whether normal treasury flows may proceed while the global pause flag is clear.
- Whether a multisig-authorized proposal pause toggle may be applied to a proposal account.

The pause controller authorizes governance actions with a 3-of-5 Schnorr multisig, domain-separated signed intents, and the pause-controller account nonce. Proposal-specific pause state remains on proposal accounts; the pause controller only authorizes the action.

## Scope

- Global treasury pause and unpause authority.
- Multisig authorization for global pause changes, key rotation, and proposal pause toggles.
- Replay protection through nonce-bound signed intents.
- Rotation of the multisig authority commitment.
- Cross-zkApp coordination with treasury owner and proposal accounts.

## Concept specification

### Initialization

The pause controller starts from a five-participant authority set. Initialization records the corresponding authority commitment, initializes the global pause flag as clear, and requires proof-authorized state changes so emergency governance actions go through the multisig path.

### Global Pause and Unpause

Global pause and unpause are emergency governance actions. A valid threshold signature set over the matching pause or unpause intent changes the global pause flag and consumes the pause-controller nonce. If the authority threshold, nonce, or message domain does not match, the action is rejected and pause state remains unchanged.

### Multisig Rotation

Multisig rotation changes future emergency governance authority. The existing authority signs the existing commitment, replacement commitment, and nonce; after rotation succeeds, future governance actions are authorized by the replacement commitment.

### Proposal Pause Toggle

Proposal pause is coordinated across zkApps because the pause controller owns authorization while the proposal account owns proposal-local status. A valid threshold signature set over a proposal-toggle intent lets treasury owner apply the proposal-local pause transition and emit the proposal pause event.

### Global Guard

Treasury owner uses the pause controller as the global guard for normal treasury flows. When the global pause flag is set, guarded flows are rejected before normal treasury behavior proceeds.

## Technical specification

### Constants and configuration

| Name | Meaning |
|------|---------|
| `MULTISIG_PARTICIPANTS_COUNT = 5` | Fixed authority set size and fixed signature-slot count |
| `MIN_VALID_MULTISIG_SIGNATURES_COUNT = 3` | Minimum number of valid participant signatures required for an authorized governance intent |
| Multisig namespace `MFDT` | Domain namespace for pause-controller governance message hashes |
| Pause prefix `MFDTpt` | Domain prefix for pause-treasury intents; message includes the account nonce |
| Unpause prefix `MFDTupt` | Domain prefix for unpause-treasury intents; message includes the account nonce |
| Proposal-toggle prefix `MFDTtpp` | Domain prefix for proposal pause toggle intents; message includes proposal public key fields and nonce |
| Key-rotation prefix `MFDTrmk` | Domain prefix for multisig rotation intents; message includes old commitment, new commitment, and nonce |
| Account nonce | Pause-controller nonce binds each signed intent to one successful account update |

### On-Chain State

| State | Meaning |
|-------|---------|
| `multisigCommitment` | Commitment to the ordered participant key set authorized to govern pause actions |
| `paused` | Global treasury pause flag checked by treasury owner flows |

The participant public keys themselves are not stored as on-chain state. They are supplied as a fixed five-key witness during signature verification, and the witness must hash back to the on-chain `multisigCommitment`.

### Account permissions

The pause controller account is locked down to proof-authorized operation:

| Permission | Mode |
|------------|------|
| `editState` | proof |
| `access` | proof |
| `incrementNonce` | proof |
| `setVerificationKey` | impossible during the active protocol version |
| All other permissions | impossible |

### Governance Intents

| Intent | Signed fields | Authorized outcome |
|--------|---------------|--------------------|
| Pause treasury | `MFDTpt`, nonce | Set the global pause flag |
| Unpause treasury | `MFDTupt`, nonce | Clear the global pause flag |
| Rotate multisig keys | `MFDTrmk`, old commitment, new commitment, nonce | Replace the authority commitment |
| Toggle proposal pause | `MFDTtpp`, proposal public key, nonce | Authorize treasury owner to flip a proposal's local pause status |

Every signed intent is domain-separated and includes the pause-controller nonce. Intents are not interchangeable across action types, proposals, commitments, or nonce values.

### Multisig signatures

`MultisigSignatures` contains exactly five signature slots aligned with the ordered participant list. Verification recomputes `Poseidon.hash(participants.flatMap((pk) => pk.toFields()))` and requires it to equal `multisigCommitment`; participant order is therefore part of the authorization interface.

A valid authorization requires at least three slots whose signature verifies against the participant at the same index and the exact intent hash. Valid signatures may be non-contiguous. Duplicate signatures for the same participant do not increase the count because each slot verifies only against that slot's participant key.

### Methods and authorization

| Method | Authorization | State / account-update effect |
|--------|---------------|-------------------------------|
| `init()` | Static deployment configuration | Sets permissions, stores the multisig commitment, and initializes `paused = false` |
| `pauseTreasury(signatures, nonce)` | 3-of-5 signatures over pause intent | Requires and increments pause-controller nonce; sets `paused = true` |
| `unpauseTreasury(signatures, nonce)` | 3-of-5 signatures over unpause intent | Requires and increments pause-controller nonce; sets `paused = false` |
| `rotateMultisigKeys(multisigCommitment, nonce, signatures)` | Existing 3-of-5 authority signs old commitment, new commitment, and nonce | Requires and increments pause-controller nonce; replaces `multisigCommitment` |
| `togglePauseProposal(proposalPublicKey, signatures, nonce)` | 3-of-5 signatures over proposal-toggle intent | Requires and increments pause-controller nonce; does not mutate global `paused` |
| `requireNotPaused()` | No multisig signature; reads pause state precondition | Fails guarded flows while `paused = true` |

Every mutating governance method verifies signatures before consuming the nonce and changing state. Failed authorization leaves nonce and state unchanged.

### Events and errors

The pause controller does not define its own event stream. Proposal pause changes are emitted by treasury owner after it coordinates authorization and proposal state mutation.

| Message | Meaning |
|---------|---------|
| `Not enough multisig participants` | Deployment or witness setup did not provide exactly five participant keys |
| `Invalid multisig commitment` | Witnessed participant keys do not match the on-chain commitment |
| `Not enough valid signatures` | Fewer than three slot-aligned signatures verify for the exact intent |
| `Treasury is paused` | A guarded treasury flow called `requireNotPaused()` while global pause is set |

## Acceptance criteria

- [ ] Initialization records the multisig authority commitment and starts with global pause cleared.
- [ ] Pause and unpause require at least three valid participant signatures over the correct nonce-bound intent.
- [ ] Authorized pause and unpause actions consume exactly one pause-controller nonce.
- [ ] Non-contiguous valid signature slots can satisfy the threshold, but duplicate or shifted signatures do not.
- [ ] Key rotation requires signatures from the existing authority commitment and switches future authority to the replacement commitment.
- [ ] After key rotation, old participant keys no longer authorize governance actions and replacement keys do.
- [ ] Proposal pause toggling consumes pause-controller authorization while leaving proposal-local pause state on the proposal account.
- [ ] Proposal pause toggling increments the pause-controller nonce without changing global `paused`.
- [ ] Guarded treasury flows pass while globally unpaused and reject while globally paused.
- [ ] Signed intents cannot be replayed across action types, proposals, commitments, or nonce values.
- [ ] The deployed account permission map allows proof-based state edits, access, and nonce increments while leaving all other permissions impossible.

## Design choices

### Dedicated Pause-Controller Account

Emergency pause authority lives on a dedicated zkApp account. This keeps global pause state and multisig authority separate from normal treasury execution, giving emergency governance its own nonce and state boundary.

### Commitment-Based Multisig

The multisig authority is represented on-chain as a commitment to an ordered five-participant key set. The account stores one compact authority value, while participant order remains part of the authorization contract because signature slots verify against the ordered witnessed keys.

### 3-of-5 Threshold Authorization

Emergency governance requires any three valid participant signatures over the exact intent. This threshold tolerates unavailable participants while still requiring a majority of the fixed five-key authority set.

### Domain-Separated Intents

Each governance action signs a distinct message domain and includes the pause-controller nonce. This prevents a signature for one action, proposal, commitment, or nonce from authorizing another action.

### Proposal Pause as Coordinated Authorization

Proposal-local pause state belongs to the proposal account. The pause controller only authorizes the action, while treasury owner coordinates the cross-zkApp flow, keeping global pause and proposal pause as independent state domains.

## Invariants and constraints

- The pause-controller nonce is consumed once per successful authorized governance action.
- Global pause state and proposal-local pause state are independent.
- Key rotation changes future multisig authority without changing historical nonce usage.
- Participant order is binding for the multisig commitment.
- Signature slots are aligned with the ordered participant list; a signature only counts for its slot's participant.
- Governance intent hashes are bound to action domain and nonce, and proposal/rotation intents are also bound to their proposal key or commitment fields.
- `togglePauseProposal` is authorization-only on the pause controller and does not mutate global pause state.
- Treasury owner is the integration point between pause-controller authorization and proposal account mutation.

## Related specs

- [Staking ledger → voting ledger](staking-ledger-to-voting-ledger.md)
- Treasury owner / treasury proposal
