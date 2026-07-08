---
title: Staking Ledger To Voting Ledger
sidebar_label: Staking Ledger To Voting Ledger
---

## Summary

`StakingLedgerToVotingLedger` must be the ZkProgram circuit that turns an epoch staking ledger into a delegate-keyed voting ledger. Its purpose is to compose staking account balances by delegate, producing delegated voting weights that treasury voting can consume without putting the full staking ledger scan in the voting circuit.

The `StakingLedgerToVotingLedger` circuit has two externally visible relationships:

- The **operator / prover** scans staking accounts, constructs the voting ledger root transition, and produces the final recursive proof.
- **Treasury tallying zkApps** verify `SideLoadedStakingLedgerToVotingLedgerProof` and bind its public input/output to proposal tally rules.

The circuit must establish that the transformation is tied to the epoch staking ledger root, starts with an empty voting ledger root, scans the staking ledger in order, aggregates each account balance into the account's delegate, reaches ledger exhaustion, and outputs the final voting ledger root to be used by voting consumers. In treasury proposal tallying, that staking ledger root must be linked back to the on-chain `stakingEpochDataLedgerHash` precondition, so an incorrect account, delegate, or witness cannot satisfy the consumer's staking-epoch ledger check.

## Scope

- Proving the staking-ledger-to-voting-ledger transformation for one epoch ledger.
- Aggregating staking balances into delegate-keyed voting weights.
- Recursively composing ledger-scan segments into one final proof.
- Exposing public input/output fields that downstream components can rely on.
- Describing the proof continuity required to produce the side-loaded proof verified by treasury zkApps.

## Concept specification

### Ledger Transformation

Tallying requires delegated stake weights as voting power, while this circuit must scan the Mina staking ledger as an indexed sequence of account leaves. The operator produces a side-loaded proof of the transformation from an epoch staking ledger and an empty voting ledger into a final voting ledger root. Each scanned staking account must contribute its balance to the voting account keyed by its delegate, composing all stake delegated to the same public key into one voting balance. The circuit output must commit to the resulting root so vote-reducer proofs can consume delegated balances without re-scanning the Mina L1 ledger.

### Custom Token Account Delegates

Custom token accounts use the empty public key as their delegate, so their treatment determines whether completion can be inferred from balance totals. The transformation must let a custom token account contribute its balance to the voting account keyed by `PublicKey.empty()`, and the proof must advance through that account like any other staking ledger entry.

### Recursive Composition

The full staking ledger scan must be split into bounded proof segments that remain ordered. Recursive composition must merge adjacent segments while preserving the fixed staking ledger root, advancing the staking index monotonically, and carrying the voting ledger root from one segment to the next.

### Exhaustion

The final proof must establish that the next staking position after the processed proof range is empty. With fixed-size digest batches, the processed range may include padded empty accounts before the final exhaustion check. That exhaustion flag is what makes the transformation complete for downstream consumers.

### Parallel Proof Generation

The operator-facing proving flow must allow `digest` segments to be proven in parallel. To make that possible, segment preparation records enough witness data to replay each `digest` segment independently during proof generation. Replay is not a trust assumption: every replayed account, voting account, and witness must still be constrained back to the public staking root, rolling voting root, and delegate-derived voting index.

The trace must be produced by dry-running the circuit with proofs disabled. That dry run collects the public input, private inputs, witness data, and public output for each `digest` segment, creating a deterministic trace that a proving worker can replay independently with proofs enabled.

## Technical specification

### Constants and configuration


| Name                                                                                                 | Meaning                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staking ledger root                                                                                  | Epoch staking ledger root used as the fixed source ledger                                                                                                                  |
| Empty voting ledger root                                                                             | Starting root for delegated voting-weight accumulation                                                                                                                     |
| Voting ledger root                                                                                   | Final root produced by the transformation                                                                                                                                  |
| `ACCOUNT_BATCH_SIZE = 5`                                                                             | Number of staking accounts included in one `digest` proof; this configurable batch size lets the circuit be tuned to fit the circuit-size limit of the o1js version in use |
| Staking ledger tree height `36`                                                                      | Mina L1 staking ledger witness height, represented by `PrefixedMerkleWitness36`                                                                                            |
| Voting ledger tree height `255`                                                                      | Delegate-keyed voting ledger witness height, represented by `PrefixedMerkleWitness255`; delegates may not themselves exist as staking ledger accounts                      |
| Staking account hash prefix `MinaAccount*********`                                                   | Domain prefix for staking account leaf hashes under the Mina L1 staking ledger root                                                                                        |
| zkApp account hash prefix `MinaZkappAccount****`                                                     | Domain prefix for the zkApp substructure committed inside each staking account leaf                                                                                        |
| Empty zkApp URI hash `20639848968581348850513072699760590695338607317404146322838943866773129280073` | Canonical hash used for accounts without a zkApp URI, so empty/non-zkApp accounts still have a stable zkApp commitment                                                     |
| Voting account hash prefix `MinaVotingAccount*********`                                              | Domain prefix for voting account leaf hashes under the generated voting ledger root                                                                                        |
| Staking Merkle path prefixes `MinaMklTree000******` through `MinaMklTree034******`                   | Per-level prefixes for staking ledger root calculation                                                                                                                     |
| Voting Merkle path prefixes `TreasuryMklTree000******` through `TreasuryMklTree254******`            | Per-level prefixes for voting ledger root calculation                                                                                                                      |
| Side-loaded proof depth `maxProofsVerified = 2`                                                      | Treasury zkApp-verifiable `SideLoadedStakingLedgerToVotingLedgerProof` can verify the recursive proof inside treasury zkApps                                               |


### Staking ledger input

The staking ledger is the Mina L1 epoch staking ledger: the ledger snapshot that Mina exposes for the staking epoch used by consensus. This circuit must treat it as an indexed sequence of account leaves. Each leaf contains the account public key, balance, delegate, and other Mina account fields, and the full tree commits to the `stakingLedgerRoot` that this ZkProgram uses as its fixed source root.

Operationally, this Mina L1 staking ledger JSON is the standard operator input to the proving flow. The operator must hydrate it into a local staking-ledger representation, derive Merkle witnesses for consecutive account positions, and feed those accounts and witnesses into `digest` traces and proofs. The proof must not accept the JSON file directly; it accepts account values and witnesses whose root must match the public `stakingLedgerRoot`.

JSON balances must be converted before they enter the circuit. `balance` and timed-account amount fields are multiplied by `1_000_000_000` into the `UInt64` base units used by the provable account representation.

A three-account staking ledger JSON from `apps/cli/.data/dev/ledger.json` looks like this:

```json
[
  {
    "pk": "B62qpExe8CAaGkR4HRxyXvkziQpE6Aq3U71MJLHivP8pCsiDk1BbU9Z",
    "balance": "1000",
    "delegate": "B62qpExe8CAaGkR4HRxyXvkziQpE6Aq3U71MJLHivP8pCsiDk1BbU9Z",
    "token": "wSHV2S4qX9jFsLjQo8r1BsMLH2ZRKsZx6EJd1sbozGPieEC4Jf",
    "receipt_chain_hash": "2mzbV7WevxLuchs2dAMY4vQBS6XttnCUF8Hvks4XNBQ5qiSGGBQe",
    "voting_for": "3NK2tkzqqK5spR2sZ7tujjqPksL45M3UUrcA4WhCkeiPtnugyE2x",
    "permissions": {
      "edit_state": "signature",
      "send": "signature",
      "receive": "none",
      "access": "none",
      "set_delegate": "signature",
      "set_permissions": "signature",
      "set_verification_key": {
        "auth": "signature",
        "txn_version": "4"
      },
      "set_zkapp_uri": "signature",
      "edit_action_state": "signature",
      "set_token_symbol": "signature",
      "increment_nonce": "signature",
      "set_voting_for": "signature",
      "set_timing": "signature"
    },
    "token_symbol": ""
  },
  {
    "pk": "B62qo1vFp5EpvBZifAvsJWwpB17obrvGSJadE2rwwLqr5R8VAw7b64R",
    "balance": "137",
    "delegate": "B62qo1vFp5EpvBZifAvsJWwpB17obrvGSJadE2rwwLqr5R8VAw7b64R",
    "token": "wSHV2S4qX9jFsLjQo8r1BsMLH2ZRKsZx6EJd1sbozGPieEC4Jf",
    "receipt_chain_hash": "2mzbV7WevxLuchs2dAMY4vQBS6XttnCUF8Hvks4XNBQ5qiSGGBQe",
    "voting_for": "3NK2tkzqqK5spR2sZ7tujjqPksL45M3UUrcA4WhCkeiPtnugyE2x",
    "permissions": {
      "edit_state": "signature",
      "send": "signature",
      "receive": "none",
      "access": "none",
      "set_delegate": "signature",
      "set_permissions": "signature",
      "set_verification_key": {
        "auth": "signature",
        "txn_version": "4"
      },
      "set_zkapp_uri": "signature",
      "edit_action_state": "signature",
      "set_token_symbol": "signature",
      "increment_nonce": "signature",
      "set_voting_for": "signature",
      "set_timing": "signature"
    },
    "token_symbol": ""
  },
  {
    "pk": "B62qkHHjFaAqSgds8D8yrDp2cZ3ibDJcMaLktqDTFtkbBjoJZioi7mi",
    "balance": "284",
    "delegate": "B62qkHHjFaAqSgds8D8yrDp2cZ3ibDJcMaLktqDTFtkbBjoJZioi7mi",
    "token": "wSHV2S4qX9jFsLjQo8r1BsMLH2ZRKsZx6EJd1sbozGPieEC4Jf",
    "receipt_chain_hash": "2mzbV7WevxLuchs2dAMY4vQBS6XttnCUF8Hvks4XNBQ5qiSGGBQe",
    "voting_for": "3NK2tkzqqK5spR2sZ7tujjqPksL45M3UUrcA4WhCkeiPtnugyE2x",
    "permissions": {
      "edit_state": "signature",
      "send": "signature",
      "receive": "none",
      "access": "none",
      "set_delegate": "signature",
      "set_permissions": "signature",
      "set_verification_key": {
        "auth": "signature",
        "txn_version": "4"
      },
      "set_zkapp_uri": "signature",
      "edit_action_state": "signature",
      "set_token_symbol": "signature",
      "increment_nonce": "signature",
      "set_voting_for": "signature",
      "set_timing": "signature"
    },
    "token_symbol": ""
  }
]
```

### Mina account leaf

Each staking ledger account must be treated as a full Mina account commitment, not as a reduced `{ publicKey, balance, delegate }` record. The staking leaf hash includes the account public key, token id and symbol, balance, nonce, receipt chain hash, delegate, `voting_for`, timing, permissions, and a zkApp substructure hash.

The circuit must use only `balance` and `delegate` to update the voting ledger, but the staking witness must bind every account field to the Mina L1 staking ledger root. This keeps zkApp account fields preserved in the source commitment even though they do not create separate voting behavior.

Accounts without zkApp state must use the canonical empty zkApp value: empty app state, dummy verification key, initial action state, empty version/slot/proved-state values, and the empty zkApp URI hash listed in constants. Empty staking positions must be proven with the full `Account.empty()` value, not by checking a missing JSON entry.

### Public circuit interface

The circuit interface must be shaped around a fixed staking ledger root and a rolling voting ledger root:

```ts
class StakingLedgerToVotingLedgerProgramInput extends Struct({
  index: UInt64,
  stakingLedgerRoot: Field,
  votingLedgerRoot: Field,
}) {}

class StakingLedgerToVotingLedgerProgramOutput extends Struct({
  index: UInt64,
  votingLedgerRoot: Field,
  exhausted: Bool,
}) {}
```

`index` identifies the staking ledger position at the start and end of a proof segment. `stakingLedgerRoot` must stay fixed for the whole transformation, while `votingLedgerRoot` must roll forward as accounts contribute delegated weight. `exhausted` must only be true once the proof chain establishes that the next staking slot is empty.

### Delegate Mapping

The transformation must read each staking ledger account's `delegate` field and use that public key as the voting ledger key. This is required because the voting ledger represents delegated stake, not the staking account's own public key.

The voting ledger index must be derived from the delegate public key. In-circuit the proof asserts the voting witness index equals `Poseidon.hash(delegate.toFields())`; off-chain witness providers must use the same delegate-derived index.

Voting account leaves must store only the accumulated `UInt64` balance. Delegate identity belongs to the Merkle index, not to the voting account leaf, so a consumer verifies a delegate's balance by checking the delegate-derived witness index and the balance-only leaf hash under the final voting ledger root.

### Circuit stages

The ZkProgram circuit must expose three stages:

```ts
const StakingLedgerToVotingLedger = ZkProgram({
  publicInput: StakingLedgerToVotingLedgerProgramInput,
  publicOutput: StakingLedgerToVotingLedgerProgramOutput,
  methods: {
    digest: { privateInputs: [Provable.Array(Account, 5)] },
    merge: { privateInputs: [SelfProof, SelfProof] },
    exhaust: { privateInputs: [SelfProof] },
  },
});
```

`digest` must prove a bounded, consecutive staking-ledger segment and update delegated voting weights. It must consume exactly five `Account` private inputs, verify each account at the expected staking index under the fixed `stakingLedgerRoot`, verify the delegate's voting account under the rolling `votingLedgerRoot`, add the staking balance into that voting account, and output the last processed index with `exhausted = false`.

`merge` must compose adjacent proof segments while preserving root continuity. The outer public input must match the first proof's public input, both proofs must share the same staking ledger root, the first output index plus one must equal the second input index, and the first output voting root must equal the second input voting root. A merge output must never be exhausted.

`exhaust` must mark the proof chain complete once the next staking-ledger position after the processed range is empty. It re-verifies the child proof, requires the outer public input to match the child proof input, proves `Account.empty()` at `child.output.index + 1` under the fixed staking ledger root, preserves the child output index and voting root, and sets `exhausted = true`.

### Circuit context

`StakingLedgerToVotingLedger` must rely on `stakingLedgerToVotingLedgerContext` for off-chain witness access. The context is not trusted by itself; every value read from it must be constrained back to the public roots or proof inputs inside the circuit.

The context provides witness and update surfaces:


| Context surface                                    | Consumed by               | Purpose                                                                                              |
| -------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `stakingLedger.getWitness(index)`                  | `digest`, `exhaust`       | Supplies a `PrefixedMerkleWitness36` for the current staking account or the post-range empty account |
| `votingLedger.getVotingAccount(delegate)`          | `digest`                  | Supplies the current voting account whose balance will receive the staking account balance           |
| `votingLedger.getWitness(delegate)`                | `digest`                  | Supplies a `PrefixedMerkleWitness255` for the delegate-derived voting account index                  |
| `votingLedger.setVotingAccount(delegate, account)` | `digest` witness callback | Records the updated voting account for later off-chain steps                                         |
| `votingLedger.setLeaf(delegate, account)`          | `digest` witness callback | Advances the off-chain voting ledger so the next digest step can witness against the updated root    |


`digest` must read staking witnesses, voting accounts, and voting witnesses from context. It must constrain staking witnesses against `publicInput.stakingLedgerRoot`, constrain voting witnesses against the rolling `votingLedgerRoot`, and then write the updated delegate voting account back to the context. Those writes are an off-chain obligation: they keep the prover's context aligned with the public output root that the circuit returns, but they are not trusted unless the next witness/root checks succeed.

`merge` must not read or write context. It only verifies child proofs and checks public input/output continuity. `exhaust` must read only the staking ledger witness for `child.output.index + 1` and constrain it to prove `Account.empty()` under the fixed staking ledger root; it must not read or mutate the voting ledger context.

### Witness obligations

For each `digest` account, the operator must provide:

- The staking account at the current sequential index.
- A `PrefixedMerkleWitness36` proving that account is included at that index under `stakingLedgerRoot`.
- The delegate's current voting account.
- A `PrefixedMerkleWitness255` proving that voting account at the delegate-derived voting index under the current `votingLedgerRoot`.
- The updated voting root after adding the staking account balance to the delegate's voting balance.

For `exhaust`, the operator must provide a staking witness proving that `Account.empty()` is included at the first index after the processed proof range.

### Proving flow

The proving flow must follow the same proof continuity rules as the circuit:

1. Trace consecutive `digest` segments by dry-running the circuit with proofs disabled from the hydrated staking ledger and an initially empty voting ledger, stopping before the first segment whose first account is `Account.empty()`.
2. Prove prepared `digest` segments independently by replaying their captured witness data.
3. Merge adjacent proofs until one proof covers the prepared range.
4. Run `exhaust` against the resulting proof and the staking ledger witness for the first unprocessed index.

The final proof remains valid only when `exhaust` proves post-range emptiness.

### Errors


| Message                                          | Meaning                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `staking ledger tree account index not matching` | A staking witness does not point to the expected sequential account index           |
| `staking ledger tree account root not matching`  | A staking account witness does not resolve to the fixed public staking ledger root  |
| `voting ledger witness index not matching`       | A voting witness does not point to the delegate-derived voting ledger index         |
| `voting ledger root does not match`              | A voting account witness does not resolve to the rolling voting ledger root         |


### Consumer proof binding

Downstream components may recursively consume the final proof or rely on its public input/output. The consumer relationship depends on this circuit exposing the starting staking index, starting voting ledger root, staking ledger root, exhausted flag, final voting ledger root, and a side-loadable proof type tied to the staking-ledger-to-voting-ledger verification key.

Treasury proposal tallying is the known consumer binding. This proof must expose enough public input/output for that consumer to bind the transformed staking ledger root to `stakingEpochDataLedgerHash`, require the transformation to start from the empty voting ledger, require exhaustion, and bind vote reduction to the final voting ledger root. The proposal zkApp's rejection rules belong in the proposal or treasury-owner spec.

## Acceptance criteria

- A final proof can be produced for an epoch staking ledger.
- The final proof exposes public input/output for start index, starting voting root, staking root, final voting root, and exhaustion.
- Each `digest` proof consumes exactly five accounts, outputs the last processed index, and leaves `exhausted = false`.
- Segment preparation stops before a batch whose first staking account is `Account.empty()`, while emitted final batches may include empty padding.
- Prepared witness data can reproduce each digest segment's public output.
- The proof chain can only be marked complete by the exhaustion stage.
- Merged proofs preserve adjacency, staking root continuity, and voting root continuity.
- Merged proofs reject non-adjacent segments or mismatched staking/voting roots.
- Exhaustion rejects when the next staking index is not proven as `Account.empty()`.
- Non-adjacent merges, root mismatches, and exhaustion against a non-empty next staking position are rejected.
- Completion is proven by exhaustion, not by comparing accumulated voting weight to total currency.
- The final side-loaded proof is consumable by treasury zkApps with proof depth `2`.
- The final proof exposes the staking root, exhaustion flag, and voting root fields required for treasury proposal tallying to bind the vote reducer input root to the proof output voting root.

## Design choices

### Delegate-Keyed Voting Ledger

Staking accounts become voting weights through their delegate. The voting ledger is keyed by delegate because the transformation produces delegated stake, not one voting entry per staking account.

This means many staking accounts can contribute to the same voting account.

### Segmented Base Proofs

The full ledger scan must be split into fixed-size base segments so each base proof handles bounded work. A complete epoch ledger scan is too large for one base proof, and the maximum workable batch size depends on the circuit-size limit of the o1js version in use. Keeping batch size as configuration lets the digest circuit be tuned to fit that limit while still allowing chunks to be recursively composed into a full-ledger proof.

### Recursive Merge and Exhaustion

The transformation must expose one proof for a full ledger by recursively merging adjacent segment proofs and finalizing the chain with exhaustion. Exhaustion makes completion a structural property of the ledger scan rather than a balance-total comparison.

Consumers receive one recursive proof with stable public I/O, while the transformation must still prove complete ledger coverage.

## Invariants and constraints

- The staking ledger root is constant across the full proof chain.
- The voting ledger root is initialized as empty and evolves monotonically through the ordered scan.
- Each digest segment covers exactly five consecutive staking ledger positions.
- Proof segments must be adjacent; merged proofs cannot skip or reorder staking ledger positions.
- Only the exhaustion stage can mark the final proof complete.
- Exhaustion means the first staking ledger position after the processed proof range is proven as `Account.empty()`.
- The final voting ledger root is the transformation output exposed to downstream consumers.
- Custom token accounts map to the empty public key unless the transformation explicitly filters them before accumulation.
- The completion signal is staking-ledger exhaustion, not total currency.

## Related specs

- [Provable primitives](provable-primitives.md)
- [Vote reducer](vote-reducer.md)
- [Treasury proposal](treasury-proposal.md)
