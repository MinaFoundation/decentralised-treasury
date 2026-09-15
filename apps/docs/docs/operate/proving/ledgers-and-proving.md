---
title: Ledgers and Proving
sidebar_label: Ledgers and proving
audience: operator
page_kind: procedure
---

# Ledgers and Proving

A proposal cannot move from votes to a result until the tally has two matching
proofs:

- an exhausted Staking Ledger to Voting Ledger proof;
- a merged Vote Reducer proof.

Both proof flows must use the same lifecycle ID and SQLite file.

Read the [CLI prerequisites](../cli/prerequisites.md) before signing a tally.
Use the [CLI command index](../reference/cli-commands.md) to check options.
Use [Voting Capacity and Period Sizing](../lifecycle/voting-capacity-and-period-sizing.md)
to calculate staking and vote proof counts before operation.

The manual and Compose proof procedures are below. For Kubernetes, follow
[1c. Staking Ledger Provider](../infrastructure/staking-ledger-provider.md) and
[2d. Lifecycle Pipeline](../infrastructure/lifecycle-pipeline.md).

## Select the Staking Snapshot

A Proposal records the current Mina staking-ledger root and total currency at
creation. Every later proof for that Proposal must use the exact ledger behind
that root.

The two deployment paths receive snapshots differently:

| Mode       | Snapshot input                                                               |
| ---------- | ---------------------------------------------------------------------------- |
| Compose    | `<ledgerHash>.json` payload and `lifecycle-<id>.hash` pointer.               |
| Kubernetes | `staking-<epoch>-<ledgerHash>.json.tar.gz` from the staking-ledger provider. |

The Compose scheduler parses no epoch numbers. An external snapshot producer
must decide which Mina ledger belongs to each Treasury lifecycle. It must
publish the verified JSON payload before it publishes the lifecycle pointer.

The Kubernetes provider retains epoch-named archives, but the ledger hash is
still the snapshot identity. Do not identify a ledger by epoch alone because
epoch numbers can repeat after a hard fork.

The hash-named payload must root to the Base58 `<ledgerHash>`. The scheduler
uses `staking-ledger get-root-hash --expected-root-hash` to enforce this check.
Use `--output-format json` when you also need the decimal field encoding stored
on Proposal accounts.

Count both values for the exact snapshot:

- staking accounts `N`, which control Staking Ledger to Voting Ledger work;
- distinct positive weighted delegates `D`, which describe the weighted voter
  population.

The base digest proof count is `ceil(N / 5)`. It does not use `D`.

Before proposal creation, preserve this exact ledger. Confirm that it contains
the default-token Treasury Owner account with a nonzero balance.

Creation does not check this viability. Tally later needs the account witness and divides by its historical balance.

## Use One SQLite Directory

The CLI and Compose defaults can identify different host directories.

```text
CLI:     SQLITE_DATA_DIRECTORY
Compose: SQLITE_DATA_HOST_PATH mounted at /data/sqlite
```

Set the CLI value to the absolute Compose host path when both processes work on
the same lifecycle data.

Create the host directory before Compose starts. Containers use UID `1000`.

```bash
mkdir -p <SQLITE_DATA_HOST_PATH>
sudo chown -R 1000:1000 <SQLITE_DATA_HOST_PATH>
```

The tracer stages trace and ledger changes before it flushes them to SQLite.

The flush is not one atomic database transaction. A crash can leave partial trace or ledger state.

After an interrupted flush, stop other writers. Remove and rebuild the affected lifecycle state before proving.

## Prepare Compose Snapshot Input

The Compose repository has no Mina exporter or snapshot synchronization
service. Prepare the input outside Compose. Use the complete
[Compose live-testnet procedure](../deployment/compose-testnet.md#4-prepare-every-staking-snapshot).

The input directory must contain both files:

```text
<STAKING_LEDGERS_HOST_PATH>/<LEDGER_HASH>.json
<STAKING_LEDGERS_HOST_PATH>/lifecycle-<L>.hash
```

The pointer contains one Base58 ledger hash and a final newline. Publish the
payload first. Publish the pointer last with an atomic move.

Do not change the pointer while the scheduler processes its lifecycle. The
scheduler fails the current run when it detects this change.

The pointer is immutable after the scheduler writes `<L>.sqlite.done`. Normal
polling reports and skips a pointer that changes after completion. Use
[Rebuild One Lifecycle](#rebuild-one-lifecycle) for an approved correction.

## Run the Voting-Ledger Scheduler

The normal stack starts `voting-ledger-scheduler`. It polls every
`VOTING_LEDGER_SCHEDULER_POLL_INTERVAL_SECONDS`. The default is 30 seconds.

For each pending pointer, it performs these steps:

1. Validate the numeric lifecycle ID and Base58 ledger hash.
2. Require the matching `<ledgerHash>.json` payload.
3. Restore a matching checkpoint, or remove prior lifecycle SQLite state.
4. Run `staking-ledger from-file` when no checkpoint was restored.
5. Compare the calculated root with the pointer hash.
6. Run `staking-ledger-to-voting-ledger trace-digest`.
7. Write `<L>.sqlite.done`.

Each poll processes the pending backlog from newest lifecycle to oldest. A
failed lifecycle gets an exponential retry backoff. Other eligible lifecycles
can still run during the same poll.

A missing payload remains pending. A root mismatch creates a failure marker.
The scheduler cannot replace the invalid payload because the input mount is
read-only. Replace it on the host before the next retry.

The Kubernetes scheduler has separate marker, S3, and checkpoint behavior.
Use the [Lifecycle Pipeline](../infrastructure/lifecycle-pipeline.md) procedure
for that deployment mode.

Use the explicit one-shot command when one lifecycle must run by itself.

## Rebuild One Lifecycle

Follow this recovery procedure when the trace or proof state for lifecycle
`<L>` is not valid. Stop all processes that can read, write, or prove that
lifecycle:

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  --profile proxy \
  --profile proving \
  stop voting-ledger-scheduler proving-scheduler api processor
```

Keep these four services stopped until all rebuild and reconciliation steps
are complete.

Invalidate all old completion results for lifecycle `<L>`. Move each existing
file below out of the live data directories. Do not put these files back:

```text
<SQLITE_DATA_HOST_PATH>/<L>.sqlite.done
<SQLITE_DATA_HOST_PATH>/<L>.sqlite.proven
<SQLITE_DATA_HOST_PATH>/proofs/<L>-merge.json
<SQLITE_DATA_HOST_PATH>/proofs/<L>-exhausted.json
```

Disable checkpoint restore for a complete rebuild. The one-shot scheduler then
removes the lifecycle SQLite database and journal files. It imports the
snapshot and rebuilds the trace:

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  --profile proxy \
  --profile proving \
  run --rm --no-deps \
  -e CHECKPOINT_S3_URI= \
  -e CHECKPOINT_INTERVAL= \
  voting-ledger-scheduler \
  /bin/sh \
  devops/docker/voting-ledger-scheduler-entrypoint.sh \
  process-lifecycle <L>
```

If this command fails, keep the four services stopped. Correct the cause and
run the command again.

Check the new trace marker:

```bash
jq . <SQLITE_DATA_HOST_PATH>/<L>.sqlite.done
```

The marker contains the lifecycle ID, ledger hash, and processing time.
Keep the services stopped. Set `PROOFS_ENABLED=true` in `<DEVOPS_ENV_FILE>`
and `<API_ENV_FILE>`. Render the proving profile:

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  --profile proving \
  config
```

Confirm that the resolved proving scheduler and worker values are exactly
`true`.

Create new proof files:

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  --profile proving \
  run --rm --no-deps proving-scheduler \
  /bin/sh \
  devops/docker/proving-scheduler-entrypoint.sh \
  process-lifecycle <L>
```

If proving fails, keep the four services stopped. Correct the cause and run
the proof command again.

Reconcile the rebuilt roots before restart:

1. Run `staking-ledger get-root-hash --output-format json` for lifecycle `<L>`.
2. Confirm that `ledgerHashBase58` equals the payload name and pointer value.
3. Run `proposal read-state` for each affected proposal. Confirm that its
   `stakingEpochDataLedgerHash` equals the JSON decimal field value.
4. Confirm that the exhausted proof uses this staking ledger root and has
   `exhausted = true`.
5. Record the exhausted proof output `votingLedgerRoot`. The Vote Reducer proof
   for each affected proposal must use this value as its input
   `votingLedgerRoot`.

Confirm the new files and marker:

```text
<SQLITE_DATA_HOST_PATH>/<L>.sqlite.done
<SQLITE_DATA_HOST_PATH>/<L>.sqlite.proven
<SQLITE_DATA_HOST_PATH>/proofs/<L>-merge.json
<SQLITE_DATA_HOST_PATH>/proofs/<L>-exhausted.json
```

Start the services only after all reconciliation checks pass:

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  --profile proxy \
  --profile proving \
  start api processor voting-ledger-scheduler proving-scheduler
```

Use the [CLI command index](../reference/cli-commands.md) for the root and
proposal state commands.

## Run Automated Staking Conversion Proofs

Set `PROOFS_ENABLED=true` in `<DEVOPS_ENV_FILE>` and `<API_ENV_FILE>`.
The scheduler exits without a proof marker when this value is not exactly
`true`.

Confirm the resolved scheduler and worker environments:

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  --profile proving \
  config
```

Start the proving profile only after this check:

```bash
pnpm testnet:up:proving
```

This profile adds:

- one private Redis service;
- `PROVING_WORKER_REPLICAS` proof worker replicas;
- one proving scheduler.

The default replica count is `3`. The default fixed queue name is
`staking-ledger-to-voting-ledger`.

The proving scheduler polls every
`PROVING_SCHEDULER_POLL_INTERVAL_SECONDS`. The default is 30 seconds.

The scheduler selects the oldest `.sqlite.done` marker without a matching
`.sqlite.proven` marker. It processes the full backlog in lifecycle order.

For each lifecycle, it runs:

1. `prove-digest`;
2. `prove-merge`;
3. `prove-exhaust`;
4. write `<L>.sqlite.proven`.

The default proof paths are:

```text
<SQLITE_DATA_HOST_PATH>/proofs/<L>-merge.json
<SQLITE_DATA_HOST_PATH>/proofs/<L>-exhausted.json
```

A failed lifecycle remains unproven. The scheduler retries it during a later
poll. If the trace and `<L>.sqlite.done` marker are still valid, you can retry
only the proof steps. Keep Redis and the proof workers active. Stop the
scheduler before this one-shot proof retry:

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  --profile proving \
  stop proving-scheduler

docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  --profile proving \
  run --rm --no-deps proving-scheduler \
  /bin/sh \
  devops/docker/proving-scheduler-entrypoint.sh \
  process-lifecycle <L>
```

Confirm the proof files and `<L>.sqlite.proven`. If the command fails, correct
the cause and run it again. Start the scheduler only after this check:

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  --profile proving \
  start proving-scheduler
```

The proof workers use one queue for all lifecycles. The scheduler proves one
lifecycle at a time.

Do not use the scheduler queue for a manual producer while scheduler work
exists. This rule applies across all lifecycles, not only the lifecycle that
the scheduler currently processes. Both `prove-digest` and `prove-merge`
clear the full shared queue before they add work. A manual producer can delete
scheduler jobs, and scheduler work can delete manual jobs.

For manual proof work, stop the proving scheduler and wait until the shared
queue has no active or waiting jobs. Then use a separate queue name and its
own workers. Do not restart the scheduler until the manual producer and its
workers have stopped.

## Run the Staking Conversion Manually

Use this path when automatic snapshot import is unavailable.

Import and check the ledger:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- staking-ledger from-file \
  --lifecycle-id <L> \
  --staking-ledger-path <STAKING_LEDGER_JSON_PATH>

dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- staking-ledger get-root-hash \
  --lifecycle-id <L>
```

Compile and trace:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- staking-ledger-to-voting-ledger compile

dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- staking-ledger-to-voting-ledger trace-digest \
  --lifecycle-id <L>
```

Start Redis and a worker:

```bash
docker run --rm -p 6379:6379 redis:7-alpine
```

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- worker start \
  --queue-name staking-ledger-to-voting-ledger-<L> \
  --redis-host 127.0.0.1 \
  --redis-port 6379
```

Prove, merge, and exhaust:

The Mina staking-ledger export is an ordered account sequence. The importer
writes each item to its sequence index. `prove-exhaust` checks the next leaf
after that imported sequence and marks the proof as exhausted. Before this
step, confirm that the imported root equals the Proposal snapshot root.

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- staking-ledger-to-voting-ledger prove-digest \
  --lifecycle-id <L> \
  --queue-name staking-ledger-to-voting-ledger-<L> \
  --redis-host 127.0.0.1 \
  --redis-port 6379

dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- staking-ledger-to-voting-ledger prove-merge \
  --lifecycle-id <L> \
  --queue-name staking-ledger-to-voting-ledger-<L> \
  --redis-host 127.0.0.1 \
  --redis-port 6379 \
  --proof-output-path .data/testnet/staking-ledger-merge.json

dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- staking-ledger-to-voting-ledger prove-exhaust \
  --lifecycle-id <L> \
  --proof-output-path .data/testnet/staking-ledger-exhausted.json
```

## Build the Vote Reducer Proof

Fetch actions after Archive has indexed all votes:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- proposal fetch-actions \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --output-path .data/testnet/vote-actions.json
```

Tally requires five distinct historical action-state targets. Each target must be non-initial, found, and present in the Proposal account.

A proof for one high-weight voter action cannot satisfy this condition by itself.

Compile and trace:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- vote-reducer compile

dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- vote-reducer trace-run-batch \
  --lifecycle-id <L> \
  --vote-actions-path .data/testnet/vote-actions.json
```

Start a worker on a separate queue:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- worker start \
  --queue-name vote-reducer-<L> \
  --redis-host 127.0.0.1 \
  --redis-port 6379
```

Prove and merge:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- vote-reducer prove-run-batch \
  --lifecycle-id <L> \
  --queue-name vote-reducer-<L> \
  --redis-host 127.0.0.1 \
  --redis-port 6379

dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- vote-reducer prove-merge \
  --lifecycle-id <L> \
  --queue-name vote-reducer-<L> \
  --redis-host 127.0.0.1 \
  --redis-port 6379 \
  --proof-output-path .data/testnet/vote-reducer-merge.json
```

Use `vote-reducer clear-state --lifecycle-id <L>` only for an isolated retry.
It preserves staking conversion data in the same lifecycle file.

## Decide Proving Resources

Real proof generation uses significant CPU time and memory. Measure the target
host before an operational lifecycle.

Choose these values before proving starts:

- worker replica count;
- Redis location;
- proof output directory;
- scheduler poll intervals;
- expected time for digest, merge, and exhaust stages.

Do not promise a tally time until the selected deployment has measured these
stages.

## Sources

- `devops/TESTNET.md`
- `packages/sdk/src/provable/contracts/treasury-owner.ts`
- `packages/sdk/src/provable/staking-ledger-to-voting-ledger.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts`
- `packages/sdk/src/proving/tracing/staking-ledger-to-voting-ledger-tracer.ts`
- `packages/sdk/src/proving/tracing/vote-reducer-tracer.ts`
- `devops/TESTNET_MINA_NODE.md`
- `devops/runbooks/1-Network/1c-Staking-Ledger-Provider/README.md`
- `devops/runbooks/2-Treasury/2d-Lifecycle-Pipeline/README.md`
- `devops/compose.yml`
- `devops/docker/voting-ledger-scheduler-entrypoint.sh`
- `devops/docker/proving-scheduler-entrypoint.sh`
- `apps/cli/src/commands/staking-ledger.ts`
- `apps/cli/src/commands/staking-ledger-to-voting-ledger.ts`
- `apps/cli/src/commands/vote-reducer.ts`
- `apps/cli/src/commands/worker.ts`
