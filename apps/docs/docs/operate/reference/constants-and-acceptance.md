---
title: Constants and Acceptance Math
sidebar_label: Constants and acceptance
sidebar_position: 9
audience: operator
page_kind: reference
---

# Constants and acceptance math

This page gives the exact source constants and integer calculations.

## Protocol structure constants

These constants define the lifecycle, proof shapes, status values, vote values, and break-glass threshold.

| Identifier                                     | Value                       | Purpose                                                     |
| ---------------------------------------------- | --------------------------- | ----------------------------------------------------------- |
| `LIFECYCLE_PERIOD_DURATION`                    | `7140`                      | Default slots in one lifecycle period.                      |
| `LifecyclePeriod.PROPOSAL`                     | `0`                         | Proposal creation period.                                   |
| `LifecyclePeriod.EXPLORATION`                  | `1`                         | Exploration period.                                         |
| `LifecyclePeriod.VOTING`                       | `2`                         | Voting period.                                              |
| `LifecyclePeriod.COOLDOWN`                     | `3`                         | Cooldown and tally-start period.                            |
| `LifecyclePeriod.NUMBER_OF_PERIODS`            | `4`                         | Equal periods in one lifecycle.                             |
| `BOND_AMOUNT_DIVISOR`                          | `10`                        | Calculates the Proposal bond.                               |
| `TREASURY_OWNER_WITHDRAWAL_PERMISSIONS`        | `proof`, `proofOrSignature` | Allowed Owner withdrawal modes.                             |
| `DEFAULT_TREASURY_OWNER_WITHDRAWAL_PERMISSION` | `proof`                     | Safe default Owner withdrawal mode.                         |
| `BASIS_POINTS`                                 | `10000`                     | Represents 100 percent.                                     |
| `MIN_PARTICIPATION_BP`                         | `2000`                      | Minimum participation threshold.                            |
| `MAX_PARTICIPATION_BP`                         | `5000`                      | Maximum participation threshold.                            |
| `MIN_APPROVAL_BP`                              | `5100`                      | Minimum approval threshold.                                 |
| `MAX_APPROVAL_BP`                              | `7000`                      | Maximum approval threshold.                                 |
| `CURVE_CONSTANT_PARTICIPATION_BP`              | `500`                       | Participation curve shape.                                  |
| `CURVE_CONSTANT_APPROVAL_BP`                   | `1000`                      | Approval curve shape.                                       |
| `ACCOUNT_BATCH_SIZE`                           | `5`                         | Accounts in one staking digest proof.                       |
| `VOTE_ACTION_BATCH_SIZE`                       | `5`                         | Vote actions in one reducer batch.                          |
| `ActionStateHistoryTarget` field count         | `5`                         | Historical Proposal action-state targets required by tally. |
| Staking ledger witness height                  | `36`                        | Height of `PrefixedMerkleWitness36`.                        |
| Voting and nullifier witness height            | `255`                       | Height of `PrefixedMerkleWitness255`.                       |
| `MULTISIG_PARTICIPANTS_COUNT`                  | `5`                         | Ordered break-glass key positions.                          |
| `MIN_VALID_MULTISIG_SIGNATURES_COUNT`          | `3`                         | Required valid signature positions.                         |
| `maxProofsVerified`                            | `2`                         | Side-loaded proof recursion limit for both ZkPrograms.      |

The five action-state targets must be found, non-initial, unique, and present in Proposal account history.

The break-glass threshold counts valid positions. Exactly five distinct keys and three different signers are external operating invariants.

## Status and vote constants

| Identifier                | Value | Meaning                                                |
| ------------------------- | ----- | ------------------------------------------------------ |
| `ProposalStatus.UNKNOWN`  | `0`   | No stored tally result.                                |
| `ProposalStatus.APPROVED` | `1`   | Tally approved the Proposal.                           |
| `ProposalStatus.REJECTED` | `2`   | Tally rejected the Proposal.                           |
| `ProposalStatus.PAUSED`   | `3`   | Local Proposal pause state.                            |
| `Vote.DUMMY`              | `0`   | Fixed-batch padding only when the public key is empty. |
| `Vote.YAY`                | `1`   | Approval vote.                                         |
| `Vote.NAY`                | `2`   | Rejection vote.                                        |
| `Vote.ABSTRAIN`           | `3`   | Participation-only vote.                               |

## Content constants

| Identifier                           | Value                                   | Purpose                                                   |
| ------------------------------------ | --------------------------------------- | --------------------------------------------------------- |
| `MARKDOWN_ZKAPP_URI_PREFIX`          | `urn:proposal-content:markdown:sha256:` | Prefixes the hexadecimal SHA-256 Markdown digest.         |
| `MAX_ZKAPP_URI_UTF8_BYTES`           | `255`                                   | Maximum UTF-8 byte length accepted by the content helper. |
| `DEFAULT_PROPOSAL_CONTENT_MAX_CHARS` | `32768`                                 | Default App API limit for submitted Markdown characters.  |

The [CLI](./cli-commands) and web flow calculate the URI from exact Markdown bytes. They check the limit before transaction construction.

## Break-glass message prefixes

| Identifier                  | Value     | Signed fields after hashing with the prefix    |
| --------------------------- | --------- | ---------------------------------------------- |
| `multisigPrefix`            | `MFDT`    | Namespace for all break-glass message hashes.  |
| `prefixTogglePauseProposal` | `MFDTtpp` | Proposal public key and nonce.                 |
| `prefixPauseTreasury`       | `MFDTpt`  | Nonce.                                         |
| `prefixUnpauseTreasury`     | `MFDTupt` | Nonce.                                         |
| `prefixRotateMultisigKeys`  | `MFDTrmk` | Current commitment, new commitment, and nonce. |

The signed messages do not include the network ID or contract address. Use a separate signer and nonce domain for each deployment.

## Bond calculation

The bond uses unsigned integer division:

```text
bond = floor(requestedAmount / 10)
```

The bond enters the shared Owner balance during creation.
The supported proposal workflow uses a positive requested amount.

The complete Proposal execution cap is:

```text
executionCap = requestedAmount + bond
remaining = executionCap - paidOutAmount
```

## Acceptance inputs

The calculation uses:

| Name                      | Source                                                 |
| ------------------------- | ------------------------------------------------------ |
| `proposalAmount`          | Proposal `amount` state.                               |
| `snapshotTreasuryBalance` | Treasury Owner account in the recorded staking ledger. |
| `snapshotTotalCurrency`   | Proposal `stakingEpochDataLedgerTotalCurrency` state.  |
| `yay`, `nay`, `abstain`   | Vote Reducer proof output.                             |

The source uses `UInt128` for intermediate acceptance arithmetic.

## Exact equations

All divisions use integer division.

```text
ratioBp =
  min(proposalAmount × 10000 / snapshotTreasuryBalance, 10000)

curve(ratioBp, c) =
  ratioBp × 10000
  / (ratioBp + c × (10000 - ratioBp) / 10000)

requiredParticipationBp =
  2000
  + (5000 - 2000) × curve(ratioBp, 500) / 10000

requiredApprovalBp =
  5100
  + (7000 - 5100) × curve(ratioBp, 1000) / 10000

requiredParticipation =
  snapshotTotalCurrency × requiredParticipationBp / 10000

approvalBp =
  yay × 10000 / (yay + nay)
```

The source caps `ratioBp` at `10000`. A proposal above the historical Owner balance uses the maximum curve input.

:::caution Historical Owner balance

`snapshotTreasuryBalance` must be nonzero. The ratio calculation cannot divide by zero.

Before Proposal creation, preserve the exact ledger and confirm that it contains this default-token Owner account.

Creation records the root and total currency. It does not check account inclusion or the nonzero balance.

:::

## Participation and approval

Participation is:

```text
totalParticipatingVotes = yay + nay + abstain
participationMet =
  totalParticipatingVotes >= requiredParticipation
```

Approval uses only `yay + nay`. `abstain` contributes to participation but not approval.

When `yay + nay = 0`, the helper uses a safe divisor of `1`. The tally method then rejects with `No approval votes cast`.

The final approval condition is:

```text
approved =
  participationMet
  and (yay + nay > 0)
  and (approvalBp >= requiredApprovalBp)
```

## Result transitions

| Participation | `yay + nay` | Approval       | Tally transaction | Stored status   |
| ------------- | ----------- | -------------- | ----------------- | --------------- |
| Pass          | Positive    | Pass           | Succeeds          | `APPROVED`      |
| Pass          | Positive    | Fail           | Succeeds          | `REJECTED`      |
| Fail          | Any         | Any            | Fails             | Stays `UNKNOWN` |
| Pass          | Zero        | Not applicable | Fails             | Stays `UNKNOWN` |

## Policy effects

These constants define the acceptance policy at compile time:

| Change                          | Effect                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| Increase `MIN_PARTICIPATION_BP` | Require more participating stake for small requests.                                      |
| Increase `MAX_PARTICIPATION_BP` | Require more participating stake when a request approaches the snapshot treasury balance. |
| Increase `MIN_APPROVAL_BP`      | Require a larger `yay` share for small requests.                                          |
| Increase `MAX_APPROVAL_BP`      | Require a larger `yay` share when a request approaches the snapshot treasury balance.     |
| Increase a curve constant       | Make the applicable threshold move toward its maximum more slowly.                        |
| Decrease a curve constant       | Make the applicable threshold move toward its maximum more quickly.                       |

Use basis-point values from `0` through `10000`. Test the complete integer
equations for the intended request sizes before a release.

## Configuration effect

Acceptance values are source constants. They are not runtime environment settings.

Changing an acceptance constant requires a rebuild. It also changes the affected verification keys.

`lifecyclePeriodDuration`, proof verification keys, and empty roots are compile inputs. All consumers must use the same emitted configuration.

Use [Configure the Treasury](../lifecycle/configure-the-treasury.md) for the
selection workflow and its worked acceptance examples. Use
[Deploy the Treasury](../deployment/deploy-the-treasury.md) for the
compile, deployment record, and Mina reconciliation workflow.

## Sources

- `packages/sdk/src/provable/contracts/treasury-constants.ts`
- `packages/sdk/src/provable/contracts/treasury-owner.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts`
- `packages/sdk/src/provable/staking-ledger-to-voting-ledger.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts`
- `packages/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.ts`
- `packages/sdk/src/provable/merkle-tree/prefixed-merkle-tree.ts`
- `packages/sdk/src/utils/proposal-content-hash.ts`
- `apps/api/src/proposal-content-routes.ts`
- `packages/sdk/test/provable/contracts/treasury-proposal/treasury-proposal.test.ts`
