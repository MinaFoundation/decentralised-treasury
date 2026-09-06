---
title: Use the CLI
sidebar_label: CLI
sidebar_position: 10
audience: user
page_kind: procedure
---

Use the CLI when the web application does not support your required sender or workflow.
The CLI can create, vote, read state, and execute.

Operator commands also prepare ledgers, proofs, tallies, and pause actions.
Those commands are outside this user workflow.

## Safety Rules

:::danger Plain-text private keys

The current private-key mode reads keys as plain text. Do not use this mode
with production keys. Use Ledger signing or an approved custody process for
real funds.

:::

Check these values before each command:

- `MINA_NODE_URL`;
- `MINA_NETWORK_ID`;
- `TREASURY_OWNER_PUBLIC_KEY`;
- `LIFECYCLE_PERIOD_DURATION`;
- the sender public key and Ledger account index;
- the proposal public key;
- the amount in nanomina;
- the transaction fee and nonce.

The CLI does not detect the signature network from the Mina node URL.
The network ID applies to all signed Mina transactions.
This rule applies to `in-memory` and `ledger` signing.
Set `--network-id` or `MINA_NETWORK_ID` explicitly.

Use `MINA_NODE_URL` for the commands on this page.
Only `proposal create` also uses `TREASURY_API_URL` for Proposal content.
Only `proposal fetch-actions` uses `ARCHIVE_NODE_URL`.

The CLI gives a command option precedence over its matching environment field.
It uses the built-in default only when neither value exists.
The built-in network ID is `devnet`.

## Get Command Help

Run commands from the repository root.

```bash
pnpm run cli -- proposal --help
pnpm run cli -- proposal create --help
pnpm run cli -- proposal vote --help
pnpm run cli -- proposal execute --help
```

See the [complete CLI command reference](/operate/reference/cli-commands) for
every option, environment field, and operational command.

## Read Proposal State

This command does not sign or send a transaction.

```bash
pnpm run cli -- proposal read-state \
  --treasury-owner-public-key <TREASURY_OWNER_PUBLIC_KEY> \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY>
```

Check `status`, `paidOutAmount`, the recipient hash, amount, lifecycle ID, and snapshot fields.

## Create with Ledger

You can supply `--proposal-private-key` for a predetermined Proposal address.
Otherwise, the CLI generates the Proposal keypair in memory, adds the new
account signature, and discards the private key. The Ledger signs only the
sender authorization.
The current builder uses the sender as the bond payer.
The sender is also the fee payer. `--nonce` or `TX_NONCE` selects its nonce.

```bash
pnpm run cli -- proposal create \
  --signer=ledger \
  --network-id=<NETWORK_ID> \
  --sender-public-key <SENDER_PUBLIC_KEY> \
  --sender-ledger-account-index <SENDER_INDEX> \
  --proposal-private-key <OPTIONAL_DEPLOYMENT_KEY> \
  --treasury-owner-public-key <TREASURY_OWNER_PUBLIC_KEY> \
  --proposal-lifecycle-id <LIFECYCLE_ID> \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --amount <NANOMINA> \
  --content-file <MARKDOWN_PATH>
```

The Proposal private key cannot authorize later Proposal control. Proposal
state uses proof authorization, and its custom-token account updates require
Treasury Owner approval.

The command waits for inclusion by default.
It then retries the content upload for up to 60 seconds.

Save the returned proposal address, transaction hash, and content result.

## Vote with Ledger

The sender and voter can be the same Ledger account.
Both roles must identify their public key and account index.
The sender is the fee payer. `--nonce` or `TX_NONCE` selects its nonce.

```bash
pnpm run cli -- proposal vote \
  --signer=ledger \
  --network-id=<NETWORK_ID> \
  --sender-public-key <VOTER_PUBLIC_KEY> \
  --sender-ledger-account-index <VOTER_INDEX> \
  --voter-public-key <VOTER_PUBLIC_KEY> \
  --voter-ledger-account-index <VOTER_INDEX> \
  --treasury-owner-public-key <TREASURY_OWNER_PUBLIC_KEY> \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --vote <VOTE>
```

Set `<VOTE>` to `yay`, `nay`, or `abstain`.
Run this command only during the Voting period.
Keep the returned transaction hash.

## Wait for Tally and Check the Result

Voting does not approve a proposal by itself. Wait for the operator to build
the proofs and submit a successful tally. Then read Proposal state:

```bash
pnpm run cli -- proposal read-state \
  --mina-node-url <MINA_GRAPHQL_URL> \
  --network-id <NETWORK_ID> \
  --treasury-owner-public-key <TREASURY_OWNER_PUBLIC_KEY> \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY>
```

Continue only when `status` is `APPROVED`. Use `treasury-owner read-state` to
confirm that the current lifecycle is later than the Proposal lifecycle.

See [Results and Acceptance](results-and-acceptance.md) for the result states.

## Execute with Ledger

Any signed sender can submit a valid execution transaction.
Use an explicit amount when the shared treasury balance might be low.
The sender is the fee payer. `--nonce` or `TX_NONCE` selects its nonce.

```bash
pnpm run cli -- proposal execute \
  --signer=ledger \
  --network-id=<NETWORK_ID> \
  --sender-public-key <SENDER_PUBLIC_KEY> \
  --sender-ledger-account-index <SENDER_INDEX> \
  --treasury-owner-public-key <TREASURY_OWNER_PUBLIC_KEY> \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --amount-to-pay-out <NANOMINA>
```

If you omit `--amount-to-pay-out`, the CLI selects the full remaining request plus bond.
The transaction fails when the shared treasury balance cannot cover that amount.

## After a Transaction

The CLI waits for inclusion by default and returns a transaction hash.
The hash alone does not confirm the expected account state.

Read the Proposal account from the Mina network.
Then wait for the application projection to update.

Use [Verifiability and Trust](verifiability-and-trust.md) for the user
reconciliation procedure. For operator detail, use
[Ideal Lifecycle Operation](/operate/lifecycle/ideal-lifecycle).

## Sources

- `apps/cli/README.md`
- `apps/cli/src/commands/proposal.ts` — `proposal create`, `proposal vote`, `proposal read-state`, `proposal execute`
- `apps/cli/src/commands/mina-instance.ts` — `minaNetworkIdOption`
- `apps/cli/src/ledger/transaction-signer.ts` — Ledger role and account-index options
- `apps/cli/src/commands/proposal-content-api.ts` — `submitProposalContents`
