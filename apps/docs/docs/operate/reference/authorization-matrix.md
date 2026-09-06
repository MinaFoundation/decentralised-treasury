---
title: Authorization Matrix
sidebar_label: Authorization matrix
sidebar_position: 11
audience: operator
page_kind: reference
---

# Authorization matrix

Authorization has separate contract, proof, transaction, and lifecycle parts. A valid operation must satisfy every applicable column.

Every submitted Mina transaction needs a fee-payer signature. The table shows additional sender bindings required by contract methods.

## State-changing operations

| Operation                           | Contract proof authorization                          | Side-loaded ZkProgram proofs                     | Sender signature          | Other signed AccountUpdates                    | Embedded break-glass signatures | Lifecycle condition        | State condition                                                              |
| ----------------------------------- | ----------------------------------------------------- | ------------------------------------------------ | ------------------------- | ---------------------------------------------- | ------------------------------- | -------------------------- | ---------------------------------------------------------------------------- |
| Fund                                | Treasury Owner proof                                  | None                                             | None                      | Funding account                                | None                            | None                       | Owner exists                                                                 |
| Create                              | Treasury Owner proof                                  | None                                             | Required                  | Bond payer, if different; Proposal account key | None                            | Proposal period            | Treasury not paused                                                          |
| Vote                                | Treasury Owner and Proposal proofs                    | None                                             | Required                  | Voter key                                      | None                            | Voting period              | Treasury and Proposal not paused                                             |
| Tally                               | Treasury Owner and Proposal proofs                    | Vote Reducer and Staking Ledger to Voting Ledger | Required                  | None                                           | None                            | Cooldown or later          | Treasury and Proposal not paused; status `UNKNOWN`                           |
| Execute                             | Treasury Owner and Proposal proofs                    | None                                             | Required                  | None                                           | None                            | Lifecycle `L + 1` or later | Treasury and Proposal not paused; status `APPROVED`                          |
| Emergency withdrawal                | None                                                  | None                                             | None beyond the fee payer | Treasury Owner                                 | None                            | None                       | Owner mode is `proofOrSignature`; sufficient balance                          |
| Pause treasury                      | Pause Controller proof                                | None                                             | None                      | None                                           | Three valid positions           | None                       | Commitment and nonce match                                                   |
| Unpause treasury                    | Pause Controller proof                                | None                                             | None                      | None                                           | Three valid positions           | None                       | Commitment and nonce match                                                   |
| Toggle Proposal pause through Owner | Treasury Owner, Proposal, and Pause Controller proofs | None                                             | Required                  | None                                           | Three valid positions           | None                       | Commitment, nonce, and Proposal target match                                 |
| Authorize Proposal toggle directly  | Pause Controller proof                                | None                                             | None                      | None                                           | Three valid positions           | None                       | Commitment, nonce, and Proposal target match; Proposal state does not change |
| Rotate keys                         | Pause Controller proof                                | None                                             | None                      | None                                           | Three valid current positions   | None                       | Current commitment and nonce match                                           |

## Method mapping

| Operation                           | Public contract method                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fund                                | `TreasuryOwnerSmartContract.receive`                                                                                                                          |
| Create                              | `TreasuryOwnerSmartContract.createProposal`                                                                                                                   |
| Vote                                | `TreasuryOwnerSmartContract.vote` and `TreasuryProposalSmartContract.vote`                                                                                    |
| Tally                               | `TreasuryOwnerSmartContract.tallyVotes` and `TreasuryProposalSmartContract.tallyVotes`                                                                        |
| Execute                             | `TreasuryOwnerSmartContract.executeProposal` and `TreasuryProposalSmartContract.execute`                                                                      |
| Emergency withdrawal                | Direct signed Treasury Owner AccountUpdate; no contract method                                                                                                |
| Pause treasury                      | `TreasuryPauseControllerSmartContract.pauseTreasury`                                                                                                          |
| Unpause treasury                    | `TreasuryPauseControllerSmartContract.unpauseTreasury`                                                                                                        |
| Toggle Proposal pause through Owner | `TreasuryOwnerSmartContract.togglePauseProposal`, `TreasuryPauseControllerSmartContract.togglePauseProposal`, and `TreasuryProposalSmartContract.togglePause` |
| Authorize Proposal toggle directly  | `TreasuryPauseControllerSmartContract.togglePauseProposal`                                                                                                    |
| Rotate keys                         | `TreasuryPauseControllerSmartContract.rotateMultisigKeys`                                                                                                     |

## Submission rules

Any user can submit create, tally, or execute when all inputs and conditions are valid.

Voting additionally requires the voter signature. The voter and transaction sender can be different accounts.

Current [CLI](./cli-commands) and web creation builders use the sender as bond payer. The contract transaction can use another signed bond payer.

Owner create, vote, tally, execute, and Proposal-toggle methods bind the sender. A different fee payer does not replace that signature.

The public Pause Controller `togglePauseProposal` method does not bind an Owner sender.
It verifies the embedded signatures and increments the Pause Controller nonce.
It does not change the Proposal status when called directly.

A manually selected bond payer needs its signature in addition to the sender signature.

An emergency withdrawal is available only for `proofOrSignature` deployments.
It creates a signed default-token AccountUpdate for the Treasury Owner. It does
not call a contract method or create a proof. The Owner signature authorizes
account access and the MINA debit.

The direct path does not check global pause, Proposal status, lifecycle, recipient commitments, or the Proposal execution cap. The 3-of-5 Pause Controller signatures are not Mina AccountUpdate signatures and do not authorize this withdrawal.

Break-glass signatures are embedded data verified inside the Pause Controller proof. They are not Mina AccountUpdate signatures.

The circuit counts valid break-glass positions. Configure exactly five distinct keys, and use at least three different keys for each operation.

## Deployed account permissions

The Owner and Pause Controller replace every unlisted permission with `impossible`.

| Account                            | Proof                                            | Proof or signature                 | None | Signature | Impossible during current version | Impossible       |
| ---------------------------------- | ------------------------------------------------ | ---------------------------------- | ---- | --------- | --------------------------------- | ---------------- |
| Treasury Owner, `proof` mode       | `editState`, `receive`, `access`, `send`         | `incrementNonce`                   | None | None      | `setVerificationKey`              | All other fields |
| Treasury Owner, `proofOrSignature` | `editState`, `receive`                           | `access`, `send`, `incrementNonce` | None | None      | `setVerificationKey`              | All other fields |
| Pause Controller                   | `editState`, `access`, `incrementNonce`          | None                               | None | None      | `setVerificationKey`              | All other fields |

Creation sets Proposal permissions to `Permissions.default()` from the pinned o1js dependency.

:::danger Permanent deployment authority

`setPermissions` remains impossible. The selected withdrawal mode cannot change
after deployment. The selection is permanent for the Owner address.

A proof-only Owner cannot gain signature withdrawal authority. An enabled Owner
cannot remove that authority. Deploy a new Owner address to use another mode.

:::

| Proposal permission                                                  | Authorization |
| -------------------------------------------------------------------- | ------------- |
| `editState`, `send`, `editActionState`                               | Proof         |
| `receive`, `access`                                                  | None          |
| `setDelegate`, `setPermissions`, `setVerificationKey`, `setZkappUri` | Signature     |
| `setTokenSymbol`, `incrementNonce`, `setVotingFor`, `setTiming`      | Signature     |

## Deployment authorization

| Account          | Required transaction signatures            | Contract result                                                  |
| ---------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| Pause Controller | Fee payer and Pause Controller account key | Installs the compiled key, signer commitment, and initial state. |
| Treasury Owner   | Fee payer and Treasury Owner account key   | Installs the compiled key, start slot, Pause Controller key, and selected withdrawal permissions. |

`treasury-owner deploy` submits both deployment transactions. Ledger mode needs separate account indexes when the keys are different.

## Reconciliation

After any state-changing operation, read state on the MINA network.

For execution, check the Owner balance, recipient balance, and Proposal `paidOutAmount` at one canonical block.

For emergency withdrawal, check the included transaction, Owner balance, recipient balance, Owner nonce, and fee-payer nonce on the MINA network. Account for the transaction fee and any recipient account-creation fee. No Proposal event or `paidOutAmount` change records this operation.

For break-glass actions, check the Pause Controller nonce and state. For Proposal toggles, also check the Proposal `status`.

## Sources

- `packages/sdk/src/provable/contracts/treasury-owner.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts`
- `packages/sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.ts`
- `packages/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.ts`
- `packages/sdk/src/services/sqlite/sqlite-treasury-owner-service.ts`
- `packages/sdk/src/services/sqlite/sqlite-pause-controller-service.ts`
- `apps/cli/src/commands/treasury-owner.ts`
- `apps/cli/src/commands/proposal.ts`
- `apps/cli/src/commands/pause-controller.ts`
- `apps/cli/src/ledger/transaction-signer.ts`
