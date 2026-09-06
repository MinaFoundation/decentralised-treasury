---
title: Ideal Lifecycle Operation
sidebar_label: Ideal lifecycle
audience: operator
page_kind: procedure
---

# Ideal Lifecycle Operation

This procedure runs one complete lifecycle on a real Mina testnet. It keeps
all state reconciliation in the procedure.

Use `devops/TESTNET.md` as the primary command source. Use `DEMO.md` only for
the simulator and web application flow.

Read the [CLI prerequisites](../cli/prerequisites.md) before signing. Use the
[CLI command index](../reference/cli-commands.md) to check command options.
Use [Failures and Remedies](../failures/index.md) when a reconciliation step
does not pass.

## Prerequisite: Complete Configuration and Deployment

Complete [Configure the Treasury](configure-the-treasury.md). Then complete
[Deploy the Treasury](../deployment/deploy-the-treasury.md). Complete
the pre-start parts of the [operator checklist](../operator-checklist.md).

For Kubernetes, complete [2c. Deploy Stack](../infrastructure/deploy-stack.md)
after contract deployment. Use
[2d. Lifecycle Pipeline](../infrastructure/lifecycle-pipeline.md) for the
automatic ledger and proof pipeline.

These checks cover the toolchain, network, lifecycle, accounts, compile, and
deployment results.

Complete the static data and service checks before step 1. After step 2,
complete the runtime data checks and the First Operational Check.

Do not start this lifecycle procedure when a configuration comparison fails.

## 1. Fund and Reconcile

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- treasury-owner fund-treasury \
  --amount 1000000000000
```

Read Treasury Owner state again. Query its Mina account balance. Confirm that
the balance increased by the amount in the included funding transaction.

## 2. Start the Stack and Proof Services

This command sequence is for Compose. For Kubernetes, use
[2c. Deploy Stack](../infrastructure/deploy-stack.md) and check its public
routes. Do not run the Compose start commands against the Kubernetes deployment.

Set `PROOFS_ENABLED=true` in `<DEVOPS_ENV_FILE>` and
`<API_ENV_FILE>`. The resolved scheduler and worker value must be exactly
`true`.

Complete the proving-profile configuration check in
[Start proof services](../services/service-operations.md#start-proof-services)
before this start.

Start with the proving profile:

```bash
pnpm testnet:up:proving
```

If an image is absent or the code changed, use:

```bash
pnpm testnet:up:proving:build
```

Check the service routes:

```bash
curl http://127.0.0.1:4100/healthz
curl http://127.0.0.1:4101/status
curl http://127.0.0.1:4102/status
```

Confirm that the indexer and processor remaining counts decrease. A successful
health response does not confirm data progress.

Complete the runtime data checks and the First Operational Check in the
[operator checklist](../operator-checklist.md).

## 3. Prepare the Lifecycle Staking Snapshot

Read [Ledgers and Proving](../proving/ledgers-and-proving.md) for the complete
snapshot selection, import, proof, and recovery procedures.

The snapshot file name depends on the deployment mode:

| Mode | File name |
| --- | --- |
| Manual or Compose | `<epoch>-<ledger-hash>.tar.gz` |
| Kubernetes staking-ledger provider | `staking-<epoch>-<ledger-hash>.json.tar.gz` |

For Kubernetes snapshot capture and HTTP publication, use
[1c. Staking Ledger Provider](../infrastructure/staking-ledger-provider.md).

The voting-ledger scheduler selects the lifecycle start epoch. It imports the
ledger, checks its root, runs `trace-digest`, and writes:

```text
<SQLITE_DATA_HOST_PATH>/<L>.sqlite.done
```

The proving scheduler processes the marker. It writes:

```text
<SQLITE_DATA_HOST_PATH>/proofs/<L>-merge.json
<SQLITE_DATA_HOST_PATH>/proofs/<L>-exhausted.json
<SQLITE_DATA_HOST_PATH>/<L>.sqlite.proven
```

Follow the scheduler logs:

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  logs -f voting-ledger-scheduler proving-scheduler proving-worker
```

Confirm the `.done` marker ledger hash. Later, compare it with the proposal
snapshot hash.

## 4. Create a Proposal and Reconcile

Create one Markdown file. The API default limit is `32768` characters. The
content must be non-empty and pass explicit-language validation.

Validate the exact file before you create an on-chain commitment:

```bash
jq -Rs '{contents:.}' <PROPOSAL_MARKDOWN_PATH> \
  | curl --fail-with-body -sS -X POST \
      http://127.0.0.1:4100/proposals/content/verify \
      -H 'content-type: application/json' \
      --data-binary @- \
  | jq -e '.ok == true and .passesSubmissionChecks == true'
```

Continue only when the final command prints `true` and exits successfully.

During the proposal period, submit the proposal:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- proposal create \
  --proposal-lifecycle-id <L> \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --amount <REQUESTED_NANOMINA> \
  --content-file <PROPOSAL_MARKDOWN_PATH>
```

You can supply `--proposal-private-key` for a predetermined address. If it is
absent, the CLI generates the Proposal keypair in memory and discards the
private key after deployment. The private key cannot authorize later Proposal
control. Proposal state uses proof authorization, and its custom-token account
updates require Treasury Owner approval. Save `proposalAddress` from the output
for reconciliation and later operations.

The CLI commits a content hash on-chain. After inclusion, it submits the
Markdown to the App API. The CLI retries HTTP `503` responses and the specific
missing-projection HTTP `404` response for up to 60 seconds. It does not retry
network failures or other HTTP responses.

Content submission failure does not reverse proposal creation. Do not submit
another proposal until you query the Mina account. Use the
[content upload remedy](../failures/index.md#proposal-content-upload-failure)
for an included proposal.

Read the proposal state:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- proposal read-state \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY>
```

Confirm the following values:

- lifecycle ID;
- requested amount;
- recipient hash;
- status `UNKNOWN`;
- `paidOutAmount=0`;
- snapshot ledger hash and total currency.

Compare the snapshot ledger hash with the `.done` marker. Confirm that the API
shows the exact Markdown after the processor projects the proposal.

Proposal creation transfers `floor(requestedAmount / 10)` to the shared
Treasury Owner balance. Confirm that balance change on the MINA network.

## 5. Vote and Reconcile

Wait for the voting period. Use `treasury-owner read-state` to check the
current period.

Confirm that each voter account exists on the target MINA network. Confirm
that each fee payer has sufficient MINA. For a local or test account, use
`transfer` to create and fund the account:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- transfer \
  --recipient-public-key <VOTER_PUBLIC_KEY> \
  --amount <NANOMINA>
```

Funding creates an account and supplies transaction fees. It does not create
voting weight. The selected staking snapshot determines voting weight.

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- proposal vote \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --voter-private-key <VOTER_PRIVATE_KEY> \
  --vote yay \
  --wait true
```

Use `yay`, `nay`, or `abstain`. Repeat the command for each voter.

Keep each included transaction hash. Confirm that the Archive endpoint returns
the proposal actions. Confirm that the vote projection contains each expected
voter and choice.

## 6. Build the Vote Reducer Proof

Read the detailed
[Vote Reducer procedure](../proving/ledgers-and-proving.md#build-the-vote-reducer-proof)
before this step.

Fetch proposal actions:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- proposal fetch-actions \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --output-path .data/testnet/vote-actions.json
```

Set the CLI SQLite directory to the same absolute host directory that Compose
mounts. Then compile and trace:

```bash
SQLITE_DATA_DIRECTORY=<SQLITE_DATA_HOST_PATH> \
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- vote-reducer compile

SQLITE_DATA_DIRECTORY=<SQLITE_DATA_HOST_PATH> \
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- vote-reducer trace-run-batch \
  --lifecycle-id <L> \
  --vote-actions-path .data/testnet/vote-actions.json
```

Start a host-reachable Redis and one Vote Reducer worker:

```bash
docker run --rm -p 6379:6379 redis:7-alpine
```

In another terminal, run:

```bash
SQLITE_DATA_DIRECTORY=<SQLITE_DATA_HOST_PATH> \
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- worker start \
  --queue-name vote-reducer-<L> \
  --redis-host 127.0.0.1 \
  --redis-port 6379
```

Prove and merge:

```bash
SQLITE_DATA_DIRECTORY=<SQLITE_DATA_HOST_PATH> \
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- vote-reducer prove-run-batch \
  --lifecycle-id <L> \
  --queue-name vote-reducer-<L> \
  --redis-host 127.0.0.1 \
  --redis-port 6379

SQLITE_DATA_DIRECTORY=<SQLITE_DATA_HOST_PATH> \
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- vote-reducer prove-merge \
  --lifecycle-id <L> \
  --queue-name vote-reducer-<L> \
  --redis-host 127.0.0.1 \
  --redis-port 6379 \
  --proof-output-path .data/testnet/vote-reducer-merge.json
```

Confirm that the action-state targets match the proposal account. Confirm that
the proof totals match the intended first votes.

## 7. Tally and Reconcile

Wait for cooldown or a later period. Confirm that the staking exhausted proof
exists for lifecycle `<L>`.

```bash
SQLITE_DATA_DIRECTORY=<SQLITE_DATA_HOST_PATH> \
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- proposal tally-votes \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --vote-reducer-proof-path .data/testnet/vote-reducer-merge.json \
  --staking-ledger-to-voting-ledger-proof-path <SQLITE_DATA_HOST_PATH>/proofs/<L>-exhausted.json \
  --lifecycle-id <L> \
  --wait true
```

Read proposal state after inclusion. Confirm `APPROVED` or `REJECTED`. Confirm
the tally event and processor projection show the same vote totals and result.

Tally has three negative outcomes:

- Sufficient participation with some `yay` or `nay` can succeed as `REJECTED`.
- Insufficient participation fails and leaves status `UNKNOWN`.
- Abstain-only input fails and leaves status `UNKNOWN`.

The operator can skip an expected failing tally. The proposal then stays
`UNKNOWN`.

## 8. Execute an Approved Proposal and Reconcile

Wait until lifecycle `<L + 1>`. Confirm that the proposal status is
`APPROVED`. Confirm the recipient again.

The default command requests the complete remaining amount:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- proposal execute \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --wait true
```

Use a partial amount when the shared Treasury Owner balance is smaller:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- proposal execute \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --amount-to-pay-out <NANOMINA> \
  --wait true
```

Approved proposals do not reserve treasury funds. Transaction order and the
shared balance control the executable amount.

After inclusion, confirm these Mina values:

- the Treasury Owner balance decreased by the executed amount;
- the recipient balance increased by the executed amount;
- proposal `paidOutAmount` increased by the executed amount;
- the execution event contains the same proposal and amount;
- the processor projection matches the Mina account state.

The maximum total execution is the requested amount plus its bond component.
Partial execution can continue until `paidOutAmount` reaches that value.

## Sources

- `devops/TESTNET.md`
- `DEMO.md`
- `apps/cli/README.md`
- `apps/cli/src/commands/proposal.ts`
- `apps/cli/src/commands/proposal-content-api.ts`
- `packages/sdk/src/provable/contracts/treasury-owner.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts`
- `devops/docker/voting-ledger-scheduler-entrypoint.sh`
- `devops/docker/proving-scheduler-entrypoint.sh`
- `devops/runbooks/1-Network/1c-Staking-Ledger-Provider/README.md`
- `devops/runbooks/2-Treasury/2c-Deploy-Stack/README.md`
- `devops/runbooks/2-Treasury/2d-Lifecycle-Pipeline/README.md`
