---
title: CLI Command and Argument Reference
sidebar_label: CLI commands and arguments
sidebar_position: 12
audience: operator
page_kind: reference
---

# CLI command and argument reference

Use [Deploy the Treasury](../deployment/deploy-the-treasury.md) for the
required compile, deployment, reconciliation, and public-record order. Use
this page to find the exact inputs for each CLI command.

The [infrastructure runbooks](../infrastructure/index.md) use these commands in
an ordered Kubernetes procedure. This reference defines their arguments. It
does not replace the procedure.

Run commands from the repository root. `<CLI_ENV_FILE>` means the CLI file from
[environment generation](../lifecycle/configure-the-treasury.md#generate-an-environment-family):

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- <command> [subcommand] [arguments] [options]
```

An option marked **required** can come from the command line or its environment
field. A **conditional** option is checked while the command runs. Commander
does not show a conditional option as required in `--help`.

The CLI uses input values in this order:

1. Command option.
2. Matching environment field.
3. Built-in default, if one exists.

Use `pnpm run cli -- <command> [subcommand] --help` to confirm the installed
CLI before an operation.

## Command tree

The CLI contains these top-level commands:

- `treasury-owner`
- `proposal`
- `pause-controller`
- `multisig-sign`
- `staking-ledger`
- `staking-ledger-to-voting-ledger`
- `vote-reducer`
- `worker`
- `lightnet`
- `generate-keypair`
- `generate-keypairs`
- `transfer`
- `mina-ledger-parity`

The sections below list every leaf command and all of its inputs.

## Endpoint and network options

| Option                                      | Environment                         | Required                          | Default                         | Use                                                                                                      |
| ------------------------------------------- | ----------------------------------- | --------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `--mina-node-url <url>`                     | `MINA_NODE_URL`                     | No                                | `http://127.0.0.1:8080/graphql` | Mina GraphQL endpoint for on-chain reads and transactions.                                               |
| `--network-id <id>`                         | `MINA_NETWORK_ID`                   | No                                | `devnet`                        | Mina network ID. Allowed values are `mainnet`, `devnet`, and `testnet`. Input is converted to lowercase. |
| `--archive-node-url <url>`                  | `ARCHIVE_NODE_URL`                  | Yes, for `proposal fetch-actions` | None                            | Archive GraphQL endpoint. The CLI sends this URL to the Archive client without changing it.              |
| `--api-url <url>`                           | `TREASURY_API_URL`                  | No                                | `http://127.0.0.1:4100`         | App API base URL used by `proposal create` to submit Proposal Markdown.                                  |
| `--lightnet-account-manager-endpoint <url>` | `LIGHTNET_ACCOUNT_MANAGER_ENDPOINT` | No                                | `http://127.0.0.1:8181`         | Lightnet account manager used by `lightnet acquire-account`.                                             |

The CLI does not derive the network ID from the Mina URL. Set both values for
the target network. The network ID applies to software and Ledger transaction
signing.

These commands accept `--mina-node-url`:

- `treasury-owner deploy`, `fund-treasury`, `emergency-withdraw`, and `read-state`;
- every `pause-controller` command except `compile`;
- `proposal create`, `vote`, `execute`, `read-state`, and `tally-votes`;
- `transfer` and `lightnet acquire-account`.

The same commands accept `--network-id`, except `lightnet acquire-account`.
The Lightnet command always uses `devnet`.

`proposal fetch-actions` is the only command that accepts
`--archive-node-url`. It does not accept a Mina node URL. `proposal create` is
the only command that accepts `--api-url`.

## Common transaction options

The transaction commands use these common options:

| Option              | Environment | Required | Default                        | Rule                                                                |
| ------------------- | ----------- | -------- | ------------------------------ | ------------------------------------------------------------------- |
| `--fee <nanomina>`  | `TX_FEE`    | No       | `1000000000`                   | Fee paid by the sender. The parser uses `UInt64`.                   |
| `--nonce <integer>` | `TX_NONCE`  | No       | Current sender nonce from Mina | Explicit fee-payer nonce. See the Pause Controller exception below. |
| `--memo <text>`     | `TX_MEMO`   | No       | None                           | Mina transaction memo.                                              |
| `--wait <boolean>`  | `TX_WAIT`   | No       | `true`                         | Allowed values are exactly `true` and `false`.                      |
| `--signer <mode>`   | `SIGNER`    | No       | `in-memory`                    | Allowed values are `in-memory` and `ledger`.                        |

The common transaction options apply to:

- `treasury-owner deploy`, `fund-treasury`, and `emergency-withdraw`;
- `pause-controller deploy`, `pause-treasury`, `unpause-treasury`,
  `toggle-pause-proposal`, and `rotate-multisig-keys`;
- `proposal create`, `vote`, `execute`, and `tally-votes`;
- `transfer`.

### Nonce rules

For most transaction commands, `--nonce` is only the fee-payer nonce.

For `pause-controller pause-treasury`, `unpause-treasury`,
`toggle-pause-proposal`, and `rotate-multisig-keys`, the current implementation
also uses a supplied `--nonce` as the Pause Controller action nonce. Omit the
option unless the fee-payer nonce and Pause Controller nonce are equal. When it
is omitted, the command reads the action nonce from Mina and lets the
transaction builder select the fee-payer nonce. `pause-controller deploy` uses
the option only as the fee-payer nonce.

For a `multisig-sign` command, `--nonce` is required and means only the Pause
Controller state nonce. That command creates one partial signature. It does
not create a Mina transaction.

## Signing options

`--signer=in-memory` requires the private key for each signing role.
`--signer=ledger` requires the expected public key and Ledger account index for
each signing role.

| Role                | Private-key option and environment                               | Ledger public-key option and environment                       | Ledger index option and environment                                                |
| ------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Sender or fee payer | `--sender-private-key`, `SENDER_PRIVATE_KEY`                     | `--sender-public-key`, `SENDER_PUBLIC_KEY`                     | `--sender-ledger-account-index`, `SENDER_LEDGER_ACCOUNT_INDEX`                     |
| Funding account     | `--funding-private-key`, `FUNDING_PRIVATE_KEY`                   | `--funding-public-key`, `FUNDING_PUBLIC_KEY`                   | `--funding-ledger-account-index`, `FUNDING_LEDGER_ACCOUNT_INDEX`                   |
| Treasury Owner      | `--treasury-owner-private-key`, `TREASURY_OWNER_PRIVATE_KEY`     | `--treasury-owner-public-key`, `TREASURY_OWNER_PUBLIC_KEY`     | `--treasury-owner-ledger-account-index`, `TREASURY_OWNER_LEDGER_ACCOUNT_INDEX`     |
| Pause Controller    | `--pause-controller-private-key`, `PAUSE_CONTROLLER_PRIVATE_KEY` | `--pause-controller-public-key`, `PAUSE_CONTROLLER_PUBLIC_KEY` | `--pause-controller-ledger-account-index`, `PAUSE_CONTROLLER_LEDGER_ACCOUNT_INDEX` |
| Voter               | `--voter-private-key`, `VOTER_PRIVATE_KEY`                       | `--voter-public-key`, `VOTER_PUBLIC_KEY`                       | `--voter-ledger-account-index`, `VOTER_LEDGER_ACCOUNT_INDEX`                       |

The CLI checks Ledger role options at runtime. The index must be an integer
from `0` through `4294967295`. The public key returned by the device must match
the configured public key.

The funding account defaults to the sender for `treasury-owner fund-treasury`
and `transfer`. Supply funding options only when another account supplies the
funds.

Proposal creation is different. It accepts the optional local
`--proposal-private-key` or `PROPOSAL_PRIVATE_KEY` input. If this input is
absent, the CLI generates a Proposal keypair in memory. The CLI does not expose
a Proposal Ledger public-key or account-index option.

| Transaction command                              | Signing roles                                                                                                                                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `treasury-owner deploy`                          | Sender, Treasury Owner account, and Pause Controller account.                                                                                                                |
| `treasury-owner fund-treasury`                   | Sender and, only when different, funding account.                                                                                                                            |
| `treasury-owner emergency-withdraw`              | Sender and Treasury Owner account.                                                                                                                                           |
| `pause-controller deploy`                        | Sender and Pause Controller account.                                                                                                                                         |
| Other state-changing `pause-controller` commands | Sender, plus the supplied break-glass signatures.                                                                                                                            |
| `proposal create`                                | The Sender signs through the selected signer mode. The new Proposal account signs with the supplied or generated local Proposal private key. The Sender also funds the bond. |
| `proposal vote`                                  | Sender and voter. They can be the same account.                                                                                                                              |
| `proposal tally-votes` and `proposal execute`    | Sender.                                                                                                                                                                      |
| `transfer`                                       | Sender and, only when different, funding account.                                                                                                                            |

## `treasury-owner`

### `treasury-owner compile`

Compiles the Vote Reducer, staking-to-voting program, Treasury Proposal, Pause
Controller, and Treasury Owner in dependency order.

| Option                                | Environment                 | Required | Default | Meaning                                                     |
| ------------------------------------- | --------------------------- | -------- | ------- | ----------------------------------------------------------- |
| `--lifecycle-period-duration <slots>` | `LIFECYCLE_PERIOD_DURATION` | No       | `7140`  | Duration of one lifecycle period. The parser uses `UInt32`. |

### `treasury-owner deploy`

Uses the Mina connection, common transaction, and Sender, Treasury Owner, and
Pause Controller signing options.

| Option                                         | Environment                         | Required | Default | Meaning                                                                            |
| ---------------------------------------------- | ----------------------------------- | -------- | ------- | ---------------------------------------------------------------------------------- |
| `--treasury-deployed-at-slot <slot>`           | `TREASURY_DEPLOYED_AT_SLOT`         | No       | `0`     | Global slot at which lifecycle zero starts. The parser uses `UInt32`.              |
| `--withdrawal-permission <mode>`               | `TREASURY_WITHDRAWAL_PERMISSION`    | No       | `proof` | Sets Owner `access` and `send`. Allowed values are `proof` and `proofOrSignature`. |
| `--multisig-participants-public-keys <keys>`   | `MULTISIG_PARTICIPANTS_PUBLIC_KEYS` | Yes      | None    | Exactly five comma-separated, ordered public keys.                                 |
| `--allow-deploy-to-existing-account <boolean>` | `ALLOW_DEPLOY_TO_EXISTING_ACCOUNT`  | No       | `false` | Removes the Owner `isNew` precondition. Keep `false` for an initial deployment.    |
| `--lifecycle-period-duration <slots>`          | `LIFECYCLE_PERIOD_DURATION`         | No       | `7140`  | Must equal the value used for compilation.                                         |

The signing table above lists the conditional private-key, public-key, and
Ledger-index inputs for the three deployment roles.

### `treasury-owner fund-treasury`

Uses the Mina connection, common transaction, Sender and Funding signing
options, and these inputs:

| Option                                | Environment                 | Required | Default | Meaning                               |
| ------------------------------------- | --------------------------- | -------- | ------- | ------------------------------------- |
| `--treasury-owner-public-key <key>`   | `TREASURY_OWNER_PUBLIC_KEY` | Yes      | None    | Treasury Owner account.               |
| `--amount <nanomina>`                 | `TRANSFER_AMOUNT`           | Yes      | None    | Amount moved into the Treasury Owner. |
| `--lifecycle-period-duration <slots>` | `LIFECYCLE_PERIOD_DURATION` | No       | `7140`  | Must equal the compiled duration.     |

`--funding-private-key`, `--funding-public-key`, and
`--funding-ledger-account-index` are conditional. When they are absent, the
funding account is the sender.

### `treasury-owner emergency-withdraw`

Uses the Mina connection, common transaction, Sender and Treasury Owner
signing options, and these inputs:

| Option                         | Environment            | Required | Default | Meaning                         |
| ------------------------------ | ---------------------- | -------- | ------- | ------------------------------- |
| `--recipient-public-key <key>` | `RECIPIENT_PUBLIC_KEY` | Yes      | None    | Emergency withdrawal recipient. |
| `--amount <nanomina>`          | `WITHDRAWAL_AMOUNT`    | Yes      | None    | Withdrawal amount.              |

The deployed Owner must use `proofOrSignature` for both `access` and `send`.
This command does not use Pause Controller participant signatures.

### `treasury-owner read-state`

Uses `--mina-node-url`, `MINA_NODE_URL`, `--network-id`, and
`MINA_NETWORK_ID`.

| Option                                | Environment                 | Required | Default | Meaning                                                  |
| ------------------------------------- | --------------------------- | -------- | ------- | -------------------------------------------------------- |
| `--treasury-owner-public-key <key>`   | `TREASURY_OWNER_PUBLIC_KEY` | Yes      | None    | Treasury Owner account to read.                          |
| `--lifecycle-period-duration <slots>` | `LIFECYCLE_PERIOD_DURATION` | No       | `7140`  | Duration used to calculate the displayed current period. |

## `proposal`

### `proposal create`

Uses the Mina connection, common transaction, and Sender signing options. The
Proposal deployment key is always local to the CLI.

| Option                                | Environment                 | Required | Default                 | Meaning                                                                                                |
| ------------------------------------- | --------------------------- | -------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `--api-url <url>`                     | `TREASURY_API_URL`          | No       | `http://127.0.0.1:4100` | App API base URL for Markdown submission.                                                              |
| `--treasury-owner-public-key <key>`   | `TREASURY_OWNER_PUBLIC_KEY` | Yes      | None                    | Treasury Owner that creates the child Proposal.                                                        |
| `--proposal-private-key <key>`        | `PROPOSAL_PRIVATE_KEY`      | No       | Generated in memory     | Optional deployment-only Proposal key. The CLI discards a generated private key when the command ends. |
| `--proposal-lifecycle-id <id>`        | `PROPOSAL_LIFECYCLE_ID`     | Yes      | None                    | Lifecycle in which the Proposal is created. The parser uses `UInt32`.                                  |
| `--recipient-public-key <key>`        | `RECIPIENT_PUBLIC_KEY`      | Yes      | None                    | Proposal recipient.                                                                                    |
| `--amount <nanomina>`                 | `PROPOSAL_AMOUNT`           | Yes      | None                    | Requested amount. The parser uses `UInt64`.                                                            |
| `--content-file <path>`               | `PROPOSAL_CONTENT_FILE`     | Yes      | None                    | Markdown file that is hashed for `zkappUri` and submitted to the App API.                              |
| `--lifecycle-period-duration <slots>` | `LIFECYCLE_PERIOD_DURATION` | No       | `7140`                  | Must equal the compiled duration.                                                                      |

### `proposal vote`

Uses the Mina connection, common transaction, Sender and Voter signing
options, and these inputs:

| Option                                | Environment                 | Required | Default | Meaning                                         |
| ------------------------------------- | --------------------------- | -------- | ------- | ----------------------------------------------- |
| `--treasury-owner-public-key <key>`   | `TREASURY_OWNER_PUBLIC_KEY` | Yes      | None    | Parent Treasury Owner.                          |
| `--proposal-public-key <key>`         | `PROPOSAL_PUBLIC_KEY`       | Yes      | None    | Proposal account.                               |
| `--vote <value>`                      | `PROPOSAL_VOTE`             | Yes      | None    | Allowed values are `yay`, `nay`, and `abstain`. |
| `--lifecycle-period-duration <slots>` | `LIFECYCLE_PERIOD_DURATION` | No       | `7140`  | Must equal the compiled duration.               |

### `proposal execute`

Uses the Mina connection, common transaction, and Sender signing options.

| Option                                | Environment                 | Required | Default                                  | Meaning                                               |
| ------------------------------------- | --------------------------- | -------- | ---------------------------------------- | ----------------------------------------------------- |
| `--treasury-owner-public-key <key>`   | `TREASURY_OWNER_PUBLIC_KEY` | Yes      | None                                     | Parent Treasury Owner.                                |
| `--proposal-public-key <key>`         | `PROPOSAL_PUBLIC_KEY`       | Yes      | None                                     | Approved Proposal account.                            |
| `--recipient-public-key <key>`        | `RECIPIENT_PUBLIC_KEY`      | Yes      | None                                     | Must match the recipient hash stored by the Proposal. |
| `--amount-to-pay-out <nanomina>`      | `EXECUTE_PROPOSAL_AMOUNT`   | No       | Full remaining Proposal amount plus bond | Partial execution amount. The parser uses `UInt64`.   |
| `--lifecycle-period-duration <slots>` | `LIFECYCLE_PERIOD_DURATION` | No       | `7140`                                   | Must equal the compiled duration.                     |

### `proposal read-state`

Uses the Mina connection options.

| Option                              | Environment                 | Required | Default | Meaning                                                      |
| ----------------------------------- | --------------------------- | -------- | ------- | ------------------------------------------------------------ |
| `--treasury-owner-public-key <key>` | `TREASURY_OWNER_PUBLIC_KEY` | Yes      | None    | Parent Treasury Owner, used to derive the Proposal token ID. |
| `--proposal-public-key <key>`       | `PROPOSAL_PUBLIC_KEY`       | Yes      | None    | Proposal account to read.                                    |

### `proposal fetch-actions`

This is the only CLI command that reads the Archive endpoint.

| Option                              | Environment                    | Required | Default | Meaning                                                |
| ----------------------------------- | ------------------------------ | -------- | ------- | ------------------------------------------------------ |
| `--archive-node-url <url>`          | `ARCHIVE_NODE_URL`             | Yes      | None    | Complete Archive GraphQL URL.                          |
| `--treasury-owner-public-key <key>` | `TREASURY_OWNER_PUBLIC_KEY`    | Yes      | None    | Parent Owner, used to derive the Proposal token ID.    |
| `--proposal-public-key <key>`       | `PROPOSAL_PUBLIC_KEY`          | Yes      | None    | Proposal whose actions are fetched.                    |
| `--output-path <path>`              | `PROPOSAL_ACTIONS_OUTPUT_PATH` | No       | None    | Optional JSON output file. The result is also printed. |

### `proposal tally-votes`

Uses the Mina connection, common transaction, and Sender signing options.

| Option                                                | Environment                                  | Required | Default | Meaning                                                        |
| ----------------------------------------------------- | -------------------------------------------- | -------- | ------- | -------------------------------------------------------------- |
| `--treasury-owner-public-key <key>`                   | `TREASURY_OWNER_PUBLIC_KEY`                  | Yes      | None    | Parent Treasury Owner.                                         |
| `--proposal-public-key <key>`                         | `PROPOSAL_PUBLIC_KEY`                        | Yes      | None    | Proposal to tally.                                             |
| `--vote-reducer-proof-path <path>`                    | `VOTE_REDUCER_PROOF_PATH`                    | Yes      | None    | Final Vote Reducer proof JSON.                                 |
| `--staking-ledger-to-voting-ledger-proof-path <path>` | `STAKING_LEDGER_TO_VOTING_LEDGER_PROOF_PATH` | Yes      | None    | Final exhausted staking-to-voting proof JSON.                  |
| `--lifecycle-id <id>`                                 | `LIFECYCLE_ID`                               | Yes      | None    | SQLite lifecycle namespace used for the Owner account witness. |
| `--lifecycle-period-duration <slots>`                 | `LIFECYCLE_PERIOD_DURATION`                  | No       | `7140`  | Must equal the compiled duration.                              |

## `pause-controller`

### `pause-controller compile`

| Option                | Environment  | Required | Default | Meaning                           |
| --------------------- | ------------ | -------- | ------- | --------------------------------- |
| `--cache-path <path>` | `CACHE_PATH` | No       | None    | Optional compile cache directory. |

### `pause-controller deploy`

Uses the Mina connection, common transaction, and Sender and Pause Controller
signing options.

| Option                                       | Environment                         | Required | Default | Meaning                                            |
| -------------------------------------------- | ----------------------------------- | -------- | ------- | -------------------------------------------------- |
| `--multisig-participants-public-keys <keys>` | `MULTISIG_PARTICIPANTS_PUBLIC_KEYS` | Yes      | None    | Exactly five comma-separated, ordered public keys. |

### `pause-controller read-state`

Uses the Mina connection options.

| Option                                | Environment                   | Required | Default | Meaning                           |
| ------------------------------------- | ----------------------------- | -------- | ------- | --------------------------------- |
| `--pause-controller-public-key <key>` | `PAUSE_CONTROLLER_PUBLIC_KEY` | Yes      | None    | Pause Controller account to read. |

### `pause-controller pause-treasury`

Uses the Mina connection, common transaction, and Sender signing options.

| Option                                       | Environment                         | Required | Default | Meaning                                                                                                             |
| -------------------------------------------- | ----------------------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| `--pause-controller-public-key <key>`        | `PAUSE_CONTROLLER_PUBLIC_KEY`       | Yes      | None    | Pause Controller account.                                                                                           |
| `--multisig-participants-public-keys <keys>` | `MULTISIG_PARTICIPANTS_PUBLIC_KEYS` | Yes      | None    | Current ordered five-key list.                                                                                      |
| `--multisig-signatures <signatures>`         | `MULTISIG_SIGNATURES`               | Yes      | None    | Three to five comma-separated signatures aligned with the five key positions. Empty entries keep missing positions. |

### `pause-controller unpause-treasury`

Uses the same options and signing role as `pause-controller pause-treasury`.
It clears the global pause state.

### `pause-controller toggle-pause-proposal`

Uses the Mina connection, common transaction, and Sender signing options.

| Option                                       | Environment                         | Required | Default | Meaning                            |
| -------------------------------------------- | ----------------------------------- | -------- | ------- | ---------------------------------- |
| `--pause-controller-public-key <key>`        | `PAUSE_CONTROLLER_PUBLIC_KEY`       | Yes      | None    | Pause Controller account.          |
| `--treasury-owner-public-key <key>`          | `TREASURY_OWNER_PUBLIC_KEY`         | Yes      | None    | Parent Treasury Owner.             |
| `--proposal-public-key <key>`                | `PROPOSAL_PUBLIC_KEY`               | Yes      | None    | Proposal whose status is toggled.  |
| `--multisig-participants-public-keys <keys>` | `MULTISIG_PARTICIPANTS_PUBLIC_KEYS` | Yes      | None    | Current ordered five-key list.     |
| `--multisig-signatures <signatures>`         | `MULTISIG_SIGNATURES`               | Yes      | None    | Aligned current-signer signatures. |
| `--lifecycle-period-duration <slots>`        | `LIFECYCLE_PERIOD_DURATION`         | No       | `7140`  | Must equal the compiled duration.  |

### `pause-controller rotate-multisig-keys`

Uses the Mina connection, common transaction, and Sender signing options.

| Option                                               | Environment                                 | Required | Default | Meaning                                                       |
| ---------------------------------------------------- | ------------------------------------------- | -------- | ------- | ------------------------------------------------------------- |
| `--pause-controller-public-key <key>`                | `PAUSE_CONTROLLER_PUBLIC_KEY`               | Yes      | None    | Pause Controller account.                                     |
| `--current-multisig-participants-public-keys <keys>` | `CURRENT_MULTISIG_PARTICIPANTS_PUBLIC_KEYS` | Yes      | None    | Current ordered five-key list.                                |
| `--multisig-signatures <signatures>`                 | `MULTISIG_SIGNATURES`                       | Yes      | None    | Signatures from the current signer set.                       |
| `--new-multisig-participants-public-keys <keys>`     | `NEW_MULTISIG_PARTICIPANTS_PUBLIC_KEYS`     | Yes      | None    | New ordered five-key list. The CLI calculates its commitment. |

## `multisig-sign`

All four commands create one partial break-glass signature. They do not submit
a Mina transaction.

| Option                                       | Environment                         | Required    | Default     | Meaning                                              |
| -------------------------------------------- | ----------------------------------- | ----------- | ----------- | ---------------------------------------------------- |
| `--signer <mode>`                            | `SIGNER`                            | No          | `in-memory` | Allowed values are `in-memory` and `ledger`.         |
| `--multisig-participants-public-keys <keys>` | `MULTISIG_PARTICIPANTS_PUBLIC_KEYS` | Yes         | None        | Current ordered five-key list.                       |
| `--multisig-signer-private-key <key>`        | `MULTISIG_SIGNER_PRIVATE_KEY`       | Conditional | None        | Required for `in-memory` signing.                    |
| `--ledger-signer-public-key <key>`           | `LEDGER_SIGNER_PUBLIC_KEY`          | Conditional | None        | Expected signer key for Ledger signing.              |
| `--ledger-account-index <integer>`           | `LEDGER_ACCOUNT_INDEX`              | Conditional | None        | Required Ledger index from `0` through `4294967295`. |
| `--nonce <integer>`                          | `TX_NONCE`                          | Yes         | None        | Current Pause Controller state nonce.                |

Command-specific inputs:

| Command                               | Additional option                                | Environment                             | Required | Meaning                                        |
| ------------------------------------- | ------------------------------------------------ | --------------------------------------- | -------- | ---------------------------------------------- |
| `multisig-sign pause-treasury`        | None                                             | None                                    | No       | Signs the pause prefix and nonce.              |
| `multisig-sign unpause-treasury`      | None                                             | None                                    | No       | Signs the unpause prefix and nonce.            |
| `multisig-sign toggle-pause-proposal` | `--proposal-public-key <key>`                    | `PROPOSAL_PUBLIC_KEY`                   | Yes      | Adds the Proposal key to the signed payload.   |
| `multisig-sign rotate-multisig-keys`  | `--new-multisig-participants-public-keys <keys>` | `NEW_MULTISIG_PARTICIPANTS_PUBLIC_KEYS` | Yes      | Adds the new commitment to the signed payload. |

Each current or replacement participant list must contain exactly five unique
public keys. The selected software or Ledger signer must be in the current
participant list.

## `staking-ledger`

`staking-ledger from-file` imports accounts and then hydrates both account
storage and the staking Merkle tree. The two `hydrate-*` commands let the
operator repeat one stage or select a range.

| Command                                  | Option                         | Environment           | Required | Default                  | Meaning                                     |
| ---------------------------------------- | ------------------------------ | --------------------- | -------- | ------------------------ | ------------------------------------------- |
| `staking-ledger from-file`               | `--lifecycle-id <id>`          | `LIFECYCLE_ID`        | Yes      | None                     | Lifecycle data namespace.                   |
| `staking-ledger from-file`               | `--staking-ledger-path <path>` | `STAKING_LEDGER_PATH` | Yes      | None                     | Mina staking ledger JSON.                   |
| `staking-ledger from-file`               | `--start-index <integer>`      | `START_INDEX`         | No       | Start of ledger          | Optional first index.                       |
| `staking-ledger from-file`               | `--end-index <integer>`        | `END_INDEX`           | No       | End of ledger            | Optional last range boundary.               |
| `staking-ledger hydrate-account-storage` | `--lifecycle-id <id>`          | `LIFECYCLE_ID`        | Yes      | None                     | Lifecycle data namespace.                   |
| `staking-ledger hydrate-account-storage` | `--staking-ledger-path <path>` | `STAKING_LEDGER_PATH` | Yes      | None                     | Mina staking ledger JSON.                   |
| `staking-ledger hydrate-account-storage` | `--start-index <integer>`      | `START_INDEX`         | No       | Start of ledger          | Optional first index.                       |
| `staking-ledger hydrate-account-storage` | `--end-index <integer>`        | `END_INDEX`           | No       | End of ledger            | Optional last range boundary.               |
| `staking-ledger hydrate-merkle-tree`     | `--lifecycle-id <id>`          | `LIFECYCLE_ID`        | Yes      | None                     | Lifecycle data namespace.                   |
| `staking-ledger hydrate-merkle-tree`     | `--start-index <integer>`      | `START_INDEX`         | No       | Start of stored accounts | Optional first index.                       |
| `staking-ledger hydrate-merkle-tree`     | `--end-index <integer>`        | `END_INDEX`           | No       | End of stored accounts   | Optional last range boundary.               |
| `staking-ledger get-root-hash`           | `--lifecycle-id <id>`          | `LIFECYCLE_ID`        | Yes      | None                     | Lifecycle whose calculated root is printed. |
| `staking-ledger get-root-hash`           | `--expected-root-hash <hash>`  | `EXPECTED_ROOT_HASH`  | No       | None                     | Fails when the calculated root differs.     |

## `staking-ledger-to-voting-ledger`

`staking-ledger-to-voting-ledger compile` has no command options.

| Command                                         | Option                       | Environment         | Required | Default                                          | Meaning                                                     |
| ----------------------------------------------- | ---------------------------- | ------------------- | -------- | ------------------------------------------------ | ----------------------------------------------------------- |
| `staking-ledger-to-voting-ledger trace-digest`  | `--lifecycle-id <id>`        | `LIFECYCLE_ID`      | Yes      | None                                             | Lifecycle data namespace.                                   |
| `staking-ledger-to-voting-ledger trace-digest`  | `--start-index <integer>`    | `START_INDEX`       | No       | `0` at runtime                                   | First batch index.                                          |
| `staking-ledger-to-voting-ledger trace-digest`  | `--end-index <integer>`      | `END_INDEX`         | No       | All remaining batches                            | Last range boundary.                                        |
| `staking-ledger-to-voting-ledger trace-digest`  | `--checkpoint-interval <integer>` | `CHECKPOINT_INTERVAL` | No    | None                                             | Indices between S3 checkpoints. Requires the S3 URI.        |
| `staking-ledger-to-voting-ledger trace-digest`  | `--checkpoint-s3-uri <uri>`  | `CHECKPOINT_S3_URI` | No       | None                                             | S3 prefix for trace checkpoints.                            |
| `staking-ledger-to-voting-ledger trace-digest`  | `--ledger-hash <hash>`       | `LEDGER_HASH`       | No       | None                                             | Ledger hash recorded in each checkpoint.                    |
| `staking-ledger-to-voting-ledger checkpoint-restore` | `--lifecycle-id <id>`   | `LIFECYCLE_ID`      | Yes      | None                                             | Lifecycle data namespace.                                   |
| `staking-ledger-to-voting-ledger checkpoint-restore` | `--expected-ledger-hash <hash>` | `EXPECTED_LEDGER_HASH` | Yes | None                                          | Required ledger hash for a restored checkpoint.             |
| `staking-ledger-to-voting-ledger checkpoint-restore` | `--s3-uri <uri>`        | `CHECKPOINT_S3_URI` | Yes      | None                                             | S3 prefix that contains the checkpoint.                     |
| `staking-ledger-to-voting-ledger checkpoint-clean` | `--lifecycle-id <id>`     | `LIFECYCLE_ID`      | Yes      | None                                             | Lifecycle data namespace.                                   |
| `staking-ledger-to-voting-ledger checkpoint-clean` | `--s3-uri <uri>`          | `CHECKPOINT_S3_URI` | Yes      | None                                             | S3 prefix whose lifecycle checkpoint is removed.            |
| `staking-ledger-to-voting-ledger prove-digest`  | `--lifecycle-id <id>`        | `LIFECYCLE_ID`      | Yes      | None                                             | Lifecycle data namespace.                                   |
| `staking-ledger-to-voting-ledger prove-digest`  | `--redis-host <host>`        | `REDIS_HOST`        | Runtime  | None                                             | Redis host. The command fails when it is absent.            |
| `staking-ledger-to-voting-ledger prove-digest`  | `--redis-port <integer>`     | `REDIS_PORT`        | Runtime  | None                                             | Redis port. The command fails when it is absent or invalid. |
| `staking-ledger-to-voting-ledger prove-digest`  | `--queue-name <name>`        | `QUEUE_NAME`        | No       | `staking-ledger-to-voting-ledger-<lifecycle-id>` | Proof queue.                                                |
| `staking-ledger-to-voting-ledger prove-digest`  | `--start-index <integer>`    | `START_INDEX`       | No       | `0` at runtime                                   | First proof-task index.                                     |
| `staking-ledger-to-voting-ledger prove-digest`  | `--end-index <integer>`      | `END_INDEX`         | No       | All remaining tasks                              | Last range boundary.                                        |
| `staking-ledger-to-voting-ledger prove-merge`   | `--lifecycle-id <id>`        | `LIFECYCLE_ID`      | Yes      | None                                             | Lifecycle data namespace.                                   |
| `staking-ledger-to-voting-ledger prove-merge`   | `--redis-host <host>`        | `REDIS_HOST`        | Runtime  | None                                             | Redis host.                                                 |
| `staking-ledger-to-voting-ledger prove-merge`   | `--redis-port <integer>`     | `REDIS_PORT`        | Runtime  | None                                             | Redis port.                                                 |
| `staking-ledger-to-voting-ledger prove-merge`   | `--queue-name <name>`        | `QUEUE_NAME`        | No       | `staking-ledger-to-voting-ledger-<lifecycle-id>` | Proof queue.                                                |
| `staking-ledger-to-voting-ledger prove-merge`   | `--proof-output-path <path>` | `PROOF_OUTPUT_PATH` | No       | None                                             | Optional merged-proof JSON file.                            |
| `staking-ledger-to-voting-ledger prove-exhaust` | `--lifecycle-id <id>`        | `LIFECYCLE_ID`      | Yes      | None                                             | Lifecycle data namespace.                                   |
| `staking-ledger-to-voting-ledger prove-exhaust` | `--proof-output-path <path>` | `PROOF_OUTPUT_PATH` | No       | None                                             | Optional exhausted-proof JSON file.                         |

## `vote-reducer`

`vote-reducer compile` has no command options.

| Command                        | Option                       | Environment         | Required | Default                       | Meaning                                                     |
| ------------------------------ | ---------------------------- | ------------------- | -------- | ----------------------------- | ----------------------------------------------------------- |
| `vote-reducer trace-run-batch` | `--lifecycle-id <id>`        | `LIFECYCLE_ID`      | Yes      | None                          | Lifecycle data namespace.                                   |
| `vote-reducer trace-run-batch` | `--vote-actions-path <path>` | `VOTE_ACTIONS_PATH` | Yes      | None                          | Action JSON from `proposal fetch-actions`.                  |
| `vote-reducer prove-run-batch` | `--lifecycle-id <id>`        | `LIFECYCLE_ID`      | Yes      | None                          | Lifecycle data namespace.                                   |
| `vote-reducer prove-run-batch` | `--redis-host <host>`        | `REDIS_HOST`        | Runtime  | None                          | Redis host.                                                 |
| `vote-reducer prove-run-batch` | `--redis-port <integer>`     | `REDIS_PORT`        | Runtime  | None                          | Redis port.                                                 |
| `vote-reducer prove-run-batch` | `--queue-name <name>`        | `QUEUE_NAME`        | No       | `vote-reducer-<lifecycle-id>` | Proof queue.                                                |
| `vote-reducer prove-run-batch` | `--start-index <integer>`    | `START_INDEX`       | No       | `0` at runtime                | First proof-task index.                                     |
| `vote-reducer prove-run-batch` | `--end-index <integer>`      | `END_INDEX`         | No       | All remaining tasks           | Last range boundary.                                        |
| `vote-reducer prove-merge`     | `--lifecycle-id <id>`        | `LIFECYCLE_ID`      | Yes      | None                          | Lifecycle data namespace.                                   |
| `vote-reducer prove-merge`     | `--redis-host <host>`        | `REDIS_HOST`        | Runtime  | None                          | Redis host.                                                 |
| `vote-reducer prove-merge`     | `--redis-port <integer>`     | `REDIS_PORT`        | Runtime  | None                          | Redis port.                                                 |
| `vote-reducer prove-merge`     | `--queue-name <name>`        | `QUEUE_NAME`        | No       | `vote-reducer-<lifecycle-id>` | Proof queue.                                                |
| `vote-reducer prove-merge`     | `--proof-output-path <path>` | `PROOF_OUTPUT_PATH` | No       | None                          | Optional merged-proof JSON file.                            |
| `vote-reducer clear-state`     | `--lifecycle-id <id>`        | `LIFECYCLE_ID`      | Yes      | None                          | Local lifecycle state to clear. Voting-ledger data is kept. |

## Services

### `worker start`

| Option                   | Environment  | Required | Default | Meaning                              |
| ------------------------ | ------------ | -------- | ------- | ------------------------------------ |
| `--queue-name <name>`    | `QUEUE_NAME` | Yes      | None    | BullMQ queue consumed by the worker. |
| `--redis-host <host>`    | `REDIS_HOST` | Yes      | None    | Redis host.                          |
| `--redis-port <integer>` | `REDIS_PORT` | Yes      | None    | Redis port.                          |

The `voting-ledger-scheduler` is a Compose service, not a CLI command. Its
Bash entrypoint calls the registered `staking-ledger-to-voting-ledger`
commands.

## Development and utility commands

### `lightnet acquire-account`

| Option                                      | Environment                         | Required | Default                         | Meaning                         |
| ------------------------------------------- | ----------------------------------- | -------- | ------------------------------- | ------------------------------- |
| `--mina-node-url <url>`                     | `MINA_NODE_URL`                     | No       | `http://127.0.0.1:8080/graphql` | Lightnet Mina GraphQL endpoint. |
| `--lightnet-account-manager-endpoint <url>` | `LIGHTNET_ACCOUNT_MANAGER_ENDPOINT` | No       | `http://127.0.0.1:8181`         | Account manager endpoint.       |

The command uses the `devnet` network ID and prints the acquired private key.
Use it only for development.

### `generate-keypair`

| Option   | Environment | Required | Default | Meaning                    |
| -------- | ----------- | -------- | ------- | -------------------------- |
| `--json` | None        | No       | `false` | Print one keypair as JSON. |

This command prints a private key. Use it only for development.

### `generate-keypairs` `<number-of-keypairs>`

The `generate-keypairs` command has one positional input.
`<number-of-keypairs>` is the only positional CLI argument. It is required and
is parsed as an integer.

| Option   | Environment | Required | Default | Meaning                               |
| -------- | ----------- | -------- | ------- | ------------------------------------- |
| `--json` | None        | No       | `false` | Print the generated keypairs as JSON. |

This command prints private keys. Use it only for development.

### `transfer`

Uses the Mina connection, common transaction, and Sender and Funding signing
options.

| Option                         | Environment            | Required | Default | Meaning             |
| ------------------------------ | ---------------------- | -------- | ------- | ------------------- |
| `--recipient-public-key <key>` | `RECIPIENT_PUBLIC_KEY` | Yes      | None    | Transfer recipient. |
| `--amount <nanomina>`          | `TRANSFER_AMOUNT`      | Yes      | None    | Transfer amount.    |

The funding account defaults to the sender. A different funding account needs
its matching private key or Ledger public key and index.

### `mina-ledger-parity`

| Option or argument              | Environment   | Required | Default                                | Meaning                                                                      |
| ------------------------------- | ------------- | -------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| `-n`, `--account-count <count>` | None          | Yes      | None                                   | Number of test accounts. Use an integer from `0` through `100000`.           |
| `--mina-binary <path>`          | `MINA_BINARY` | No       | Sibling build, then `mina` from `PATH` | OCaml Mina binary. An explicit option has first priority.                    |
| `--min-balance <mina>`          | None          | No       | Mina generator default                 | Minimum generated account balance.                                           |
| `--max-balance <mina>`          | None          | No       | Mina generator default                 | Maximum generated account balance.                                           |
| `--zkapp-percentage <integer>`  | None          | No       | `50`                                   | Percentage of accounts with zkApp state. Allowed range is `0` through `100`. |
| `--seed <text>`                 | None          | No       | Random 32-byte hexadecimal value       | Seed for enriched account fields. Mina still creates random account keys.    |
| `--ledger-output-path <path>`   | None          | No       | Temporary file                         | Keeps the generated ledger at the specified path.                            |
| `--check-circuit`               | None          | No       | `false`                                | Runs the no-proof staking-to-voting circuit method check.                    |

## Command discovery

The root help lists every top-level command:

```bash
dotenvx run -f <CLI_ENV_FILE> -- pnpm run cli -- --help
```

Use help at the leaf command. Parent help lists subcommands but not every leaf
option:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- proposal create --help

dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- pause-controller rotate-multisig-keys --help
```

## Public deployment configuration utility

`pnpm deployment:config -- --input <PUBLIC_INPUT_JSON>` is a repository
utility. It is not part of the `pnpm run cli --` command tree. It validates the
public compile, deployment, state, and direct Mina query results.

Use the complete procedure in
[Deploy the Treasury](../deployment/deploy-the-treasury.md#generate-the-public-configuration-record).

## Sources

- `apps/cli/src/cli.ts`
- `apps/cli/src/commands/generate-keypairs.ts`
- `apps/cli/src/commands/lightnet.ts`
- `apps/cli/src/commands/mina-instance.ts`
- `apps/cli/src/commands/mina-ledger-parity.ts`
- `apps/cli/src/commands/multisig-sign.ts`
- `apps/cli/src/commands/pause-controller.ts`
- `apps/cli/src/commands/proposal.ts`
- `apps/cli/src/commands/staking-ledger.ts`
- `apps/cli/src/commands/staking-ledger-to-voting-ledger.ts`
- `apps/cli/src/commands/transfer.ts`
- `apps/cli/src/commands/treasury-owner.ts`
- `apps/cli/src/commands/vote-reducer.ts`
- `devops/docker/voting-ledger-scheduler-entrypoint.sh`
- `apps/cli/src/commands/worker.ts`
- `apps/cli/src/ledger/transaction-signer.ts`
- `packages/sdk/src/services/sqlite/sqlite-pause-controller-service.ts`
- `devops/runbooks/2-Treasury/2b-Deploy-Contracts/README.md`
- `devops/runbooks/2-Treasury/2d-Lifecycle-Pipeline/README.md`
