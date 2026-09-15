---
title: CLI Prerequisites
sidebar_label: CLI prerequisites
audience: operator
page_kind: procedure
---

# CLI Prerequisites

Before a CLI command can safely sign or submit a transaction, the toolchain,
network, environment, and signer must agree. Complete these checks before the
command steps in [Deploy the Treasury](../deployment/deploy-the-treasury.md).

## Install the Toolchain

Use the Node.js version in the repository `.nvmrc` file. The current pinned
version is `24.6.0`. The package engine minimum does not replace this pin.

Enable Corepack. The workspace selects pnpm `9.0.0`.

Install the locked workspace dependencies from the repository root:

```bash
nvm install
nvm use
corepack enable
node --version
pnpm --version
CI=true pnpm install --frozen-lockfile
```

Use the generated environment family for operator commands. Run commands from
the repository root. `<CLI_ENV_FILE>` means the CLI file from
[environment generation](../lifecycle/configure-the-treasury.md#generate-an-environment-family).

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- <command> [subcommand] [arguments] [options]
```

Use the `local-blockchain` family only with the simulator.

For the ordered Kubernetes deployment sequence, continue with
[2b. Deploy Contracts](../infrastructure/deploy-contracts.md) after you select
the Treasury configuration. Use
[2a. Generate Treasury Wallet](../infrastructure/generate-treasury-wallet.md)
only for a disposable devnet fee-payer key. Generate a real-value key with the
approved offline custody process.

## Environment Inputs

Confirm these inputs before a state-changing command:

- `MINA_NODE_URL` points to the target MINA network;
- `MINA_NETWORK_ID` is `mainnet`, `devnet`, or `testnet`;
- `LIFECYCLE_PERIOD_DURATION` matches the compiled contracts;
- the Treasury Owner and Pause Controller addresses are correct;
- `TX_FEE` is sufficient for the target network.

Use each endpoint only for its specified command:

| CLI option                 | Environment field  | Default                         | CLI use                                                                                 |
| -------------------------- | ------------------ | ------------------------------- | --------------------------------------------------------------------------------------- |
| `--mina-node-url <url>`    | `MINA_NODE_URL`    | `http://127.0.0.1:8080/graphql` | On-chain reads and Mina transactions.                                                   |
| `--archive-node-url <url>` | `ARCHIVE_NODE_URL` | None                            | `proposal fetch-actions` only; required for that command.                               |
| `--api-url <url>`          | `TREASURY_API_URL` | `http://127.0.0.1:4100`         | `proposal create` only, for the Proposal content submission after the Mina transaction. |

The CLI does not derive the signature network from `MINA_NODE_URL`.
`MINA_NETWORK_ID` applies to every signed Mina transaction in both signer modes.
You can use `--network-id` instead. Set the value explicitly for each target
network.

Amounts and fees use nanomina.

## In-Memory Signing

In-memory signing reads each required private key from a command option or
environment value.

Private keys in CLI options and environment values are plain text. Do not use
this mode with funds or keys that need hardened key custody.

Different transaction roles can use different keys. For example, a fee payer
and funding account can be different accounts.

For a `proofOrSignature` deployment, do not keep the Treasury Owner emergency
key in a shared environment file. Prefer Ledger signing for
`treasury-owner emergency-withdraw`.

## Ledger Signing

Use [Signing with Ledger and
Auro](/learn/signing-with-ledger-and-auro#set-up-ledger-for-the-cli) for the
complete wallet setup and approval checks. The CLI supports Ledger and
`in-memory` signing. It does not support Auro.

Connect and unlock the Ledger. Open the Mina app. Enable blind signing. Close
Ledger Live before the command starts.

For each signing role, provide both values:

- the expected public key;
- the explicit Ledger account index.

Example:

```bash
SENDER_PUBLIC_KEY=<LEDGER_PUBLIC_KEY> \
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- transfer \
  --signer=ledger \
  --sender-ledger-account-index=<LEDGER_ACCOUNT_INDEX> \
  --network-id=testnet \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --amount <NANOMINA>
```

The CLI does not scan Ledger accounts. It checks that each configured index
returns the expected public key.

The CLI rejects these configurations:

- a required signing role without an index;
- one public key assigned to two indices;
- one index assigned to two public keys;
- an index outside `0` through `4294967295`.

Use distinct role options for multi-account transactions. Each account can
require a different Ledger index. Deployment can require the fee payer,
Treasury Owner, and Pause Controller Ledger accounts.

## Ledger Commands

Ledger transaction signing is available for:

- `treasury-owner deploy`;
- `treasury-owner fund-treasury`;
- `treasury-owner emergency-withdraw`;
- `proposal create`;
- `proposal vote`;
- `proposal tally-votes`;
- `proposal execute`;
- `pause-controller deploy`;
- `pause-controller pause-treasury`;
- `pause-controller unpause-treasury`;
- `pause-controller toggle-pause-proposal`;
- `pause-controller rotate-multisig-keys`;
- `transfer`.

For `proposal create`, the Ledger signs the Sender only. The CLI uses the
optional Proposal private key in memory or generates one for deployment.

Ledger partial signing is also available for these field-signature commands:

- `multisig-sign pause-treasury`;
- `multisig-sign unpause-treasury`;
- `multisig-sign toggle-pause-proposal`;
- `multisig-sign rotate-multisig-keys`.

A partial signature does not create or submit a Mina transaction.

The Ledger signs the complete transaction after proof generation when a proof
is required. Emergency withdrawal has no proof step. The CLI then submits the
signed transaction to the Mina node. It does not export a signed transaction
for offline submission.

For each deploy or Pause Controller submission, confirm that the ordered list
contains five unique participant keys. The deploy and submission commands
check the list length. They do not enforce unique keys. The `multisig-sign`
commands enforce uniqueness when they parse current and replacement lists.

## Verify a Ledger Before Use

Run the software and APDU mock checks:

```bash
pnpm verify:ledger
```

Add `--device` for a physical Ledger check:

```bash
pnpm verify:ledger -- --device
```

Find the result whose `name` is `physical-ledger`. Its `status` must be `PASS`.
The command exit status does not include this optional physical-device result.

On the target network, confirm these items on the device:

1. The account index returns the expected public key.
2. The network ID is correct.
3. The fee, nonce, memo, and account updates are expected.
4. The device approves the intended transaction only.

## Deploy Only a Pause Controller With Ledger

Use this procedure only when you must deploy a Pause Controller without a
Treasury Owner deployment. The normal Treasury deployment creates both
contracts in one ordered procedure.

Before you start, confirm these items:

1. The Sender has enough MINA for the fee and the new account.
2. The Pause Controller public key identifies an unused account.
3. The two Ledger account indices return the expected public keys.
4. The participant list contains five unique keys in the approved order.
5. `MINA_NODE_URL` and `<NETWORK_ID>` identify the same target network.

Run the deployment from the repository root:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- pause-controller deploy \
  --signer ledger \
  --network-id <NETWORK_ID> \
  --sender-public-key <SENDER_PUBLIC_KEY> \
  --sender-ledger-account-index <SENDER_LEDGER_ACCOUNT_INDEX> \
  --pause-controller-public-key <PAUSE_CONTROLLER_PUBLIC_KEY> \
  --pause-controller-ledger-account-index <PAUSE_CONTROLLER_LEDGER_ACCOUNT_INDEX> \
  --multisig-participants-public-keys <KEY_1>,<KEY_2>,<KEY_3>,<KEY_4>,<KEY_5> \
  --wait true
```

Review the target network and deployment account before each Ledger approval.
Stop if the device returns a different public key. Keep the returned
`pauseControllerTxHash` and `multisigCommitment`.

Read the included state:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- pause-controller read-state \
  --network-id <NETWORK_ID> \
  --pause-controller-public-key <PAUSE_CONTROLLER_PUBLIC_KEY>
```

Confirm the Pause Controller address. Confirm that the on-chain
`multisigCommitment` equals the deployment result. Confirm that `paused` is
`false`. Do not connect a Treasury Owner to this controller until all values
match the approved configuration.

Use the [`pause-controller deploy` option
reference](../reference/cli-commands.md#pause-controller-deploy) for optional
fee, nonce, memo, and wait inputs.

## Transfer MINA With Ledger

Confirm the Sender, recipient, amount, fee, target network, and Ledger account
index. The Sender is the funding account unless you supply a different funding
account. The Sender also pays the new-account fee when the recipient does not
exist.

Run a transfer that uses the Sender as the funding account:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- transfer \
  --signer ledger \
  --network-id <NETWORK_ID> \
  --sender-public-key <SENDER_PUBLIC_KEY> \
  --sender-ledger-account-index <SENDER_LEDGER_ACCOUNT_INDEX> \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --amount <NANOMINA> \
  --wait true
```

If another Ledger account supplies the transferred MINA, add both of these
options:

```text
--funding-public-key <FUNDING_PUBLIC_KEY>
--funding-ledger-account-index <FUNDING_LEDGER_ACCOUNT_INDEX>
```

Review each account and the transfer before each Ledger approval. Keep the
returned `transferTxHash`. Confirm inclusion and the recipient balance on the
target Mina node. If the result is uncertain, query Mina before you retry.

Use the [`transfer` option
reference](../reference/cli-commands.md#transfer) for optional fee, nonce, memo,
and wait inputs.

## Transaction Options

State-changing commands normally support these options:

| Option              | Environment field | Default or omitted behavior    | Purpose                         |
| ------------------- | ----------------- | ------------------------------ | ------------------------------- |
| `--fee <nanomina>`  | `TX_FEE`          | `1000000000` nanomina          | Fee paid by the sender.         |
| `--nonce <integer>` | `TX_NONCE`        | Current sender nonce from Mina | Explicit fee-payer nonce.       |
| `--memo <text>`     | `TX_MEMO`         | None                           | Mina transaction memo.          |
| `--wait <boolean>`  | `TX_WAIT`         | `true`                         | Wait for transaction inclusion. |
| `--network-id <id>` | `MINA_NETWORK_ID` | `devnet`                       | Mina signature network.         |
| `--signer <mode>`   | `SIGNER`          | `in-memory`                    | `in-memory` or `ledger`.        |

For each option, the CLI uses this precedence:

1. The command option.
2. The matching environment field.
3. The built-in default, when the option has a default.

On transaction commands, `--nonce` or `TX_NONCE` is the fee-payer account
nonce. If you omit it, the transaction builder gets the nonce from Mina.

For `pause-controller pause-treasury`, `unpause-treasury`,
`toggle-pause-proposal`, and `rotate-multisig-keys`, use `--controller-nonce` or
`PAUSE_CONTROLLER_NONCE` to set the separate controller nonce signed by the
multisig. If omitted, the service reads the controller nonce from Mina.
The fee-payer nonce is selected independently.

On a `multisig-sign` command, `--nonce` or `TX_NONCE` is the Pause Controller
state nonce. The command puts this nonce in the partial-signature payload.
It does not build or submit a Mina transaction.

Use `--wait true` before a dependent operation. If a command result is
uncertain, query Mina state before a retry.

## Proof and Data Paths

Tally needs the same lifecycle SQLite data that contains the staking account
witness. Set `SQLITE_DATA_DIRECTORY` to that absolute directory.

The CLI and Compose defaults can identify different host directories. Do not
assume that their relative paths identify the same files.

Use one lifecycle ID for all these inputs:

- staking ledger import;
- staking conversion trace and proof;
- Vote Reducer trace and proof;
- proposal tally.

## Discover Options

See the [complete CLI command reference](../reference/cli-commands.md) for all
commands, signatures, and environment fields.

```bash
dotenvx run -f <CLI_ENV_FILE> -- pnpm run cli -- --help
dotenvx run -f <CLI_ENV_FILE> -- pnpm run cli -- proposal --help
dotenvx run -f <CLI_ENV_FILE> -- pnpm run cli -- treasury-owner --help
dotenvx run -f <CLI_ENV_FILE> -- pnpm run cli -- pause-controller --help
```

## Sources

- `.nvmrc`
- `package.json`
- `apps/cli/README.md`
- `apps/cli/src/ledger/transaction-signer.ts`
- `apps/cli/src/ledger/ledger-signing.ts`
- `apps/cli/src/commands/mina-instance.ts`
- `apps/cli/src/commands/proposal.ts`
- `apps/cli/src/commands/treasury-owner.ts`
- `devops/runbooks/2-Treasury/2a-Generate-Treasury-Wallet/README.md`
- `devops/runbooks/2-Treasury/2b-Deploy-Contracts/README.md`
