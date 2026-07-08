---
title: Provable Primitives
sidebar_label: Provable Primitives
---

## Summary

The SDK provable primitives must provide the shared account commitments, voting-account commitments, prefixed hashing, and prefixed Merkle witnesses used by treasury circuits and SmartContracts. These primitives are off-chain provable-only modules, not SmartContracts or ZkPrograms, but their hashes and witness calculations are circuit contracts because downstream circuits and treasury zkApps bind roots, leaves, indexes, and action hashes to on-chain values.

The primary consumers are `StakingLedgerToVotingLedger`, `VoteReducer`, `TreasuryProposalSmartContract`, staking ledgers, voting ledgers, and nullifier ledgers. The primitives must align with Mina account hashing and with treasury-specific voting/nullifier tree hashing so downstream circuits and treasury zkApps can verify roots consistently.

## Scope

- Mina account leaf commitment shape for staking ledger verification.
- Voting account leaf commitment shape for delegate voting weight.
- Prefixed Poseidon hashing and zkApp action hash-list chaining.
- Prefixed Merkle tree storage behavior and circuit-compatible witnesses.
- Empty account, empty zkApp, empty voting account, and empty nullifier conventions.

## Concept specification

### Mina Account Commitments

`Account` must model the full Mina staking ledger account leaf that circuits verify against a staking epoch ledger root. Even when a circuit only uses `balance`, `delegate`, `pk`, or `tokenId`, the complete account must remain commitment-bound: public key, token id, token symbol, balance, nonce, receipt chain hash, delegate, voting-for state hash, timing, permissions, and zkApp substructure.

This full commitment is required because staking-ledger roots come from Mina L1. A proof that changes an unused account field would otherwise be able to preserve the fields used by the circuit while diverging from the on-chain staking epoch root.

### zkApp Account Substructure

The zkApp substructure must be hashed into every account commitment. Empty zkApp accounts must use the Mina empty zkApp URI hash, dummy verification key, empty app state, initial reducer action states, empty last-action slot, empty zkApp version, and false proved state. A JSON account with an empty zkApp URI must hash as the same empty URI value so hydrated ledger accounts match Mina's account commitment convention.

### Voting and Nullifier Commitments

`VotingAccount` must commit only to a `UInt64` balance. The voting ledger uses this minimal leaf because delegate voting weight is the only data the vote reducer needs once staking balances have been aggregated by delegate. Nullifier leaves commit to a `Bool` and use a separate nullifier hash prefix, preserving a separate one-vote-used commitment from voting weight.

### Prefixed Hashing

All provable hashes must use domain-separated Poseidon prefixes. Account, zkApp account, voting account, nullifier, Merkle path, event, and sequence-event hashes must use their own prefixes so leaves and internal nodes cannot be confused across ledgers or action chains.

### Prefixed Merkle Witnesses

Prefixed Merkle trees must use a provided empty leaf hash and per-level hash prefixes. Stored nodes may be sparse; missing nodes resolve to deterministic zero nodes derived from the empty leaf. Circuit witnesses must calculate roots and indexes with the same prefix list used by off-chain tree storage.

## Technical specification

### Constants and configuration

| Name | Value / meaning |
|------|-----------------|
| `zkappAccountHashPrefix` | `MinaZkappAccount****` |
| Empty zkApp URI hash | `20639848968581348850513072699760590695338607317404146322838943866773129280073` |
| Staking account leaf prefix | `MinaAccount*********` |
| Voting account leaf prefix | `MinaVotingAccount*********` |
| Nullifier leaf prefix | `MinaNullifier*************` |
| Mina staking Merkle prefixes | `MinaMklTree000******` through `MinaMklTree034******` for height 36 |
| Treasury Merkle prefixes | `TreasuryMklTree000******` through `TreasuryMklTree254******` for height 255 |
| Event prefix | `MinaZkappEvent******` |
| Sequence events prefix | `MinaZkappSeqEvents**` |
| Actions empty hash prefix | `MinaZkappActionsEmpty` |
| `PrefixedMerkleWitness36` | Circuit witness for Mina staking ledger height 36 |
| `PrefixedMerkleWitness255` | Circuit witness for voting and nullifier ledgers height 255 |

### Account commitment types

```ts
class Account extends Struct({
  pk: PublicKey,
  tokenId: TokenId,
  tokenSymbol: TokenSymbol,
  balance: UInt64,
  nonce: UInt32,
  receiptChainHash: Field,
  delegate: PublicKey,
  votingFor: Field,
  timing: Timing,
  permissions: Permissions,
  zkapp: Zkapp,
}) {}

class VotingAccount extends Struct({
  balance: UInt64,
}) {}
```

`Account.toHashInput` must pack fields in the order and bit widths expected by Mina ledger hashing before applying `MinaAccount*********`. `VotingAccount.toHashInput` must expose only the balance field.

### Permissions and timing

`Permission` must encode `impossible`, `none`, `proof`, `signature`, and `either` as the triple `{ constant, signatureNecessary, signatureSufficient }`. `Permissions` must hash edit-state, access, send, receive, delegate, permission, verification-key, zkApp URI, action-state, token-symbol, nonce, voting-for, and timing permissions, including the verification-key transaction version.

`Timing` must hash timed-account fields with fixed bit widths: timed flag, initial minimum balance, cliff time, cliff amount, vesting period, and vesting increment.

### Hash helpers

| Function | Contract |
|----------|----------|
| `salt(prefix)` | Initializes Poseidon state from the prefix field |
| `hashWithPrefix(prefix, input)` | Returns the first field after updating the prefixed Poseidon state with input fields |
| `emptyHashWithPrefix(prefix)` | Returns the salted empty hash for a prefix |
| `getActionHash(actionFields)` | Hashes one action with `MinaZkappEvent******` |
| `appendActionToHashList(initialActionsHash, actionFields)` | Extends a Mina zkApp sequence-event hash list |
| `packToFields(input)` | Combines packed chunks into field elements without exceeding `Field.sizeInBits` |

### Merkle tree and witnesses

`PrefixedMerkleTree` must:

- Derive zero nodes from the empty leaf hash and per-level prefixes.
- Return zero nodes for absent storage entries.
- Reject `setLeaf` and `getWitness` indexes greater than or equal to `2 ** (height - 1)`.
- Update every parent hash with that level's prefix after a leaf write.
- Return witnesses with sibling path and side bits from leaf to root.

`BasePrefixedMerkleWitness` must:

- Reject witness length that does not match the static tree height.
- Recalculate roots using side bits, sibling path, and per-level prefixes.
- Recalculate the leaf index from side bits.

## Acceptance criteria

- Empty Mina accounts hash with the empty account, empty timing, default permission, and empty zkApp conventions.
- JSON hydration preserves empty delegate handling and empty zkApp URI hashing so account leaves match Mina staking ledger roots.
- Staking ledger leaves use full `Account` commitments, not only fields consumed by downstream circuits.
- Voting ledger leaves hash only `VotingAccount.balance` under `MinaVotingAccount*********`.
- Nullifier ledger leaves hash `Bool` values under `MinaNullifier*************`.
- Prefixed Merkle trees produce deterministic roots from prefixed leaves and per-level prefixes.
- Witnesses reject wrong height, out-of-range indexes, and mismatched root/index checks in downstream circuits.
- Action hash appending reproduces the proposal reducer action-state chain consumed by vote reducer proofs.

## Design choices

### Full Account Commitment

The Mina account primitive commits to the full account rather than only fields used by a specific circuit. This keeps staking-ledger proof verification aligned with Mina L1 roots and avoids redefining account identity for each circuit.

### Minimal Voting Account

The voting account commits only to balance because voting-weight proofs need delegate weight after staking aggregation, not full Mina account data. Any future voting metadata would change this commitment and therefore must be treated as a ledger-format change.

### Domain-Separated Merkle Trees

Leaf and internal-node prefixes differ between Mina staking ledgers and treasury voting/nullifier ledgers. This keeps proof roots scoped to their ledger purpose and prevents cross-ledger hash reuse.

## Invariants and constraints

- Account commitments must bind all Mina account fields, including zkApp fields and permissions.
- Empty zkApp URI handling must be stable across parsed JSON and empty account construction.
- Merkle witness height must match the target ledger height.
- Public-key-indexed treasury ledgers must use the same public-key-to-index mapping in storage and circuits.
- Hash prefixes are protocol constants for all proofs that expose or consume ledger roots.

## Related specs

- [Staking ledger → voting ledger](staking-ledger-to-voting-ledger.md)
- [Vote reducer](vote-reducer.md)
- [Treasury proposal](treasury-proposal.md)
